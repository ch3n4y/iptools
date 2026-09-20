//! The write path: builds a plan, applies it through `netsh` (locale independent,
//! invoked without a shell), then reads the adapter back to verify — and rolls
//! back automatically when verification fails.

use std::os::windows::process::CommandExt;
use std::process::Command;
use std::thread::sleep;
use std::time::{Duration, Instant};

use crate::dto::{
    AdapterBackup, AdapterInfo, ApplyPlan, ApplyRequest, ChangeItem, DnsMode, StepResult,
    ValidationIssue,
};
use crate::error::{AppError, AppResult, ErrorCode};
use crate::net::{adapters, elevation};
use crate::subnet;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const VERIFY_TIMEOUT: Duration = Duration::from_secs(6);
const VERIFY_INTERVAL: Duration = Duration::from_millis(400);

/// Console output arrives in the OEM code page (GBK on Chinese Windows).
fn decode_console(bytes: &[u8]) -> String {
    match std::str::from_utf8(bytes) {
        Ok(text) => text.to_string(),
        Err(_) => {
            let (text, _, _) = encoding_rs::GB18030.decode(bytes);
            text.to_string()
        }
    }
}

struct NetshOutcome {
    ok: bool,
    output: String,
}

fn netsh(args: &[String]) -> AppResult<NetshOutcome> {
    let output = Command::new("netsh")
        .args(args)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|err| {
            AppError::new(ErrorCode::CommandFailed, "无法执行 netsh 命令").detail(err.to_string())
        })?;
    let mut text = decode_console(&output.stdout);
    let stderr = decode_console(&output.stderr);
    if !stderr.trim().is_empty() {
        if !text.trim().is_empty() {
            text.push('\n');
        }
        text.push_str(&stderr);
    }
    Ok(NetshOutcome {
        ok: output.status.success(),
        output: text.trim().to_string(),
    })
}

fn adapter_arg(name: &str) -> String {
    format!("name=\"{name}\"")
}

/// `netsh` returns a non-zero exit code for "DHCP is already enabled", which is
/// a harmless no-op rather than a failure.
fn is_benign_dhcp_message(output: &str) -> bool {
    let text = output.to_lowercase();
    text.contains("already enabled")
        || text.contains("已启用 dhcp")
        || text.contains("已在此接口上启用")
        || text.contains("dhcp 已启用")
}

enum Action {
    Netsh(Vec<String>),
}

struct Step {
    name: String,
    label: String,
    action: Action,
}

fn value_or_none(value: Option<&str>) -> String {
    value
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .unwrap_or("none")
        .to_string()
}

/// Deletes manually configured addresses that are about to become stale.
///
/// Windows 10 keeps the DHCP flag on some adapters (notably Wi-Fi profiles)
/// even after a static address is configured, and `netsh ... source=dhcp`
/// refuses to run while that flag is set — so the write path removes manual
/// addresses explicitly instead of relying on the mode switch alone.
fn cleanup_steps(adapter_name: &str, before: &AdapterInfo, request: &ApplyRequest) -> Vec<Step> {
    let requested: Vec<String> = request
        .addresses
        .iter()
        .map(|spec| spec.address.trim().to_string())
        .collect();
    before
        .ipv4
        .addresses
        .iter()
        .filter(|entry| entry.origin == "manual")
        .filter(|entry| {
            request.dhcp
                || !requested
                    .iter()
                    .any(|address| address.eq_ignore_ascii_case(&entry.address))
        })
        .filter(|entry| subnet::parse_ipv4(&entry.address).is_some())
        .map(|entry| Step {
            name: format!("delete-address-{}", entry.address),
            label: format!("移除旧的手动地址 {}", entry.address),
            action: Action::Netsh(vec![
                "interface".into(),
                "ipv4".into(),
                "delete".into(),
                "address".into(),
                adapter_arg(adapter_name),
                format!("address={}", entry.address),
            ]),
        })
        .collect()
}

