//! Toolbox scanner: ARP (SendARP), ICMP (IcmpSendEcho) and system `ping.exe`
//! probes, with bounded concurrency, cancellation and progress events.

use std::collections::HashMap;
use std::os::windows::process::CommandExt;
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use once_cell::sync::Lazy;
use tauri::{AppHandle, Emitter};

use windows::Win32::Foundation::NO_ERROR;
use windows::Win32::NetworkManagement::IpHelper::{
    IcmpCloseHandle, IcmpCreateFile, IcmpSendEcho, ICMP_ECHO_REPLY, SendARP,
};

use crate::dto::{PingMode, PingProgress, PingRequest, PingResult};
use crate::error::{AppError, AppResult, ErrorCode};
use crate::net::{adapters, format_mac};
use crate::subnet;

pub const PROGRESS_EVENT: &str = "ping://progress";
const MAX_TARGETS: usize = 4096;

static JOBS: Lazy<Mutex<HashMap<String, Arc<AtomicBool>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

fn create_no_window() -> u32 {
    0x0800_0000
}

// ---------------------------------------------------------------------------
// Target expansion (pure)
// ---------------------------------------------------------------------------

/// Expands user input into a probe list. Accepts single addresses, comma or
/// space separated lists, `192.168.1.0/24` subnets and `192.168.1.10-20`
/// (or full `x.x.x.x-y.y.y.y`) ranges. Returns `(targets, errors)`.
pub fn expand_targets(spec: &str, max: usize) -> (Vec<String>, Vec<String>) {
    let mut targets: Vec<String> = Vec::new();
    let mut errors: Vec<String> = Vec::new();

    for raw in spec.split(['\n', ',', ';', ' ', '\t', '，', '；']) {
        let token = raw.trim();
        if token.is_empty() {
            continue;
        }

        if let Some((base, prefix_text)) = token.split_once('/') {
            match (subnet::parse_ipv4(base), prefix_text.trim().parse::<u32>()) {
                (Some(ip), Ok(prefix)) if (8..=32).contains(&prefix) => {
                    let mask = subnet::mask_from_prefix(prefix).unwrap_or(0xFFFFFF00);
                    let network = subnet::network_address(ip, mask);
                    let broadcast = subnet::broadcast_address(ip, mask);
                    let mut current = network;
                    loop {
                        // /31 and /32 have no network/broadcast reservation (RFC 3021).
                        let edge = current == network || current == broadcast;
                        if prefix >= 31 || !edge {
                            targets.push(subnet::format_ipv4(current));
                            if targets.len() > max {
                                errors.push(format!("目标数量超过上限 {max}，已截断"));
                                return (targets, errors);
                            }
                        }
                        if current == broadcast {
                            break;
                        }
                        current += 1;
                    }
                }
                (None, _) => errors.push(format!("网段中的 IP 不合法：{token}")),
                (_, Ok(_)) => {
                    errors.push(format!("仅支持 /8 - /32 的网段：{token}"));
                }
                _ => errors.push(format!("无法识别的网段：{token}")),
            }
            continue;
        }

        if let Some((start_text, end_text)) = token.split_once('-') {
            let start = subnet::parse_ipv4(start_text);
            let end = if end_text.contains('.') {
                subnet::parse_ipv4(end_text)
            } else {
                start.and_then(|value| {
                    end_text
                        .trim()
                        .parse::<u32>()
                        .ok()
                        .filter(|octet| *octet <= 255)
                        .map(|octet| (value & 0xFFFF_FF00) | octet)
                })
            };
            match (start, end) {
                (Some(first), Some(last)) if first <= last => {
                    let mut current = first;
                    loop {
                        targets.push(subnet::format_ipv4(current));
                        if targets.len() > max {
                            errors.push(format!("目标数量超过上限 {max}，已截断"));
                            return (targets, errors);
                        }
                        if current == last {
                            break;
                        }
                        current += 1;
                    }
                }
                (Some(_), Some(_)) => errors.push(format!("地址范围起点大于终点：{token}")),
                _ => errors.push(format!("无法识别的地址范围：{token}")),
            }
            continue;
        }

        match subnet::parse_ipv4(token) {
            Some(_) => targets.push(token.to_string()),
            None => errors.push(format!("无法识别的地址：{token}")),
        }
    }

    (targets, errors)
}

