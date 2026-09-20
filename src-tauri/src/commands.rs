//! Tauri command surface. Everything the renderer can do is declared here; the
//! TypeScript side mirrors these names in `src/lib/api/*`.

use std::path::Path;

use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

use crate::config;
use crate::dto::*;
use crate::error::{AppError, AppResult, ErrorCode};
use crate::net::{adapters, device, elevation, identity, write};
use crate::ping;
use crate::subnet;

// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn list_adapters() -> AppResult<Vec<AdapterInfo>> {
    adapters::list()
}

#[tauri::command]
pub fn get_adapter(adapter_id: String) -> AppResult<AdapterInfo> {
    adapters::get(&adapter_id)
}

#[tauri::command]
pub async fn set_adapter_enabled(adapter_id: String, enabled: bool) -> AppResult<AdapterInfo> {
    elevation::require_elevation(if enabled { "启用网卡" } else { "禁用网卡" })?;
    device::set_enabled(&adapter_id, enabled)?;
    // Poll until the device reports the requested state (its stack needs a
    // moment to tear down or come back up).
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    loop {
        std::thread::sleep(std::time::Duration::from_millis(600));
        if let Ok(adapter) = adapters::get(&adapter_id) {
            if adapter.enabled == enabled {
                return Ok(adapter);
            }
        }
        if std::time::Instant::now() >= deadline {
            let actual = adapters::get(&adapter_id).ok().map(|adapter| adapter.enabled);
            return Err(AppError::new(
                ErrorCode::CommandFailed,
                "网卡状态未在预期时间内切换",
            )
            .detail(format!("期望 enabled={enabled}，实际 {actual:?}"))
            .hint("可在系统「网络连接」中确认设备状态后重试"));
        }
    }
}

#[tauri::command]
pub fn random_mac_address() -> String {
    crate::net::random_mac()
}

#[tauri::command]
pub async fn change_mac(adapter_id: String, mac: Option<String>) -> AppResult<AdapterInfo> {
    let normalized = mac
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string);
    identity::change_mac(&adapter_id, normalized.as_deref())
}

// ---------------------------------------------------------------------------
// Configuration apply
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn plan_apply(request: ApplyRequest) -> AppResult<ApplyPlan> {
    write::plan(&request)
}

#[tauri::command]
pub async fn apply_config(request: ApplyRequest) -> AppResult<ApplyResult> {
    write::apply(&request)
}

#[tauri::command]
pub fn capture_backup(adapter_id: String) -> AppResult<AdapterBackup> {
    Ok(write::backup_of(&adapters::get(&adapter_id)?))
}

#[tauri::command]
pub async fn restore_backup(backup: AdapterBackup) -> AppResult<ApplyResult> {
    let request = write::request_from_backup(&backup);
    write::apply(&request)
}

#[tauri::command]
pub fn derive_gateway(ip: String, mask: String) -> AppResult<Option<String>> {
    let address = subnet::parse_ipv4(&ip)
        .ok_or_else(|| AppError::invalid(format!("IP 地址不合法：{ip}")))?;
    let (_, mask_value) = subnet::parse_mask_or_prefix(&mask)
        .ok_or_else(|| AppError::invalid(format!("子网掩码不合法：{mask}")))?;
    Ok(subnet::derive_gateway(address, mask_value).map(subnet::format_ipv4))
}

#[tauri::command]
pub fn default_mask_for(ip: String) -> AppResult<String> {
    let address = subnet::parse_ipv4(&ip)
        .ok_or_else(|| AppError::invalid(format!("IP 地址不合法：{ip}")))?;
    Ok(subnet::format_ipv4(subnet::default_mask_for_ip(address)))
}

// ---------------------------------------------------------------------------
// Schemes
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn list_schemes(adapter_id: Option<String>) -> AppResult<Vec<Scheme>> {
    let file = config::load_schemes();
    let mut schemes = file.schemes;
    let target = adapter_id
        .as_deref()
        .and_then(|id| adapters::get(id).ok());
    let hostname = identity::info().computer_name;
    match target {
        Some(adapter) => {
            schemes.sort_by(|left, right| {
                let left_score =
                    config::match_score(left, &adapter.name, &adapter.mac, &hostname);
                let right_score =
                    config::match_score(right, &adapter.name, &adapter.mac, &hostname);
                right_score
                    .cmp(&left_score)
                    .then_with(|| left.name.cmp(&right.name))
            });
        }
        None => schemes.sort_by(|left, right| left.name.cmp(&right.name)),
    }
    Ok(schemes)
}