fn build_steps(before: &AdapterInfo, request: &ApplyRequest) -> Vec<Step> {
    let adapter_name = before.name.as_str();
    let mut steps: Vec<Step> = Vec::new();

    if request.dhcp {
        // A previous static configuration can leave its default gateway behind
        // (Windows keeps the DHCP flag on Wi-Fi adapters); drop it explicitly.
        if let Some(gateway) = before.ipv4.gateway.clone().filter(|value| !value.trim().is_empty()) {
            steps.push(Step {
                name: "cleanup-gateway".to_string(),
                label: format!("清除旧的默认网关 {gateway}"),
                action: Action::Netsh(vec![
                    "interface".into(),
                    "ipv4".into(),
                    "delete".into(),
                    "route".into(),
                    "prefix=0.0.0.0/0".into(),
                    format!("interface=\"{adapter_name}\""),
                    format!("nexthop={gateway}"),
                ]),
            });
        }
        steps.push(Step {
            name: "address-dhcp".to_string(),
            label: "切换为自动获取（DHCP）".to_string(),
            action: Action::Netsh(vec![
                "interface".into(),
                "ipv4".into(),
                "set".into(),
                "address".into(),
                adapter_arg(adapter_name),
                "source=dhcp".into(),
            ]),
        });
    } else if let Some(primary) = request.addresses.first() {
        let mut args: Vec<String> = vec![
            "interface".into(),
            "ipv4".into(),
            "set".into(),
            "address".into(),
            adapter_arg(adapter_name),
            "source=static".into(),
            format!("address={}", primary.address),
            format!("mask={}", primary.mask),
            format!("gateway={}", value_or_none(request.gateway.as_deref())),
        ];
        if let Some(metric) = request.gateway_metric {
            args.push(format!("gwmetric={metric}"));
        }
        steps.push(Step {
            name: "address-primary".to_string(),
            label: format!("设置主 IP {}", primary.address),
            action: Action::Netsh(args),
        });

        for (index, extra) in request.addresses.iter().enumerate().skip(1) {
            steps.push(Step {
                name: format!("address-extra-{index}"),
                label: format!("添加附加 IP {}", extra.address),
                action: Action::Netsh(vec![
                    "interface".into(),
                    "ipv4".into(),
                    "add".into(),
                    "address".into(),
                    adapter_arg(adapter_name),
                    format!("address={}", extra.address),
                    format!("mask={}", extra.mask),
                ]),
            });
        }
    }

    match request.dns_mode {
        DnsMode::Static if !request.dns.is_empty() => {
            let servers: Vec<String> = request
                .dns
                .iter()
                .map(|server| server.trim().to_string())
                .filter(|server| !server.is_empty())
                .collect();
            if let Some(primary) = servers.first() {
                steps.push(Step {
                    name: "dns-primary".to_string(),
                    label: format!("设置首选 DNS {primary}"),
                    action: Action::Netsh(vec![
                        "interface".into(),
                        "ipv4".into(),
                        "set".into(),
                        "dnsservers".into(),
                        adapter_arg(adapter_name),
                        "source=static".into(),
                        format!("address={primary}"),
                        "register=primary".into(),
                        "validate=no".into(),
                    ]),
                });
            }
            for (index, server) in servers.iter().enumerate().skip(1) {
                steps.push(Step {
                    name: format!("dns-{index}"),
                    label: format!("添加备用 DNS {server}"),
                    action: Action::Netsh(vec![
                        "interface".into(),
                        "ipv4".into(),
                        "add".into(),
                        "dnsservers".into(),
                        adapter_arg(adapter_name),
                        format!("address={server}"),
                        format!("index={}", index + 1),
                        "validate=no".into(),
                    ]),
                });
            }
        }
        DnsMode::Dhcp => {
            steps.push(Step {
                name: "dns-dhcp".to_string(),
                label: "DNS 改为自动获取".to_string(),
                action: Action::Netsh(vec![
                    "interface".into(),
                    "ipv4".into(),
                    "set".into(),
                    "dnsservers".into(),
                    adapter_arg(adapter_name),
                    "source=dhcp".into(),
                ]),
            });
        }
        _ => {}
    }

    // The form is the desired end state, so the metric step is always emitted:
    // an empty field means "back to automatic", which is what a restore of a
    // backup captured without an explicit metric needs.
    steps.push(Step {
        name: "metric".to_string(),
        label: match request.metric {
            Some(metric) => format!("设置接口跃点数 {metric}"),
            None => "恢复自动跃点数".to_string(),
        },
        action: Action::Netsh(vec![
            "interface".into(),
            "ipv4".into(),
            "set".into(),
            "interface".into(),
            format!("interface=\"{adapter_name}\""),
            match request.metric {
                Some(metric) => format!("metric={metric}"),
                None => "metric=automatic".to_string(),
            },
        ]),
    });

    steps
}

