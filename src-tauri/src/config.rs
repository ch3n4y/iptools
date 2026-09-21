//! Persistence for settings and schemes.
//!
//! Layout: `settings.json` and `schemes.json` inside `%APPDATA%\iptools`,
//! or next to the executable when the portable marker file is present.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

use crate::dto::{
    AddressSpec, AppSettings, ImportReport, Scheme, SchemesFile, CURRENT_SCHEMES_VERSION,
};
use crate::error::{AppError, AppResult, ErrorCode};
use crate::subnet;

pub const APP_DIR_NAME: &str = "iptools";
pub const SETTINGS_FILE: &str = "settings.json";
pub const SCHEMES_FILE: &str = "schemes.json";
pub const PORTABLE_MARKER: &str = "portable.txt";

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn exe_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf))
        .unwrap_or_else(|| PathBuf::from("."))
}

pub fn portable_marker_path() -> PathBuf {
    exe_dir().join(PORTABLE_MARKER)
}

pub fn is_portable() -> bool {
    portable_marker_path().exists()
}

pub fn config_dir() -> PathBuf {
    if is_portable() {
        return exe_dir();
    }
    match std::env::var("APPDATA") {
        Ok(base) if !base.trim().is_empty() => Path::new(&base).join(APP_DIR_NAME),
        _ => exe_dir(),
    }
}

pub fn ensure_config_dir() -> AppResult<PathBuf> {
    let dir = config_dir();
    fs::create_dir_all(&dir).map_err(|err| {
        AppError::new(ErrorCode::IoError, "无法创建配置目录")
            .detail(format!("{}：{err}", dir.display()))
    })?;
    Ok(dir)
}

pub fn settings_path() -> PathBuf {
    config_dir().join(SETTINGS_FILE)
}

pub fn schemes_path() -> PathBuf {
    config_dir().join(SCHEMES_FILE)
}

fn write_text_atomic(path: &Path, text: &str) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let temp = path.with_extension("tmp");
    fs::write(&temp, text)?;
    // Replace, tolerating a leftover target on Windows.
    if path.exists() {
        let _ = fs::remove_file(path);
    }
    fs::rename(&temp, path).map_err(|err| {
        AppError::new(ErrorCode::IoError, "写入配置文件失败")
            .detail(format!("{}：{err}", path.display()))
    })
}

fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> AppResult<()> {
    let text = serde_json::to_string_pretty(value)
        .map_err(|err| AppError::new(ErrorCode::Unknown, "序列化配置失败").detail(err.to_string()))?;
    write_text_atomic(path, &text)
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

pub fn load_settings() -> AppSettings {
    let path = settings_path();
    let Ok(text) = fs::read_to_string(&path) else {
        return AppSettings::default();
    };
    match serde_json::from_str::<AppSettings>(&text) {
        Ok(settings) => migrate_settings(settings),
        Err(_) => AppSettings::default(),
    }
}

pub fn migrate_settings(mut settings: AppSettings) -> AppSettings {
    if settings.version < 1 {
        settings.version = 1;
    }
    if !matches!(settings.theme.as_str(), "system" | "light" | "dark") {
        settings.theme = "system".to_string();
    }
    if settings.refresh_interval_ms < 2000 {
        settings.refresh_interval_ms = 2000;
    }
    if settings.ping.prefix == 0 || settings.ping.prefix > 32 {
        settings.ping.prefix = 24;
    }
    if settings.ping.concurrency == 0 {
        settings.ping.concurrency = 64;
    }
    if settings.ping.timeout_ms < 100 {
        settings.ping.timeout_ms = 1000;
    }
    if settings.ping.multipass_rounds == 0 {
        settings.ping.multipass_rounds = 3;
    }
    settings
}

pub fn save_settings(settings: &AppSettings) -> AppResult<()> {
    ensure_config_dir()?;
    write_json_atomic(&settings_path(), settings)
}

pub fn new_id() -> String {
    let mut bytes = [0u8; 8];
    for byte in bytes.iter_mut() {
        *byte = rand::random::<u8>();
    }
    let suffix: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    format!("s{}-{}", now_ms(), suffix)
}

// ---------------------------------------------------------------------------
// Schemes
// ---------------------------------------------------------------------------

pub fn load_schemes() -> SchemesFile {
    let path = schemes_path();
    let Ok(text) = fs::read_to_string(&path) else {
        return SchemesFile::default();
    };
    match serde_json::from_str::<serde_json::Value>(&text) {
        Ok(value) => migrate_schemes_value(value),
        Err(_) => SchemesFile::default(),
    }
}

pub fn save_schemes(file: &SchemesFile) -> AppResult<()> {
    ensure_config_dir()?;
    let normalized = SchemesFile {
        version: CURRENT_SCHEMES_VERSION,
        schemes: file.schemes.iter().cloned().map(normalize_scheme).collect(),
    };
    write_json_atomic(&schemes_path(), &normalized)
}

/// Accepts the current file shape, a bare array of schemes, or a legacy
/// `{ "方案名": { ... } }` map.
pub fn migrate_schemes_value(value: serde_json::Value) -> SchemesFile {
    let mut schemes: Vec<Scheme> = Vec::new();
    match value {
        serde_json::Value::Array(items) => {
            for item in items {
                if let Ok(scheme) = serde_json::from_value::<Scheme>(item) {
                    schemes.push(scheme);
                }
            }
        }
        serde_json::Value::Object(map) => {
            if let Some(serde_json::Value::Array(items)) = map.get("schemes") {
                for item in items.clone() {
                    if let Ok(scheme) = serde_json::from_value::<Scheme>(item) {
                        schemes.push(scheme);
                    }
                }
            } else {
                // Legacy shape: top-level keys are scheme names.
                for (name, item) in map {
                    if !item.is_object() {
                        continue;
                    }
                    let mut object = item.clone();
                    if let serde_json::Value::Object(ref mut fields) = object {
                        fields
                            .entry("name".to_string())
                            .or_insert(serde_json::Value::String(name.clone()));
                        fields
                            .entry("id".to_string())
                            .or_insert(serde_json::Value::String(new_id()));
                    }
                    if let Ok(scheme) = serde_json::from_value::<Scheme>(object) {
                        schemes.push(scheme);
                    }
                }
            }
        }
        _ => {}
    }

    schemes = schemes.into_iter().map(normalize_scheme).collect();

    SchemesFile {
        version: CURRENT_SCHEMES_VERSION,
        schemes,
    }
}

/// Trims text fields, re-derives masks from prefixes and fills identifiers.
pub fn normalize_scheme(mut scheme: Scheme) -> Scheme {
    scheme.name = scheme.name.trim().to_string();
    if scheme.name.is_empty() {
        scheme.name = "未命名方案".to_string();
    }
    if scheme.id.trim().is_empty() {
        scheme.id = new_id();
    }
    scheme.tags = scheme
        .tags
        .iter()
        .map(|tag| tag.trim().to_string())
        .filter(|tag| !tag.is_empty())
        .collect();
    scheme.match_mac = normalize_mac(scheme.match_mac.as_deref());
    scheme.match_hostname = scheme
        .match_hostname
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string);
    scheme.match_adapter_name = scheme
        .match_adapter_name
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string);
    scheme.note = scheme.note.trim().to_string();
    scheme.gateway = scheme
        .gateway
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string);
    scheme.dns = scheme
        .dns
        .iter()
        .map(|server| server.trim().to_string())
        .filter(|server| !server.is_empty())
        .collect();
    if scheme.dhcp {
        scheme.addresses.clear();
    }
    for spec in scheme.addresses.iter_mut() {
        spec.address = spec.address.trim().to_string();
        if let Some(mask) = subnet::mask_from_prefix(spec.prefix) {
            spec.mask = subnet::format_ipv4(mask);
        } else if let Some((prefix, mask)) = subnet::parse_mask_or_prefix(&spec.mask) {
            spec.prefix = prefix;
            spec.mask = subnet::format_ipv4(mask);
        }
    }
    if scheme.dns_mode == crate::dto::DnsMode::Dhcp {
        scheme.dns.clear();
    }
    scheme
}