#[tauri::command]
pub fn save_scheme(scheme: Scheme) -> AppResult<Scheme> {
    let mut file = config::load_schemes();
    let mut candidate = config::normalize_scheme(scheme);
    if candidate.created_at_ms == 0 {
        candidate.created_at_ms = config::now_ms();
    }
    candidate.updated_at_ms = config::now_ms();
    match file
        .schemes
        .iter_mut()
        .find(|existing| existing.id == candidate.id)
    {
        Some(existing) => *existing = candidate.clone(),
        None => file.schemes.push(candidate.clone()),
    }
    config::save_schemes(&file)?;
    Ok(candidate)
}

#[tauri::command]
pub fn delete_scheme(scheme_id: String) -> AppResult<Vec<Scheme>> {
    let mut file = config::load_schemes();
    file.schemes.retain(|scheme| scheme.id != scheme_id);
    config::save_schemes(&file)?;
    Ok(file.schemes)
}

#[tauri::command]
pub fn reorder_schemes(scheme_ids: Vec<String>) -> AppResult<Vec<Scheme>> {
    let file = config::load_schemes();
    let mut ordered: Vec<Scheme> = Vec::with_capacity(file.schemes.len());
    for id in &scheme_ids {
        if let Some(scheme) = file.schemes.iter().find(|scheme| &scheme.id == id) {
            ordered.push(scheme.clone());
        }
    }
    for scheme in file.schemes.iter() {
        if !ordered.iter().any(|existing| existing.id == scheme.id) {
            ordered.push(scheme.clone());
        }
    }
    let updated = SchemesFile {
        version: CURRENT_SCHEMES_VERSION,
        schemes: ordered,
    };
    config::save_schemes(&updated)?;
    Ok(updated.schemes)
}

#[tauri::command]
pub fn capture_current_scheme(adapter_id: String, name: String) -> AppResult<Scheme> {
    let adapter = adapters::get(&adapter_id)?;
    let request = write::request_from(&adapter);
    let now = config::now_ms();
    Ok(config::normalize_scheme(Scheme {
        id: config::new_id(),
        name,
        tags: Vec::new(),
        match_mac: Some(adapter.mac.clone()),
        match_hostname: Some(identity::info().computer_name),
        match_adapter_name: Some(adapter.name.clone()),
        dhcp: request.dhcp,
        addresses: request.addresses,
        gateway: request.gateway,
        gateway_metric: request.gateway_metric,
        dns_mode: request.dns_mode,
        dns: request.dns,
        metric: request.metric,
        note: String::new(),
        created_at_ms: now,
        updated_at_ms: now,
    }))
}

#[tauri::command]
pub fn plan_scheme(scheme_id: String, adapter_id: String) -> AppResult<ApplyPlan> {
    let file = config::load_schemes();
    let scheme = file
        .schemes
        .iter()
        .find(|scheme| scheme.id == scheme_id)
        .ok_or_else(|| AppError::new(ErrorCode::NotFound, "方案不存在，可能已被删除"))?;
    write::plan(&request_from_scheme(scheme, &adapter_id))
}

#[tauri::command]
pub fn apply_scheme(scheme_id: String, adapter_id: String) -> AppResult<ApplyResult> {
    let file = config::load_schemes();
    let scheme = file
        .schemes
        .iter()
        .find(|scheme| scheme.id == scheme_id)
        .ok_or_else(|| AppError::new(ErrorCode::NotFound, "方案不存在，可能已被删除"))?;
    write::apply(&request_from_scheme(scheme, &adapter_id))
}

fn request_from_scheme(scheme: &Scheme, adapter_id: &str) -> ApplyRequest {
    ApplyRequest {
        adapter_id: adapter_id.to_string(),
        dhcp: scheme.dhcp,
        addresses: scheme.addresses.clone(),
        gateway: scheme.gateway.clone(),
        gateway_metric: scheme.gateway_metric,
        dns_mode: scheme.dns_mode,
        dns: scheme.dns.clone(),
        metric: scheme.metric,
        no_rollback: false,
    }
}

#[tauri::command]
pub fn import_schemes(path: String) -> AppResult<ImportReport> {
    let file_path = Path::new(&path);
    let extension = file_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let report = match extension.as_str() {
        "json" => config::parse_schemes_json(&std::fs::read_to_string(file_path)?)?,
        "xlsx" | "xls" | "xlsm" => config::parse_schemes_xlsx(file_path)?,
        _ => config::parse_schemes_csv(&std::fs::read_to_string(file_path)?)?,
    };
    Ok(report)
}