fn run_step(step: &Step) -> StepResult {
    match &step.action {
        Action::Netsh(args) => match netsh(args) {
            Ok(outcome) => {
                // `source=dhcp` reports failure when DHCP is already enabled on the
                // interface; that is the state we want, so treat it as success.
                let benign = !outcome.ok && is_benign_dhcp_message(&outcome.output);
                // Cleanup steps are best-effort: the route may already be gone.
                let tolerant = step.name.starts_with("cleanup-");
                StepResult {
                    step: step.name.clone(),
                    label: step.label.clone(),
                    ok: outcome.ok || benign || tolerant,
                    message: if outcome.ok {
                        "已完成".to_string()
                    } else if benign {
                        "系统报告 DHCP 已在启用状态，无需更改".to_string()
                    } else if tolerant {
                        format!("已跳过（无需清理）：{}", outcome.output)
                    } else if outcome.output.is_empty() {
                        "命令执行失败".to_string()
                    } else {
                        outcome.output.clone()
                    },
                }
            }
            Err(err) => StepResult {
                step: step.name.clone(),
                label: step.label.clone(),
                ok: false,
                message: err.to_string(),
            },
        },

    }
}



pub fn backup_of(info: &AdapterInfo) -> AdapterBackup {
    AdapterBackup {
        adapter_id: info.id.clone(),
        adapter_name: info.name.clone(),
        dhcp: info.dhcp_enabled,
        addresses: current_addresses(info),
        gateway: info.ipv4.gateway.clone(),
        gateway_metric: info.ipv4.gateway_metric,
        dns_mode: if info.dns.source == "static" && !info.dns.servers.is_empty() {
            DnsMode::Static
        } else {
            DnsMode::Dhcp
        },
        dns: info.dns.servers.clone(),
        metric: info.metric,
    }
}

fn current_addresses(info: &AdapterInfo) -> Vec<crate::dto::AddressSpec> {
    info.ipv4
        .addresses
        .iter()
        .filter(|entry| subnet::parse_ipv4(&entry.address).is_some())
        .map(|entry| crate::dto::AddressSpec {
            address: entry.address.clone(),
            prefix: entry.prefix,
            mask: entry.mask.clone(),
        })
        .collect()
}

pub fn request_from(info: &AdapterInfo) -> ApplyRequest {
    ApplyRequest {
        adapter_id: info.id.clone(),
        dhcp: info.dhcp_enabled,
        addresses: current_addresses(info),
        gateway: info.ipv4.gateway.clone(),
        gateway_metric: info.ipv4.gateway_metric,
        dns_mode: if info.dns.source == "static" && !info.dns.servers.is_empty() {
            DnsMode::Static
        } else {
            DnsMode::Dhcp
        },
        dns: info.dns.servers.clone(),
        metric: info.metric,
        no_rollback: false,
    }
}