// ---------------------------------------------------------------------------
// Probe results (pure aggregation)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Default)]
pub struct ProbeOutcome {
    pub alive: bool,
    pub rtt_ms: Option<u32>,
    pub mac: Option<String>,
    pub error: Option<String>,
}

pub fn empty_result(target: &str, is_local: bool) -> PingResult {
    PingResult {
        target: target.to_string(),
        alive: false,
        rtt_ms: None,
        rtt_max_ms: None,
        mac: None,
        is_local,
        sent: 0,
        received: 0,
        error: None,
    }
}

/// Folds one probe into an accumulated result: counts packets, keeps the
/// fastest/slowest round trip and remembers the first MAC seen.
pub fn merge_probe(entry: &mut PingResult, outcome: &ProbeOutcome) {
    entry.sent += 1;
    if outcome.alive {
        entry.alive = true;
        entry.received += 1;
        entry.error = None;
        if let Some(rtt) = outcome.rtt_ms {
            entry.rtt_ms = Some(entry.rtt_ms.map_or(rtt, |current| current.min(rtt)));
            entry.rtt_max_ms = Some(entry.rtt_max_ms.map_or(rtt, |current| current.max(rtt)));
        }
    } else if entry.error.is_none() {
        entry.error = outcome.error.clone();
    }
    if entry.mac.is_none() {
        if let Some(mac) = &outcome.mac {
            entry.mac = Some(mac.clone());
        }
    }
}

pub fn summarise(results: &[PingResult]) -> (u32, u32) {
    let alive = results.iter().filter(|entry| entry.alive).count() as u32;
    (results.len() as u32, alive)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expands_subnets() {
        let (targets, errors) = expand_targets("192.168.1.0/30", MAX_TARGETS);
        assert!(errors.is_empty());
        assert_eq!(targets, vec!["192.168.1.1".to_string(), "192.168.1.2".to_string()]);

        let (targets, errors) = expand_targets("10.0.0.0/24", MAX_TARGETS);
        assert!(errors.is_empty());
        assert_eq!(targets.len(), 254);
        assert_eq!(targets[0], "10.0.0.1");
        assert_eq!(targets[253], "10.0.0.254");

        let (targets, errors) = expand_targets("10.0.0.0/31", MAX_TARGETS);
        assert!(errors.is_empty(), "{errors:?}");
        assert_eq!(targets.len(), 2);
    }

    #[test]
    fn expands_ranges_and_lists() {
        let (targets, errors) = expand_targets("192.168.1.10-12", MAX_TARGETS);
        assert!(errors.is_empty());
        assert_eq!(targets, vec![
            "192.168.1.10".to_string(),
            "192.168.1.11".to_string(),
            "192.168.1.12".to_string()
        ]);

        let (targets, _) = expand_targets("192.168.1.5-192.168.1.6", MAX_TARGETS);
        assert_eq!(targets.len(), 2);

        let (targets, errors) =
            expand_targets("8.8.8.8, 1.1.1.1 223.5.5.5；192.168.1.1", MAX_TARGETS);
        assert!(errors.is_empty());
        assert_eq!(targets.len(), 4);
        assert_eq!(targets[3], "192.168.1.1");
    }

    #[test]
    fn reports_invalid_targets() {
        let (targets, errors) = expand_targets("not-an-ip,192.168.1.0/33,10.0.0.9-3", MAX_TARGETS);
        assert!(targets.is_empty());
        assert_eq!(errors.len(), 3);
        assert!(errors[0].contains("无法识别"));
        assert!(errors[1].contains("/8 - /32"));
        assert!(errors[2].contains("起点大于终点"));

        let (targets, errors) = expand_targets("10.0.0.0/16", MAX_TARGETS);
        assert_eq!(targets.len(), MAX_TARGETS + 1);
        assert!(errors[0].contains("上限"));
    }

    #[test]
    fn merges_multipass_probes() {
        let mut entry = empty_result("192.168.1.20", false);
        merge_probe(
            &mut entry,
            &ProbeOutcome {
                alive: false,
                rtt_ms: None,
                mac: None,
                error: Some("超时".to_string()),
            },
        );
        assert!(!entry.alive);
        assert_eq!(entry.sent, 1);
        assert_eq!(entry.error.as_deref(), Some("超时"));

        merge_probe(
            &mut entry,
            &ProbeOutcome {
                alive: true,
                rtt_ms: Some(12),
                mac: Some("AA-BB-CC-DD-EE-FF".to_string()),
                error: None,
            },
        );
        merge_probe(
            &mut entry,
            &ProbeOutcome {
                alive: true,
                rtt_ms: Some(4),
                mac: None,
                error: None,
            },
        );
        assert!(entry.alive);
        assert_eq!(entry.sent, 3);
        assert_eq!(entry.received, 2);
        assert_eq!(entry.rtt_ms, Some(4));
        assert_eq!(entry.rtt_max_ms, Some(12));
        assert_eq!(entry.mac.as_deref(), Some("AA-BB-CC-DD-EE-FF"));
        assert!(entry.error.is_none());
    }

    #[test]
    fn summarises_results() {
        let mut alive = empty_result("10.0.0.1", true);
        alive.alive = true;
        let dead = empty_result("10.0.0.2", false);
        let (total, up) = summarise(&[alive, dead]);
        assert_eq!((total, up), (2, 1));
    }

    #[test]
    fn formats_mac_from_arp_bytes() {
        assert_eq!(format_mac(&[0xAA, 0xBB, 0x0C, 0x0D, 0x0E, 0x0F]), "AA-BB-0C-0D-0E-0F");
    }
}

