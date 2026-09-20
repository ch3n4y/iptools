//! Application entry point: the GUI, plus a small headless CLI used by the
//! project's own acceptance checks and by support diagnostics.

pub mod commands;
pub mod config;
pub mod dto;
pub mod error;
pub mod net;
pub mod ping;
pub mod subnet;

use std::io::Write;

use tauri::{WebviewUrl, WebviewWindowBuilder};

const HEADLESS_FLAGS: [&str; 9] = [
    "--dump-adapters",
    "--dump-config",
    "--dump-devices",
    "--capture-backup",
    "--apply-config",
    "--restore-backup",
    "--check-update",
    "--selftest",
    "--version",
];

pub fn run() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if let Some(flag) = args.first() {
        if HEADLESS_FLAGS.contains(&flag.as_str()) {
            run_headless(flag, &args[1..]);
            return;
        }
    }
    run_gui();
}

fn emit_result(payload: &str, out: Option<&str>) {
    println!("{payload}");
    let _ = std::io::stdout().flush();
    if let Some(path) = out {
        let _ = std::fs::write(path, payload.as_bytes());
    }
}

fn flag_value(args: &[String], name: &str) -> Option<String> {
    let index = args.iter().position(|arg| arg == name)?;
    args.get(index + 1).cloned()
}

fn run_headless(flag: &str, args: &[String]) {
    let out = flag_value(args, "--out");
    match flag {
        "--version" => {
            let payload = serde_json::json!({
                "name": "IP地址修改器",
                "version": env!("CARGO_PKG_VERSION"),
            });
            emit_result(&payload.to_string(), out.as_deref());
        }
        "--dump-adapters" => {
            let payload = match net::adapters::list() {
                Ok(adapters) => serde_json::json!({
                    "ok": true,
                    "elevated": net::elevation::is_elevated(),
                    "count": adapters.len(),
                    "deviceMapSize": net::device::map_by_net_cfg_id().len(),
                    "adapters": adapters,
                }),
                Err(err) => serde_json::json!({
                    "ok": false,
                    "elevated": net::elevation::is_elevated(),
                    "error": serde_json::to_value(&err).unwrap_or_default(),
                }),
            };
            emit_result(&payload.to_string(), out.as_deref());
        }
        "--dump-config" => {
            let payload = serde_json::json!({
                "ok": true,
                "elevated": net::elevation::is_elevated(),
                "configDir": config::config_dir().to_string_lossy(),
                "portable": config::is_portable(),
                "settings": config::load_settings(),
                "schemes": config::load_schemes(),
                "identity": net::identity::info(),
                "defaultScanSpec": commands::default_scan_spec(),
            });
            emit_result(&payload.to_string(), out.as_deref());
        }
        "--selftest" => {
            let report = commands::_headless_selftest();
            emit_result(&report.to_string(), out.as_deref());
        }
        "--dump-devices" => {
            let payload = serde_json::json!({ "ok": true, "device": net::device::diagnose() });
            emit_result(&payload.to_string(), out.as_deref());
        }
        "--capture-backup" => {
            let payload = match flag_value(args, "--adapter") {
                None => serde_json::json!({ "ok": false, "error": "缺少 --adapter <网卡 GUID>" }),
                Some(adapter_id) => match net::write::backup_of_id(&adapter_id) {
                    Ok(backup) => serde_json::json!({ "ok": true, "backup": backup }),
                    Err(err) => serde_json::json!({
                        "ok": false,
                        "error": serde_json::to_value(&err).unwrap_or_default()
                    }),
                },
            };
            emit_result(&payload.to_string(), out.as_deref());
        }
        "--apply-config" => run_apply_config(args, out, false),
        "--restore-backup" => run_apply_config(args, out, true),
        "--check-update" => run_update_check(out),
        _ => {}
    }
}