pub fn request_from_backup(backup: &AdapterBackup) -> ApplyRequest {
    ApplyRequest {
        adapter_id: backup.adapter_id.clone(),
        dhcp: backup.dhcp,
        addresses: backup.addresses.clone(),
        gateway: backup.gateway.clone(),
        gateway_metric: backup.gateway_metric,
        dns_mode: backup.dns_mode,
        dns: backup.dns.clone(),
        metric: backup.metric,
        no_rollback: true,
    }
}

fn describe_addresses(specs: &[crate::dto::AddressSpec]) -> String {
    if specs.is_empty() {
        return "无".to_string();
    }
    specs
        .iter()
        .map(|spec| format!("{}/{}", spec.address, spec.prefix))
        .collect::<Vec<String>>()
        .join(", ")
}

/// Other adapters' addresses, used to detect conflicts before writing.
fn peer_addresses(exclude: &str) -> Vec<(String, Vec<String>)> {
    adapters::list()
        .unwrap_or_default()
        .into_iter()
        .filter(|adapter| !adapter.id.eq_ignore_ascii_case(exclude))
        .map(|adapter| {
            (
                adapter.name.clone(),
                adapter
                    .ipv4
                    .addresses
                    .iter()
                    .map(|entry| entry.address.clone())
                    .collect(),
            )
        })
        .collect()
}

pub fn test_only_peer_addresses(exclude: &str) -> Vec<(String, Vec<String>)> {
    peer_addresses(exclude)
}

pub fn validate_request(info: &AdapterInfo, request: &ApplyRequest) -> Vec<ValidationIssue> {
    subnet::validate(
        request.dhcp,
        &request.addresses,
        request.gateway.as_deref(),
        if request.dns_mode == DnsMode::Static {
            &request.dns
        } else {
            &[]
        },
        &peer_addresses(&info.id),
    )
}

pub fn plan(request: &ApplyRequest) -> AppResult<ApplyPlan> {
    let info = adapters::get(&request.adapter_id)?;
    let issues = validate_request(&info, request);
    let mut changes: Vec<ChangeItem> = Vec::new();

    let before_mode = if info.dhcp_enabled { "自动获取（DHCP）" } else { "手动设置" };
    let after_mode = if request.dhcp { "自动获取（DHCP）" } else { "手动设置" };
    if before_mode != after_mode {
        changes.push(ChangeItem {
            field: "dhcp".to_string(),
            label: "获取方式".to_string(),
            from: before_mode.to_string(),
            to: after_mode.to_string(),
        });
    }

    if !request.dhcp {
        let before = describe_addresses(&current_addresses(&info));
        let after = describe_addresses(&request.addresses);
        if before != after {
            changes.push(ChangeItem {
                field: "addresses".to_string(),
                label: "IP 地址 / 子网掩码".to_string(),
                from: before,
                to: after,
            });
        }
        let before_gateway = info.ipv4.gateway.clone().unwrap_or_else(|| "无".to_string());
        let after_gateway = request
            .gateway
            .clone()
            .filter(|text| !text.trim().is_empty())
            .unwrap_or_else(|| "无".to_string());
        if before_gateway != after_gateway {
            changes.push(ChangeItem {
                field: "gateway".to_string(),
                label: "默认网关".to_string(),
                from: before_gateway,
                to: after_gateway,
            });
        }
    }

    let before_dns = format!(
        "{}{}",
        if info.dns.source == "static" { "" } else { "（自动）" },
        info.dns.servers.join(", ")
    );
    let after_dns = match request.dns_mode {
        DnsMode::Dhcp => "（自动获取）".to_string(),
        DnsMode::Static => request.dns.join(", "),
    };
    if before_dns.trim() != after_dns.trim() {
        changes.push(ChangeItem {
            field: "dns".to_string(),
            label: "DNS 服务器".to_string(),
            from: if before_dns.is_empty() { "无".to_string() } else { before_dns },
            to: if after_dns.is_empty() { "无".to_string() } else { after_dns },
        });
    }

    let before_metric = info
        .metric
        .map(|value| value.to_string())
        .unwrap_or_else(|| "自动".to_string());
    let after_metric = request
        .metric
        .map(|value| value.to_string())
        .unwrap_or_else(|| "自动".to_string());
    if before_metric != after_metric {
        changes.push(ChangeItem {
            field: "metric".to_string(),
            label: "接口跃点数".to_string(),
            from: before_metric,
            to: after_metric,
        });
    }

    Ok(ApplyPlan {
        adapter_id: info.id.clone(),
        adapter_name: info.name.clone(),
        dhcp: request.dhcp,
        changes,
        warnings: issues
            .iter()
            .filter(|issue| issue.level == "warning")
            .map(|issue| issue.message.clone())
            .collect(),
        errors: issues
            .iter()
            .filter(|issue| issue.level == "error")
            .map(|issue| issue.message.clone())
            .collect(),
        is_elevated: elevation::is_elevated(),
    })
}