#[tauri::command]
pub fn import_schemes_text(text: String, format: String) -> AppResult<ImportReport> {
    match format.to_ascii_lowercase().as_str() {
        "json" => config::parse_schemes_json(&text),
        _ => config::parse_schemes_csv(&text),
    }
}

#[tauri::command]
pub fn merge_schemes(schemes: Vec<Scheme>, overwrite: bool) -> AppResult<Vec<Scheme>> {
    let mut file = config::load_schemes();
    for incoming in schemes {
        let mut candidate = config::normalize_scheme(incoming);
        candidate.updated_at_ms = config::now_ms();
        if candidate.created_at_ms == 0 {
            candidate.created_at_ms = candidate.updated_at_ms;
        }
        match file
            .schemes
            .iter_mut()
            .find(|existing| existing.id == candidate.id || existing.name == candidate.name)
        {
            Some(existing) if overwrite => *existing = candidate,
            Some(_) => {}
            None => file.schemes.push(candidate),
        }
    }
    config::save_schemes(&file)?;
    Ok(file.schemes)
}

#[tauri::command]
pub fn export_schemes(path: String, format: String) -> AppResult<String> {
    let file = config::load_schemes();
    let text = match format.to_ascii_lowercase().as_str() {
        "json" => serde_json::to_string_pretty(&file).map_err(|err| {
            AppError::new(ErrorCode::Unknown, "序列化方案失败").detail(err.to_string())
        })?,
        _ => config::schemes_to_csv(&file.schemes),
    };
    std::fs::write(Path::new(&path), text.as_bytes())?;
    Ok(path)
}