/// Builds a windowless Tauri app so the updater plugin can be exercised from the
/// command line (used by the acceptance checks for the auto-update criterion).
fn run_update_check(out: Option<String>) {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .setup(move |app| {
            let handle = app.handle().clone();
            let out = out.clone();
            tauri::async_runtime::spawn(async move {
                let info = commands::check_update_inner(&handle).await;
                let payload = serde_json::json!({ "ok": true, "update": info });
                emit_result(&payload.to_string(), out.as_deref());
                handle.exit(0);
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build headless app");
    app.run(|_, _| {});
}

fn run_gui() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            commands::list_adapters,
            commands::get_adapter,
            commands::set_adapter_enabled,
            commands::random_mac_address,
            commands::change_mac,
            commands::plan_apply,
            commands::apply_config,
            commands::capture_backup,
            commands::restore_backup,
            commands::derive_gateway,
            commands::default_mask_for,
            commands::list_schemes,
            commands::save_scheme,
            commands::delete_scheme,
            commands::reorder_schemes,
            commands::capture_current_scheme,
            commands::plan_scheme,
            commands::apply_scheme,
            commands::import_schemes,
            commands::import_schemes_text,
            commands::merge_schemes,
            commands::export_schemes,
            commands::schemes_location,
            commands::get_settings,
            commands::save_settings,
            commands::set_portable_mode,
            commands::get_identity,
            commands::set_computer_name,
            commands::set_workgroup,
            commands::calculate_subnet,
            commands::expand_ping_targets,
            commands::default_scan_spec,
            commands::start_ping,
            commands::cancel_ping,
            commands::running_ping_jobs,
            commands::export_ping_csv,
            commands::app_status,
            commands::is_elevated,
            commands::relaunch_as_admin,
            commands::open_network_connections,
            commands::open_app_location,
            commands::check_update,
            commands::install_update,
        ])
        .setup(|app| {
            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("IP 地址修改器")
                .inner_size(1240.0, 830.0)
                .min_inner_size(1040.0, 700.0)
                .decorations(false)
                .resizable(true)
                .center()
                .build()?;
            let _ = window.show();
            #[cfg(debug_assertions)]
            window.open_devtools();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the application");
}

/// Applies a configuration (or restores a backup) from a JSON file.
///
/// This is the same `write::plan` / `write::apply` path the GUI uses, exposed
/// for scripted verification and support diagnostics:
///
/// ```text
/// IP地址修改器.exe --apply-config --input request.json [--dry-run] [--out out.json]
/// IP地址修改器.exe --restore-backup --input backup.json [--out out.json]
/// IP地址修改器.exe --capture-backup --adapter {GUID} [--out backup.json]
/// ```
fn run_apply_config(args: &[String], out: Option<String>, restore: bool) {
    let dry_run = args.iter().any(|arg| arg == "--dry-run");
    let payload = match flag_value(args, "--input") {
        None => serde_json::json!({ "ok": false, "error": "缺少 --input <json 文件路径>" }),
        Some(path) => match std::fs::read_to_string(&path) {
            Err(err) => serde_json::json!({
                "ok": false,
                "error": format!("无法读取 {path}：{err}")
            }),
            Ok(text) => {
                if restore {
                    match serde_json::from_str::<crate::dto::AdapterBackup>(&text) {
                        Err(err) => serde_json::json!({
                            "ok": false,
                            "error": format!("备份文件解析失败：{err}")
                        }),
                        Ok(backup) => {
                            let request = crate::net::write::request_from_backup(&backup);
                            execute_request(&request, false)
                        }
                    }
                } else {
                    match serde_json::from_str::<crate::dto::ApplyRequest>(&text) {
                        Err(err) => serde_json::json!({
                            "ok": false,
                            "error": format!("请求文件解析失败：{err}")
                        }),
                        Ok(request) => execute_request(&request, dry_run),
                    }
                }
            }
        },
    };
    emit_result(&payload.to_string(), out.as_deref());
}

fn execute_request(request: &crate::dto::ApplyRequest, dry_run: bool) -> serde_json::Value {
    if dry_run {
        return match crate::net::write::plan(request) {
            Ok(plan) => serde_json::json!({ "ok": true, "dryRun": true, "plan": plan }),
            Err(err) => serde_json::json!({
                "ok": false,
                "dryRun": true,
                "error": serde_json::to_value(&err).unwrap_or_default()
            }),
        };
    }
    match crate::net::write::apply(request) {
        Ok(result) => serde_json::json!({ "ok": result.success, "dryRun": false, "result": result }),
        Err(err) => serde_json::json!({
            "ok": false,
            "dryRun": false,
            "error": serde_json::to_value(&err).unwrap_or_default()
        }),
    }
}