// ---------------------------------------------------------------------------
// Probes
// ---------------------------------------------------------------------------

fn decode_oem(bytes: &[u8]) -> String {
    match std::str::from_utf8(bytes) {
        Ok(text) => text.to_string(),
        Err(_) => encoding_rs::GB18030.decode(bytes).0.to_string(),
    }
}

fn arp_probe(ip: u32) -> ProbeOutcome {
    let started = Instant::now();
    let mut mac_bytes = [0u8; 6];
    let mut length: u32 = 6;
    let status = unsafe {
        SendARP(
            ip,
            0,
            mac_bytes.as_mut_ptr() as *mut core::ffi::c_void,
            &mut length,
        )
    };
    if status == NO_ERROR.0 && length >= 6 {
        ProbeOutcome {
            alive: true,
            rtt_ms: Some(started.elapsed().as_millis() as u32),
            mac: Some(format_mac(&mac_bytes)),
            error: None,
        }
    } else {
        ProbeOutcome {
            alive: false,
            rtt_ms: None,
            mac: None,
            error: Some("ARP 无应答".to_string()),
        }
    }
}

fn icmp_probe(ip: u32, timeout_ms: u32) -> ProbeOutcome {
    unsafe {
        let Ok(handle) = IcmpCreateFile() else {
            return ProbeOutcome {
                error: Some("无法创建 ICMP 句柄（可能权限不足）".to_string()),
                ..Default::default()
            };
        };
        let payload = [0u8; 32];
        let reply_size = std::mem::size_of::<ICMP_ECHO_REPLY>() + payload.len() + 8;
        let mut reply = vec![0u8; reply_size];
        let count = IcmpSendEcho(
            handle,
            ip,
            payload.as_ptr() as *const core::ffi::c_void,
            payload.len() as u16,
            None,
            reply.as_mut_ptr() as *mut core::ffi::c_void,
            reply_size as u32,
            timeout_ms.max(100),
        );
        let outcome = if count == 0 {
            ProbeOutcome {
                error: Some("ICMP 超时".to_string()),
                ..Default::default()
            }
        } else {
            let echo = &*(reply.as_ptr() as *const ICMP_ECHO_REPLY);
            if echo.Status == 0 {
                ProbeOutcome {
                    alive: true,
                    rtt_ms: Some(echo.RoundTripTime),
                    mac: None,
                    error: None,
                }
            } else {
                ProbeOutcome {
                    error: Some(format!("ICMP 状态码 {}", echo.Status)),
                    ..Default::default()
                }
            }
        };
        let _ = IcmpCloseHandle(handle);
        outcome
    }
}