#[tauri::command]
pub fn schemes_location() -> AppResult<String> {
    Ok(config::schemes_path().to_string_lossy().to_string())
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_settings() -> AppSettings {
    config::load_settings()
}

#[tauri::command]
pub fn save_settings(settings: AppSettings) -> AppResult<AppSettings> {
    let migrated = config::migrate_settings(settings);
    config::save_settings(&migrated)?;
    Ok(migrated)
}

#[tauri::command]
pub fn set_portable_mode(enabled: bool) -> AppResult<AppSettings> {
    config::set_portable(enabled)?;
    let mut settings = config::load_settings();
    settings.portable = enabled;
    config::migrate_settings(settings.clone());
    config::save_settings(&settings)?;
    Ok(settings)
}

// ---------------------------------------------------------------------------
// Machine identity
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_identity() -> IdentityInfo {
    identity::info()
}

#[tauri::command]
pub fn set_computer_name(name: String) -> AppResult<IdentityInfo> {
    identity::set_computer_name(&name)?;
    Ok(identity::info())
}

#[tauri::command]
pub fn set_workgroup(name: String) -> AppResult<IdentityInfo> {
    identity::set_workgroup(&name)?;
    Ok(identity::info())
}

// ---------------------------------------------------------------------------
// Toolbox
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn calculate_subnet(ip: Option<String>, mask: String) -> AppResult<SubnetCalc> {
    subnet::calculate(ip.as_deref(), &mask).map_err(AppError::invalid)
}

#[tauri::command]
pub fn expand_ping_targets(spec: String) -> TargetList {
    let (targets, errors) = ping::expand_targets(&spec, 4096);
    TargetList { targets, errors }
}

#[tauri::command]
pub fn default_scan_spec() -> String {
    match adapters::primary_connected() {
        Some(adapter) => adapter
            .ipv4
            .addresses
            .first()
            .map(|entry| {
                let mask = subnet::mask_from_prefix(entry.prefix).unwrap_or(0xFFFF_FF00);
                let network = subnet::parse_ipv4(&entry.address)
                    .map(|ip| subnet::network_address(ip, mask))
                    .unwrap_or(0);
                format!("{}/{}", subnet::format_ipv4(network), entry.prefix)
            })
            .unwrap_or_else(|| "192.168.1.0/24".to_string()),
        None => "192.168.1.0/24".to_string(),
    }
}

#[tauri::command]
pub fn start_ping(app: AppHandle, request: PingRequest) -> AppResult<()> {
    ping::start(app, request)
}

#[tauri::command]
pub fn cancel_ping(job_id: String) {
    ping::cancel(&job_id);
}

#[tauri::command]
pub fn running_ping_jobs() -> Vec<String> {
    ping::running_jobs()
}

#[tauri::command]
pub fn export_ping_csv(path: String, results: Vec<PingResult>) -> AppResult<String> {
    let text = ping::export_csv(&results);
    // Excel opens GBK CSV more reliably on Chinese Windows when a BOM is present.
    let mut bytes = vec![0xEF, 0xBB, 0xBF];
    bytes.extend_from_slice(text.as_bytes());
    std::fs::write(Path::new(&path), bytes)?;
    Ok(path)
}

// ---------------------------------------------------------------------------
// Application status, elevation and updates
// ---------------------------------------------------------------------------

fn os_description() -> String {
    use winreg::enums::{HKEY_LOCAL_MACHINE, KEY_READ};
    use winreg::RegKey;

    let Ok(key) = RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey_with_flags(
        r"SOFTWARE\Microsoft\Windows NT\CurrentVersion",
        KEY_READ,
    ) else {
        return std::env::consts::OS.to_string();
    };
    let product: String = key.get_value("ProductName").unwrap_or_default();
    let edition: String = key.get_value("DisplayVersion").unwrap_or_default();
    let build: String = key.get_value("CurrentBuildNumber").unwrap_or_default();
    let description = format!("{} {} (Build {})", product, edition, build)
        .trim()
        .to_string();
    if description.is_empty() {
        std::env::consts::OS.to_string()
    } else {
        description
    }
}

#[tauri::command]
pub fn app_status(app: AppHandle) -> AppStatus {
    AppStatus {
        version: app.package_info().version.to_string(),
        is_elevated: elevation::is_elevated(),
        config_dir: config::config_dir().to_string_lossy().to_string(),
        schemes_path: config::schemes_path().to_string_lossy().to_string(),
        settings_path: config::settings_path().to_string_lossy().to_string(),
        portable: config::is_portable(),
        os_description: os_description(),
    }
}

#[tauri::command]
pub fn is_elevated() -> bool {
    elevation::is_elevated()
}

#[tauri::command]
pub fn relaunch_as_admin(app: AppHandle) -> AppResult<()> {
    elevation::relaunch_elevated(&[])?;
    std::thread::sleep(std::time::Duration::from_millis(400));
    app.exit(0);
    Ok(())
}

#[tauri::command]
pub fn open_network_connections() -> AppResult<()> {
    elevation::open_control_panel("ncpa.cpl")
}

#[tauri::command]
pub fn open_app_location() -> AppResult<String> {
    let dir = config::ensure_config_dir()?;
    elevation::open_control_panel(&dir.to_string_lossy())?;
    Ok(dir.to_string_lossy().to_string())
}

pub async fn check_update_inner(app: &AppHandle) -> UpdateInfo {
    let current = app.package_info().version.to_string();
    let updater = match app.updater() {
        Ok(updater) => updater,
        Err(err) => {
            return UpdateInfo {
                current_version: current,
                available: false,
                version: None,
                notes: None,
                date: None,
                error: Some(err.to_string()),
                unsupported: true,
            }
        }
    };
    match updater.check().await {
        Ok(Some(update)) => UpdateInfo {
            current_version: current,
            available: true,
            version: Some(update.version.clone()),
            notes: update.body.clone(),
            date: update.date.map(|value| value.to_string()),
            error: None,
            unsupported: false,
        },
        Ok(None) => UpdateInfo {
            current_version: current,
            available: false,
            version: None,
            notes: None,
            date: None,
            error: None,
            unsupported: false,
        },
        Err(err) => UpdateInfo {
            current_version: current,
            available: false,
            version: None,
            notes: None,
            date: None,
            error: Some(err.to_string()),
            unsupported: false,
        },
    }
}

#[tauri::command]
pub async fn check_update(app: AppHandle) -> AppResult<UpdateInfo> {
    Ok(check_update_inner(&app).await)
}

#[tauri::command]
pub async fn install_update(app: AppHandle) -> AppResult<String> {
    use tauri::Emitter;

    let updater = app
        .updater()
        .map_err(|err| AppError::new(ErrorCode::NotSupported, "更新组件不可用").detail(err.to_string()))?;
    let Some(update) = updater
        .check()
        .await
        .map_err(|err| AppError::new(ErrorCode::CommandFailed, "检查更新失败").detail(err.to_string()))?
    else {
        return Ok("当前已是最新版本".to_string());
    };

    let version = update.version.clone();
    let progress_app = app.clone();
    let mut downloaded: u64 = 0;
    update
        .download_and_install(
            move |chunk, total| {
                downloaded += chunk as u64;
                let _ = progress_app.emit(
                    "update://progress",
                    UpdateProgress {
                        downloaded,
                        total,
                        finished: false,
                    },
                );
            },
            || {},
        )
        .await
        .map_err(|err| AppError::new(ErrorCode::CommandFailed, "下载或安装更新失败").detail(err.to_string()))?;

    let _ = app.emit(
        "update://progress",
        UpdateProgress {
            downloaded,
            total: Some(downloaded),
            finished: true,
        },
    );
    Ok(format!("已下载并安装 {version}，重启后生效"))
}

// ---------------------------------------------------------------------------
// Headless self-check (`--selftest`)
// ---------------------------------------------------------------------------

/// Read-only diagnostic used by the `--selftest` flag and by the acceptance
/// harness. It never modifies the machine configuration.
pub fn _headless_selftest() -> serde_json::Value {
    let mut checks: Vec<serde_json::Value> = Vec::new();

    checks.push(serde_json::json!({
        "name": "elevation",
        "ok": true,
        "detail": { "isElevated": elevation::is_elevated() }
    }));

    match adapters::list() {
        Ok(list) => {
            let valid = !list.is_empty()
                && list
                    .iter()
                    .all(|adapter| !adapter.id.trim().is_empty() && !adapter.name.trim().is_empty());
            checks.push(serde_json::json!({
                "name": "adapters",
                "ok": valid,
                "detail": {
                    "count": list.len(),
                    "names": list.iter().map(|adapter| adapter.name.clone()).collect::<Vec<String>>(),
                    "connected": list.iter().filter(|adapter| adapter.status == AdapterStatus::Connected).count(),
                }
            }));
        }
        Err(err) => checks.push(serde_json::json!({
            "name": "adapters",
            "ok": false,
            "detail": serde_json::to_value(&err).unwrap_or_default()
        })),
    }

    match config::ensure_config_dir() {
        Ok(dir) => checks.push(serde_json::json!({
            "name": "config-dir",
            "ok": true,
            "detail": { "path": dir.to_string_lossy(), "portable": config::is_portable() }
        })),
        Err(err) => checks.push(serde_json::json!({
            "name": "config-dir",
            "ok": false,
            "detail": serde_json::to_value(&err).unwrap_or_default()
        })),
    }

    let sample = Scheme {
        id: "selftest".to_string(),
        name: "selftest".to_string(),
        tags: vec![],
        match_mac: None,
        match_hostname: None,
        match_adapter_name: None,
        dhcp: false,
        addresses: vec![AddressSpec {
            address: "10.9.9.9".to_string(),
            prefix: 24,
            mask: "255.255.255.0".to_string(),
        }],
        gateway: Some("10.9.9.1".to_string()),
        gateway_metric: None,
        dns_mode: DnsMode::Static,
        dns: vec!["9.9.9.9".to_string()],
        metric: None,
        note: String::new(),
        created_at_ms: 0,
        updated_at_ms: 0,
    };
    let csv = config::schemes_to_csv(&[sample]);
    let round_trip_ok = config::parse_schemes_csv(&csv)
        .map(|report| {
            report.errors.is_empty()
                && report.schemes.len() == 1
                && report.schemes[0]
                    .addresses
                    .first()
                    .map(|spec| spec.address == "10.9.9.9" && spec.prefix == 24)
                    .unwrap_or(false)
        })
        .unwrap_or(false);
    checks.push(serde_json::json!({
        "name": "schemes-roundtrip",
        "ok": round_trip_ok,
        "detail": { "csv": csv }
    }));

    let subnet_ok = match subnet::calculate(Some("192.168.1.130"), "255.255.255.128") {
        Ok(calc) => {
            let ok = calc.prefix == 25
                && calc.network == "192.168.1.128"
                && calc.broadcast == "192.168.1.255"
                && calc.first_host == "192.168.1.129";
            checks.push(serde_json::json!({ "name": "subnet", "ok": ok, "detail": calc }));
            ok
        }
        Err(message) => {
            checks.push(serde_json::json!({ "name": "subnet", "ok": false, "detail": message }));
            false
        }
    };
    let _ = subnet_ok;

    let (targets, errors) = ping::expand_targets("10.0.0.0/29", 4096);
    checks.push(serde_json::json!({
        "name": "ping-expand",
        "ok": targets.len() == 6 && errors.is_empty(),
        "detail": { "targets": targets, "errors": errors }
    }));

    let all_ok = checks
        .iter()
        .all(|check| check["ok"].as_bool().unwrap_or(false));

    serde_json::json!({
        "ok": all_ok,
        "version": env!("CARGO_PKG_VERSION"),
        "identity": identity::info(),
        "checks": checks,
    })
}