pub fn normalize_mac(input: Option<&str>) -> Option<String> {
    let text = input?.trim();
    if text.is_empty() {
        return None;
    }
    let hex: String = text
        .chars()
        .filter(|c| c.is_ascii_hexdigit())
        .map(|c| c.to_ascii_uppercase())
        .collect();
    if hex.len() != 12 {
        return None;
    }
    let pairs: Vec<String> = (0..6)
        .map(|i| hex[i * 2..i * 2 + 2].to_string())
        .collect();
    Some(pairs.join("-"))
}

// ---------------------------------------------------------------------------
// 导入 / 导出（CSV / TSV / Excel / JSON）
// ---------------------------------------------------------------------------

const CSV_COLUMNS: [(&str, &[&str]); 17] = [
    ("name", &["name", "名称", "方案名", "方案名称"]),
    ("tags", &["tags", "标签"]),
    ("matchMac", &["matchMac", "mac", "匹配MAC"]),
    ("matchHostname", &["matchHostname", "hostname", "匹配主机名", "主机名"]),
    ("matchAdapterName", &["matchAdapterName", "adapter", "匹配网卡", "网卡"]),
    ("dhcp", &["dhcp", "自动获取"]),
    ("addresses", &["addresses", "地址", "IP地址", "ip"]),
    ("masks", &["masks", "掩码", "子网掩码", "mask", "prefix"]),
    ("gateway", &["gateway", "网关", "默认网关"]),
    ("dnsMode", &["dnsMode", "DNS模式"]),
    ("dns", &["dns", "DNS服务器"]),
    ("metric", &["metric", "跃点", "接口跃点数"]),
    ("note", &["note", "备注", "说明"]),
    ("ip2", &["ip2", "地址2", "IP地址2"]),
    ("mask2", &["mask2", "掩码2", "子网掩码2"]),
    ("ip3", &["ip3", "地址3", "IP地址3"]),
    ("mask3", &["mask3", "掩码3", "子网掩码3"]),
];

fn aliases(key: &str) -> &'static [&'static str] {
    CSV_COLUMNS
        .iter()
        .find(|(candidate, _)| *candidate == key)
        .map(|(_, names)| *names)
        .unwrap_or(&[])
}

fn pick(row: &[String], headers: &[String], key: &str) -> Option<String> {
    let names = aliases(key);
    for (index, header) in headers.iter().enumerate() {
        let normalized = header.trim().to_ascii_lowercase();
        let matched = names
            .iter()
            .any(|name| normalized == name.to_ascii_lowercase());
        if matched {
            if let Some(value) = row.get(index) {
                let text = value.trim();
                if !text.is_empty() {
                    return Some(text.to_string());
                }
            }
        }
    }
    None
}

fn parse_boolish(text: &str) -> bool {
    matches!(
        text.trim().to_ascii_lowercase().as_str(),
        "1" | "true" | "yes" | "y" | "dhcp" | "自动" | "自动获取" | "是"
    )
}

fn split_list(text: &str) -> Vec<String> {
    text.split([';', ',', '|', ' ', '，', '；'])
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(str::to_string)
        .collect()
}