/// Best-effort RTT extraction so the system-ping mode is locale independent in
/// the common cases ("time=12ms", "时间=12ms", "时间<1ms").
pub fn parse_rtt(text: &str) -> Option<u32> {
    let chars: Vec<char> = text.to_lowercase().chars().collect();
    for index in 1..chars.len() {
        if chars[index - 1] == 'm' && chars[index] == 's' {
            let end = index - 1;
            let mut start = end;
            while start > 0 && chars[start - 1].is_ascii_digit() {
                start -= 1;
            }
            if start < end {
                let digits: String = chars[start..end].iter().collect();
                if let Ok(value) = digits.parse::<u32>() {
                    return Some(value);
                }
            }
        }
    }
    None
}

fn system_probe(target: &str, timeout_ms: u32) -> ProbeOutcome {
    match Command::new("ping")
        .args(["-n", "1", "-w", &timeout_ms.to_string(), target])
        .creation_flags(create_no_window())
        .output()
    {
        Ok(output) => {
            let text = decode_oem(&output.stdout);
            if output.status.success() {
                ProbeOutcome {
                    alive: true,
                    rtt_ms: parse_rtt(&text),
                    mac: None,
                    error: None,
                }
            } else {
                ProbeOutcome {
                    error: Some("系统 ping 无应答".to_string()),
                    ..Default::default()
                }
            }
        }
        Err(err) => ProbeOutcome {
            error: Some(format!("无法调用系统 ping：{err}")),
            ..Default::default()
        },
    }
}

pub fn probe(mode: PingMode, target: &str, timeout_ms: u32) -> ProbeOutcome {
    match mode {
        PingMode::System => system_probe(target, timeout_ms),
        PingMode::Arp | PingMode::Icmp => match subnet::parse_ipv4(target) {
            Some(ip) => {
                if mode == PingMode::Arp {
                    arp_probe(ip)
                } else {
                    icmp_probe(ip, timeout_ms)
                }
            }
            None => ProbeOutcome {
                error: Some("地址不合法".to_string()),
                ..Default::default()
            },
        },
    }
}

// ---------------------------------------------------------------------------
// Job management
// ---------------------------------------------------------------------------

fn emit_progress(
    app: &AppHandle,
    job_id: &str,
    total: u32,
    done: u32,
    results: &Arc<Mutex<Vec<PingResult>>>,
    finished: bool,
) {
    let snapshot = results
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_default();
    let alive = snapshot.iter().filter(|entry| entry.alive).count() as u32;
    let payload = PingProgress {
        job_id: job_id.to_string(),
        total,
        done,
        alive,
        results: snapshot,
        finished,
    };
    let _ = app.emit(PROGRESS_EVENT, payload);
}

pub fn cancel(job_id: &str) {
    if let Ok(jobs) = JOBS.lock() {
        if let Some(flag) = jobs.get(job_id) {
            flag.store(true, Ordering::Relaxed);
        }
    }
}

pub fn running_jobs() -> Vec<String> {
    JOBS
        .lock()
        .map(|jobs| jobs.keys().cloned().collect())
        .unwrap_or_default()
}