fn sets_equal(left: &[String], right: &[String]) -> bool {
    let mut a: Vec<String> = left.iter().map(|item| item.to_lowercase()).collect();
    let mut b: Vec<String> = right.iter().map(|item| item.to_lowercase()).collect();
    a.sort();
    b.sort();
    a == b
}

fn compare(target: &AdapterInfo, request: &ApplyRequest) -> Vec<String> {
    let mut mismatches: Vec<String> = Vec::new();

    // Manually configured addresses - not the DHCP registry flag - define the
    // effective mode: Windows keeps the DHCP flag set on adapters whose Wi-Fi
    // profile still requests an address automatically, while the manual
    // addresses take precedence in the stack.
    let actual_manual: Vec<String> = target
        .ipv4
        .addresses
        .iter()
        .filter(|entry| entry.origin == "manual")
        .map(|entry| format!("{}/{}", entry.address, entry.prefix))
        .collect();

    if request.dhcp {
        if !actual_manual.is_empty() {
            mismatches.push(format!(
                "仍存在手动配置的地址：[{}]",
                actual_manual.join(", ")
            ));
        }
    } else {
        let expected: Vec<String> = request
            .addresses
            .iter()
            .map(|spec| format!("{}/{}", spec.address, spec.prefix))
            .collect();
        if !sets_equal(&expected, &actual_manual) {
            mismatches.push(format!(
                "IP 地址不一致：期望 [{}]，实际手动地址 [{}]",
                expected.join(", "),
                if actual_manual.is_empty() {
                    "无".to_string()
                } else {
                    actual_manual.join(", ")
                }
            ));
        }

        let expected_gateway = request
            .gateway
            .clone()
            .filter(|text| !text.trim().is_empty());
        if expected_gateway != target.ipv4.gateway {
            mismatches.push(format!(
                "默认网关不一致：期望 {}，实际 {}",
                expected_gateway.unwrap_or_else(|| "无".to_string()),
                target
                    .ipv4
                    .gateway
                    .clone()
                    .unwrap_or_else(|| "无".to_string())
            ));
        }
    }

    if request.dns_mode == DnsMode::Static {
        let expected: Vec<String> = request
            .dns
            .iter()
            .filter(|server| !server.trim().is_empty())
            .cloned()
            .collect();
        if !expected.is_empty() && !sets_equal(&expected, &target.dns.servers) {
            mismatches.push(format!(
                "DNS 服务器不一致：期望 [{}]，实际 [{}]",
                expected.join(", "),
                target.dns.servers.join(", ")
            ));
        }
        if target.dns.source != "static" {
            mismatches.push("DNS 仍处于自动获取状态".to_string());
        }
    }

    match request.metric {
        Some(metric) => {
            if target.metric != Some(metric) {
                mismatches.push(format!(
                    "接口跃点数不一致：期望 {metric}，实际 {}",
                    target
                        .metric
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "自动".to_string())
                ));
            }
        }
        None => {
            if target.metric.is_some() {
                mismatches.push(format!(
                    "接口跃点数未恢复为自动：实际 {}",
                    target
                        .metric
                        .map(|value| value.to_string())
                        .unwrap_or_default()
                ));
            }
        }
    }

    mismatches
}