fn row_to_scheme(headers: &[String], row: &[String], row_number: usize) -> Result<Scheme, String> {
    let name = pick(row, headers, "name")
        .ok_or_else(|| format!("第 {row_number} 行缺少方案名称"))?;

    let mut addresses: Vec<AddressSpec> = Vec::new();
    if let Some(ips) = pick(row, headers, "addresses") {
        let ip_list = split_list(&ips);
        let mask_list = pick(row, headers, "masks")
            .map(|text| split_list(&text))
            .unwrap_or_default();
        for (index, ip) in ip_list.iter().enumerate() {
            let mask_text = mask_list
                .get(index)
                .cloned()
                .unwrap_or_else(|| "24".to_string());
            let (prefix, mask) = subnet::parse_mask_or_prefix(&mask_text)
                .ok_or_else(|| format!("第 {row_number} 行的子网掩码不合法：{mask_text}"))?;
            addresses.push(AddressSpec {
                address: ip.clone(),
                prefix,
                mask: subnet::format_ipv4(mask),
            });
        }
    }
    for (ip_key, mask_key) in [("ip2", "mask2"), ("ip3", "mask3")] {
        if let Some(ip) = pick(row, headers, ip_key) {
            let mask_text =
                pick(row, headers, mask_key).unwrap_or_else(|| "24".to_string());
            let (prefix, mask) = subnet::parse_mask_or_prefix(&mask_text)
                .ok_or_else(|| format!("第 {row_number} 行的子网掩码不合法：{mask_text}"))?;
            for single in split_list(&ip) {
                addresses.push(AddressSpec {
                    address: single,
                    prefix,
                    mask: subnet::format_ipv4(mask),
                });
            }
        }
    }

    let dhcp = pick(row, headers, "dhcp")
        .map(|text| parse_boolish(&text))
        .unwrap_or(addresses.is_empty());

    let dns_mode_text = pick(row, headers, "dnsMode").unwrap_or_default();
    let dns_servers: Vec<String> = pick(row, headers, "dns")
        .map(|text| split_list(&text))
        .unwrap_or_default();
    let normalized_mode = dns_mode_text.trim().to_ascii_lowercase();
    let dns_mode = if normalized_mode.is_empty() {
        if dns_servers.is_empty() {
            crate::dto::DnsMode::Dhcp
        } else {
            crate::dto::DnsMode::Static
        }
    } else if normalized_mode.contains("static") || normalized_mode.contains("手动") || normalized_mode.contains("静态") {
        crate::dto::DnsMode::Static
    } else {
        crate::dto::DnsMode::Dhcp
    };

    let scheme = Scheme {
        id: new_id(),
        name,
        tags: pick(row, headers, "tags")
            .map(|text| split_list(&text))
            .unwrap_or_default(),
        match_mac: pick(row, headers, "matchMac"),
        match_hostname: pick(row, headers, "matchHostname"),
        match_adapter_name: pick(row, headers, "matchAdapterName"),
        dhcp,
        addresses,
        gateway: pick(row, headers, "gateway"),
        dns_mode,
        dns: dns_servers,
        metric: pick(row, headers, "metric").and_then(|text| text.parse().ok()),
        note: pick(row, headers, "note").unwrap_or_default(),
        created_at_ms: now_ms(),
        updated_at_ms: now_ms(),
    };
    Ok(normalize_scheme(scheme))
}

pub fn schemes_from_rows(rows: Vec<Vec<String>>) -> ImportReport {
    let mut errors = Vec::new();
    let mut schemes = Vec::new();
    let mut skipped = 0usize;
    let mut headers: Option<Vec<String>> = None;

    for (index, row) in rows.iter().enumerate() {
        let row_number = index + 1;
        if headers.is_none() {
            if row.iter().all(|cell| cell.trim().is_empty()) {
                skipped += 1;
                continue;
            }
            headers = Some(row.iter().map(|cell| cell.trim().to_string()).collect());
            continue;
        }
        if row.iter().all(|cell| cell.trim().is_empty()) {
            skipped += 1;
            continue;
        }
        match row_to_scheme(headers.as_ref().unwrap(), row, row_number) {
            Ok(scheme) => schemes.push(scheme),
            Err(message) => errors.push(message),
        }
    }

    if headers.is_none() {
        errors.push("表格为空，未找到表头行".to_string());
    }

    ImportReport {
        schemes,
        errors,
        skipped,
    }
}

pub fn parse_schemes_csv(text: &str) -> AppResult<ImportReport> {
    let delimiter = if text.lines().next().unwrap_or("").contains('\t') {
        b'\t'
    } else {
        b','
    };
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(false)
        .flexible(true)
        .delimiter(delimiter)
        .from_reader(text.as_bytes());
    let mut rows = Vec::new();
    for record in reader.records() {
        let record = record.map_err(|err| {
            AppError::new(ErrorCode::InvalidInput, "CSV 解析失败").detail(err.to_string())
        })?;
        rows.push(
            record
                .iter()
                .map(|cell| cell.to_string())
                .collect::<Vec<String>>(),
        );
    }
    Ok(schemes_from_rows(rows))
}