pub fn start(app: AppHandle, request: PingRequest) -> AppResult<()> {
    if request.targets.is_empty() {
        return Err(AppError::invalid("请先填写要扫描的地址或网段"));
    }
    if request.targets.len() > MAX_TARGETS {
        return Err(AppError::invalid(format!(
            "单次最多扫描 {MAX_TARGETS} 个地址，请缩小范围"
        )));
    }

    let cancel_flag = Arc::new(AtomicBool::new(false));
    {
        let mut jobs = JOBS
            .lock()
            .map_err(|_| AppError::new(ErrorCode::Unknown, "任务注册表不可用"))?;
        if jobs.contains_key(&request.job_id) {
            return Err(AppError::new(ErrorCode::Busy, "该扫描任务已在运行"));
        }
        jobs.insert(request.job_id.clone(), cancel_flag.clone());
    }

    let targets = request.targets.clone();
    let total = targets.len() as u32;
    let job_id = request.job_id.clone();
    let local_addresses: Vec<String> = adapters::list()
        .unwrap_or_default()
        .into_iter()
        .flat_map(|adapter| {
            adapter
                .ipv4
                .addresses
                .into_iter()
                .map(|entry| entry.address)
        })
        .collect();

    let initial: Vec<PingResult> = targets
        .iter()
        .map(|target| {
            let is_local = local_addresses
                .iter()
                .any(|address| address.eq_ignore_ascii_case(target))
                || request
                    .local_ip
                    .as_deref()
                    .map(|address| address.eq_ignore_ascii_case(target))
                    .unwrap_or(false);
            empty_result(target, is_local)
        })
        .collect();

    let results = Arc::new(Mutex::new(initial));
    let done = Arc::new(AtomicU32::new(0));
    let concurrency = request.concurrency.clamp(1, 256) as usize;
    let rounds = if request.multipass {
        request.multipass_rounds.clamp(1, 10)
    } else {
        1
    };
    let mode = request.mode;
    let timeout_ms = request.timeout_ms.clamp(100, 10_000);
    let slow = request.slow;

    tauri::async_runtime::spawn(async move {
        let semaphore = Arc::new(tokio::sync::Semaphore::new(concurrency));
        let mut handles = Vec::with_capacity(targets.len());

        for (index, target) in targets.into_iter().enumerate() {
            let permit_pool = semaphore.clone();
            let cancel = cancel_flag.clone();
            let results = results.clone();
            let done = done.clone();
            let app = app.clone();
            let job_id = job_id.clone();

            handles.push(tauri::async_runtime::spawn(async move {
                let Ok(_permit) = permit_pool.acquire_owned().await else {
                    return;
                };
                if cancel.load(Ordering::Relaxed) {
                    return;
                }
                let target_for_probe = target.clone();
                let outcomes = tauri::async_runtime::spawn_blocking(move || {
                    let mut collected = Vec::with_capacity(rounds as usize);
                    for round in 0..rounds {
                        if cancel.load(Ordering::Relaxed) {
                            break;
                        }
                        if round > 0 && slow {
                            std::thread::sleep(Duration::from_millis(350));
                        }
                        collected.push(probe(mode, &target_for_probe, timeout_ms));
                    }
                    collected
                })
                .await
                .unwrap_or_default();

                {
                    let mut guard = match results.lock() {
                        Ok(guard) => guard,
                        Err(_) => return,
                    };
                    if let Some(entry) = guard.get_mut(index) {
                        for outcome in &outcomes {
                            merge_probe(entry, outcome);
                        }
                    }
                }

                let finished = done.fetch_add(1, Ordering::Relaxed) + 1;
                if slow || finished % 8 == 0 || finished >= total {
                    emit_progress(&app, &job_id, total, finished, &results, false);
                }
            }));
        }

        for handle in handles {
            let _ = handle.await;
        }

        emit_progress(&app, &job_id, total, done.load(Ordering::Relaxed), &results, true);
        if let Ok(mut jobs) = JOBS.lock() {
            jobs.remove(&job_id);
        }
    });

    Ok(())
}

pub fn export_csv(results: &[PingResult]) -> String {
    let mut writer = csv::WriterBuilder::new().from_writer(vec![]);
    let _ = writer.write_record(["地址", "状态", "最小延时(ms)", "最大延时(ms)", "丢包", "MAC", "本机", "说明"]);
    for entry in results {
        let _ = writer.write_record([
            entry.target.clone(),
            if entry.alive { "在线" } else { "无响应" }.to_string(),
            entry.rtt_ms.map(|value| value.to_string()).unwrap_or_default(),
            entry.rtt_max_ms.map(|value| value.to_string()).unwrap_or_default(),
            format!("{}/{}", entry.sent.saturating_sub(entry.received), entry.sent),
            entry.mac.clone().unwrap_or_default(),
            if entry.is_local { "是" } else { "" }.to_string(),
            entry.error.clone().unwrap_or_default(),
        ]);
    }
    let _ = writer.flush();
    let bytes = writer.into_inner().unwrap_or_default();
    String::from_utf8_lossy(&bytes).to_string()
}