/// Polls the adapter until the requested state shows up or the timeout expires.
fn verify(adapter_id: &str, request: &ApplyRequest) -> (bool, Vec<String>, Option<AdapterInfo>) {
    let deadline = Instant::now() + VERIFY_TIMEOUT;
    let mut last_mismatches: Vec<String> = vec!["尚未读取到网卡状态".to_string()];
    let mut last_info: Option<AdapterInfo> = None;
    loop {
        match adapters::get(adapter_id) {
            Ok(info) => {
                let mismatches = compare(&info, request);
                last_info = Some(info);
                if mismatches.is_empty() {
                    return (true, Vec::new(), last_info);
                }
                last_mismatches = mismatches;
            }
            Err(err) => {
                last_mismatches = vec![err.to_string()];
            }
        }
        if Instant::now() >= deadline {
            return (false, last_mismatches, last_info);
        }
        sleep(VERIFY_INTERVAL);
    }
}

pub fn apply(request: &ApplyRequest) -> AppResult<crate::dto::ApplyResult> {
    elevation::require_elevation("修改网卡配置")?;
    let before = adapters::get(&request.adapter_id)?;
    let issues = validate_request(&before, request);
    if let Some(error) = issues.iter().find(|issue| issue.level == "error") {
        return Err(AppError::invalid(error.message.clone()).hint("请修正后再次提交"));
    }

    let backup = backup_of(&before);
    let mut steps = cleanup_steps(&before.name, &before, request);
    steps.extend(build_steps(&before, request));

    let mut results: Vec<StepResult> = Vec::new();
    for step in &steps {
        let result = run_step(step);
        let ok = result.ok;
        results.push(result);
        if !ok {
            break;
        }
    }

    let (verified, mismatches, adapter) = verify(&before.id, request);
    let mut rollback_performed = false;
    let mut rollback_message: Option<String> = None;

    if !verified && !request.no_rollback {
        let rollback_request = request_from_backup(&backup);
        let current = adapters::get(&before.id).unwrap_or_else(|_| before.clone());
        let rollback_steps = build_steps(&current, &rollback_request);
        let mut failures: Vec<String> = Vec::new();
        for step in &rollback_steps {
            let result = run_step(step);
            if !result.ok {
                failures.push(format!("{}：{}", result.label, result.message));
            }
        }
        rollback_performed = true;
        rollback_message = Some(if failures.is_empty() {
            "已恢复修改前的配置".to_string()
        } else {
            format!("回滚未完全成功：{}", failures.join("；"))
        });
    }

    let final_adapter = adapters::get(&before.id).ok().or(adapter);

    Ok(crate::dto::ApplyResult {
        success: verified,
        verified,
        message: if verified {
            "配置已生效并通过读回校验".to_string()
        } else if rollback_performed {
            "配置未通过校验，已尝试恢复原配置".to_string()
        } else {
            "配置未通过校验".to_string()
        },
        steps: results,
        adapter: final_adapter,
        backup: Some(backup),
        rollback_performed,
        rollback_message,
        mismatches,
    })
}

/// Applies the request but tolerates verification failure (used by the
/// acceptance harness and by "apply and keep" flows).
pub fn apply_unverified(request: &ApplyRequest) -> AppResult<crate::dto::ApplyResult> {
    let mut tolerant = request.clone();
    tolerant.no_rollback = true;
    apply(&tolerant)
}

/// Captures the current configuration of an adapter by id.
pub fn backup_of_id(adapter_id: &str) -> AppResult<AdapterBackup> {
    Ok(backup_of(&adapters::get(adapter_id)?))
}