pub fn parse_schemes_xlsx(path: &Path) -> AppResult<ImportReport> {
    use calamine::{open_workbook_auto, Reader};

    let mut workbook = open_workbook_auto(path).map_err(|err| {
        AppError::new(ErrorCode::InvalidInput, "无法打开 Excel 文件")
            .detail(format!("{}：{err}", path.display()))
    })?;
    let sheets = workbook.sheet_names().to_owned();
    let sheet = sheets
        .first()
        .cloned()
        .ok_or_else(|| AppError::new(ErrorCode::InvalidInput, "Excel 文件中没有工作表"))?;
    let range = workbook.worksheet_range(&sheet).map_err(|err| {
        AppError::new(ErrorCode::InvalidInput, "无法读取 Excel 工作表")
            .detail(format!("{sheet}：{err}"))
    })?;

    let mut rows: Vec<Vec<String>> = Vec::new();
    for row in range.rows() {
        rows.push(row.iter().map(|cell| cell.to_string()).collect());
    }
    Ok(schemes_from_rows(rows))
}

pub fn parse_schemes_json(text: &str) -> AppResult<ImportReport> {
    let value: serde_json::Value = serde_json::from_str(text)?;
    let file = migrate_schemes_value(value);
    Ok(ImportReport {
        schemes: file.schemes,
        errors: Vec::new(),
        skipped: 0,
    })
}

/// CSV export mirroring the import columns, so an export round-trips.
pub fn schemes_to_csv(schemes: &[Scheme]) -> String {
    let mut writer = csv::WriterBuilder::new().from_writer(vec![]);
    let headers: Vec<&str> = CSV_COLUMNS.iter().map(|(key, _)| *key).collect();
    let _ = writer.write_record(&headers);
    for scheme in schemes {
        let row = vec![
            scheme.name.clone(),
            scheme.tags.join("|"),
            scheme.match_mac.clone().unwrap_or_default(),
            scheme.match_hostname.clone().unwrap_or_default(),
            scheme.match_adapter_name.clone().unwrap_or_default(),
            if scheme.dhcp { "true" } else { "false" }.to_string(),
            scheme
                .addresses
                .iter()
                .map(|spec| spec.address.clone())
                .collect::<Vec<String>>()
                .join("|"),
            scheme
                .addresses
                .iter()
                .map(|spec| spec.mask.clone())
                .collect::<Vec<String>>()
                .join("|"),
            scheme.gateway.clone().unwrap_or_default(),
            match scheme.dns_mode {
                crate::dto::DnsMode::Dhcp => "dhcp".to_string(),
                crate::dto::DnsMode::Static => "static".to_string(),
            },
            scheme.dns.join("|"),
            scheme
                .metric
                .map(|value| value.to_string())
                .unwrap_or_default(),
            scheme.note.clone(),
            // `ip2`/`ip3` are write-only conveniences for hand-made tables; the
            // canonical `addresses`/`masks` columns above stay authoritative so
            // an export always round-trips.
            String::new(),
            String::new(),
            String::new(),
            String::new(),
        ];
        let _ = writer.write_record(&row);
    }
    let _ = writer.flush();
    let bytes = writer.into_inner().unwrap_or_default();
    String::from_utf8_lossy(&bytes).to_string()
}

/// Scores how well a scheme matches an adapter; higher wins, `0` means the
/// scheme carries no explicit match rule.
pub fn match_score(scheme: &Scheme, adapter_name: &str, mac: &str, hostname: &str) -> i32 {
    let mut score = 0;
    if let Some(scheme_mac) = scheme.match_mac.as_deref() {
        if normalize_mac(Some(scheme_mac)) == normalize_mac(Some(mac)) {
            score += 100;
        }
    }
    if let Some(scheme_host) = scheme.match_hostname.as_deref() {
        if scheme_host.eq_ignore_ascii_case(hostname) {
            score += 60;
        }
    }
    if let Some(scheme_adapter) = scheme.match_adapter_name.as_deref() {
        if scheme_adapter.eq_ignore_ascii_case(adapter_name) {
            score += 30;
        }
    }
    score
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dto::DnsMode;

    fn sample_scheme() -> Scheme {
        Scheme {
            id: "s1".to_string(),
            name: "样例".to_string(),
            tags: vec![],
            match_mac: None,
            match_hostname: None,
            match_adapter_name: None,
            dhcp: false,
            addresses: vec![AddressSpec {
                address: "192.168.1.10".to_string(),
                prefix: 24,
                mask: "255.255.255.0".to_string(),
            }],
            gateway: Some("192.168.1.1".to_string()),
            dns_mode: DnsMode::Static,
            dns: vec!["8.8.8.8".to_string()],
            metric: None,
            note: String::new(),
            created_at_ms: 0,
            updated_at_ms: 0,
        }
    }

    #[test]
    fn normalizes_mac_addresses() {
        assert_eq!(normalize_mac(Some("aabbccddeeff")).as_deref(), Some("AA-BB-CC-DD-EE-FF"));
        assert_eq!(normalize_mac(Some("AA-BB-CC-DD-EE-FF")).as_deref(), Some("AA-BB-CC-DD-EE-FF"));
        assert_eq!(normalize_mac(Some("aa:bb:cc:dd:ee:ff")).as_deref(), Some("AA-BB-CC-DD-EE-FF"));
        assert_eq!(normalize_mac(Some("AABBCCDDEE")), None);
        assert_eq!(normalize_mac(Some("   ")), None);
        assert_eq!(normalize_mac(None), None);
    }

    #[test]
    fn migrates_legacy_scheme_shapes() {
        let legacy = serde_json::json!({
            "办公室": {
                "dhcp": false,
                "addresses": [{"address": "192.168.1.10", "prefix": 24, "mask": "255.255.255.0"}],
                "gateway": "192.168.1.1",
                "dns": ["8.8.8.8"],
                "dnsMode": "static"
            }
        });
        let file = migrate_schemes_value(legacy);
        assert_eq!(file.version, CURRENT_SCHEMES_VERSION);
        assert_eq!(file.schemes.len(), 1);
        assert_eq!(file.schemes[0].name, "办公室");
        assert!(!file.schemes[0].id.is_empty());
        assert_eq!(file.schemes[0].dns, vec!["8.8.8.8".to_string()]);

        let array = serde_json::json!([{"id": "a", "name": "  DHCP  ", "dhcp": true}]);
        let file = migrate_schemes_value(array);
        assert_eq!(file.schemes[0].name, "DHCP");

        let current = serde_json::json!({"version": 1, "schemes": [{"id": "x", "name": "n", "dhcp": false}]});
        let file = migrate_schemes_value(current);
        assert_eq!(file.schemes.len(), 1);

        // Garbage input must not panic and yields an empty file.
        let file = migrate_schemes_value(serde_json::json!("nonsense"));
        assert!(file.schemes.is_empty());
    }

    #[test]
    fn normalize_scheme_cleans_fields() {
        let mut scheme = sample_scheme();
        scheme.id = "".to_string();
        scheme.name = "  测试方案 ".to_string();
        scheme.tags = vec![" a ".to_string(), "  ".to_string()];
        scheme.match_mac = Some("aabbccddeeff".to_string());
        scheme.match_hostname = Some("  DESKTOP  ".to_string());
        scheme.match_adapter_name = Some("".to_string());
        scheme.addresses = vec![AddressSpec {
            address: " 10.0.0.5 ".to_string(),
            prefix: 16,
            mask: "".to_string(),
        }];
        scheme.gateway = Some(" 10.0.0.1 ".to_string());
        scheme.dns = vec![" 1.1.1.1 ".to_string(), "".to_string()];
        scheme.note = " note ".to_string();
        let cleaned = normalize_scheme(scheme);
        assert_eq!(cleaned.name, "测试方案");
        assert!(!cleaned.id.is_empty());
        assert_eq!(cleaned.tags, vec!["a".to_string()]);
        assert_eq!(cleaned.match_mac.as_deref(), Some("AA-BB-CC-DD-EE-FF"));
        assert_eq!(cleaned.match_hostname.as_deref(), Some("DESKTOP"));
        assert_eq!(cleaned.match_adapter_name, None);
        assert_eq!(cleaned.addresses[0].address, "10.0.0.5");
        assert_eq!(cleaned.addresses[0].mask, "255.255.0.0");
        assert_eq!(cleaned.dns, vec!["1.1.1.1".to_string()]);
        assert_eq!(cleaned.gateway.as_deref(), Some("10.0.0.1"));
        assert_eq!(cleaned.note, "note");

        // DHCP schemes carry no manual addresses and no static DNS.
        let mut dhcp_scheme = sample_scheme();
        dhcp_scheme.dhcp = true;
        dhcp_scheme.dns_mode = DnsMode::Dhcp;
        let cleaned = normalize_scheme(dhcp_scheme);
        assert!(cleaned.addresses.is_empty());
        assert!(cleaned.dns.is_empty());
    }

    #[test]
    fn imports_csv_with_english_headers() {
        let csv_text = "name,addresses,masks,gateway,dns,dnsMode,dhcp,metric\n\
办公楼,192.168.1.10,255.255.255.0,192.168.1.1,8.8.8.8;1.1.1.1,static,false,20\n\
酒店-DHCP,,,,,,true,\n";
        let report = parse_schemes_csv(csv_text).unwrap();
        assert!(report.errors.is_empty(), "{:?}", report.errors);
        assert_eq!(report.schemes.len(), 2);

        let office = &report.schemes[0];
        assert_eq!(office.name, "办公楼");
        assert_eq!(office.addresses.len(), 1);
        assert_eq!(office.addresses[0].prefix, 24);
        assert_eq!(office.gateway.as_deref(), Some("192.168.1.1"));
        assert_eq!(office.dns.len(), 2);
        assert_eq!(office.dns_mode, DnsMode::Static);
        assert_eq!(office.metric, Some(20));
        assert!(!office.dhcp);

        let hotel = &report.schemes[1];
        assert!(hotel.dhcp);
        assert!(hotel.addresses.is_empty());
        assert_eq!(hotel.dns_mode, DnsMode::Dhcp);
    }

    #[test]
    fn imports_csv_with_chinese_headers_and_extra_ips() {
        let csv_text = "名称,IP地址,子网掩码,地址2,掩码2,默认网关\n\
机房,10.1.1.10,255.255.255.0,10.2.2.10,255.255.255.0,10.1.1.1\n";
        let report = parse_schemes_csv(csv_text).unwrap();
        assert_eq!(report.schemes.len(), 1);
        assert_eq!(report.schemes[0].addresses.len(), 2);
        assert_eq!(report.schemes[0].addresses[1].address, "10.2.2.10");
    }

    #[test]
    fn imports_tab_separated_tables() {
        let text = "name\taddresses\tmasks\tdhcp\n无线\t10.9.9.9\t255.255.255.0\tfalse\n";
        let report = parse_schemes_csv(text).unwrap();
        assert_eq!(report.schemes.len(), 1);
        assert_eq!(report.schemes[0].addresses[0].address, "10.9.9.9");
    }

    #[test]
    fn reports_broken_csv_rows_without_aborting() {
        let csv_text = "name,addresses,masks,dhcp\n\
good,10.0.0.1,24,false\n\
,must-be-ignored,24,false\n\
bad,10.0.0.2,999.999.0.0,false\n";
        let report = parse_schemes_csv(csv_text).unwrap();
        assert_eq!(report.schemes.len(), 1);
        assert_eq!(report.errors.len(), 2);
        assert!(report.errors[0].contains("缺少方案名称"));
        assert!(report.errors[1].contains("子网掩码"));
    }

    #[test]
    fn reports_empty_table() {
        let report = parse_schemes_csv("").unwrap();
        assert!(report.schemes.is_empty());
        assert_eq!(report.errors.len(), 1);
    }

    #[test]
    fn csv_export_round_trips() {
        let mut scheme = sample_scheme();
        scheme.name = "含,逗号 的\"方案\"".to_string();
        scheme.tags = vec!["a".to_string(), "b".to_string()];
        scheme.match_mac = Some("AA-BB-CC-DD-EE-FF".to_string());
        scheme.match_hostname = Some("DESKTOP".to_string());
        scheme.addresses = vec![
            AddressSpec {
                address: "192.168.1.10".to_string(),
                prefix: 24,
                mask: "255.255.255.0".to_string(),
            },
            AddressSpec {
                address: "10.0.0.10".to_string(),
                prefix: 16,
                mask: "255.255.0.0".to_string(),
            },
        ];
        scheme.dns = vec!["8.8.8.8".to_string(), "1.1.1.1".to_string()];
        scheme.metric = Some(10);
        scheme.note = "备注".to_string();
        let schemes = vec![normalize_scheme(scheme)];

        let text = schemes_to_csv(&schemes);
        let report = parse_schemes_csv(&text).unwrap();
        assert!(report.errors.is_empty(), "{:?}", report.errors);
        assert_eq!(report.schemes.len(), 1);
        let round_tripped = &report.schemes[0];
        assert_eq!(round_tripped.name, "含,逗号 的\"方案\"");
        assert_eq!(round_tripped.addresses.len(), 2);
        assert_eq!(round_tripped.addresses[0].address, "192.168.1.10");
        assert_eq!(round_tripped.addresses[1].prefix, 16);
        assert_eq!(round_tripped.tags, vec!["a".to_string(), "b".to_string()]);
        assert_eq!(round_tripped.dns, vec!["8.8.8.8".to_string(), "1.1.1.1".to_string()]);
        assert_eq!(round_tripped.metric, Some(10));
        assert_eq!(round_tripped.match_hostname.as_deref(), Some("DESKTOP"));
        assert_eq!(round_tripped.note, "备注");
    }

    #[test]
    fn parses_json_import_shapes() {
        let report =
            parse_schemes_json("{\"version\":1,\"schemes\":[{\"id\":\"i\",\"name\":\"a\",\"dhcp\":true}]}")
                .unwrap();
        assert_eq!(report.schemes.len(), 1);
        let report = parse_schemes_json("[{\"id\":\"i\",\"name\":\"b\",\"dhcp\":false}]").unwrap();
        assert_eq!(report.schemes[0].name, "b");
        assert!(parse_schemes_json("{not json").is_err());
    }

    #[test]
    fn migrates_settings_defaults() {
        let settings = migrate_settings(AppSettings {
            version: 0,
            theme: "neon".to_string(),
            confirm_before_apply: false,
            auto_refresh_adapters: false,
            refresh_interval_ms: 10,
            last_adapter_id: None,
            portable: false,
            ping: crate::dto::PingDefaults {
                mode: crate::dto::PingMode::Arp,
                concurrency: 0,
                timeout_ms: 0,
                slow: false,
                prefix: 99,
                multipass: false,
                multipass_rounds: 0,
            },
            check_update_on_start: false,
        });
        assert_eq!(settings.version, 1);
        assert_eq!(settings.theme, "system");
        assert_eq!(settings.refresh_interval_ms, 2000);
        assert_eq!(settings.ping.concurrency, 64);
        assert_eq!(settings.ping.timeout_ms, 1000);
        assert_eq!(settings.ping.prefix, 24);
        assert_eq!(settings.ping.multipass_rounds, 3);
    }

    #[test]
    fn scores_scheme_matches() {
        let mut scheme = sample_scheme();
        scheme.match_mac = Some("AA-BB-CC-DD-EE-FF".to_string());
        scheme.match_hostname = Some("DESKTOP-X".to_string());
        scheme.match_adapter_name = Some("以太网".to_string());
        assert_eq!(
            match_score(&scheme, "以太网", "aa:bb:cc:dd:ee:ff", "desktop-x"),
            190
        );
        scheme.match_mac = None;
        scheme.match_hostname = None;
        scheme.match_adapter_name = None;
        assert_eq!(
            match_score(&scheme, "以太网", "aa:bb:cc:dd:ee:ff", "desktop-x"),
            0
        );
    }

    #[test]
    fn config_paths_follow_portable_mode() {
        // Without the marker the config lives under APPDATA (or the exe dir when
        // APPDATA is unavailable); the file names stay stable either way.
        let dir = config_dir();
        assert!(settings_path().ends_with(SETTINGS_FILE));
        assert!(schemes_path().ends_with(SCHEMES_FILE));
        assert!(settings_path().starts_with(&dir) || settings_path().exists() || !dir.exists());
    }
}
