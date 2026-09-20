//! Machine identity: computer name, workgroup/domain and MAC address changes.

use std::thread::sleep;
use std::time::Duration;

use windows::core::PCWSTR;
use windows::Win32::NetworkManagement::NetManagement::{
    NetApiBufferFree, NetGetJoinInformation, NetJoinDomain, NETSETUP_JOIN_DOMAIN,
    NETSETUP_JOIN_STATUS, NetSetupDomainName,
};
use windows::Win32::System::SystemInformation::{
    SetComputerNameExW, ComputerNamePhysicalDnsHostname, ComputerNamePhysicalNetBIOS,
};

use crate::dto::{AdapterInfo, IdentityInfo};
use crate::error::{AppError, AppResult, ErrorCode};
use crate::net::{adapters, device, elevation, parse_mac_bytes, registry};

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

fn join_state() -> (Option<String>, bool) {
    unsafe {
        let mut buffer = windows::core::PWSTR::null();
        let mut status = NETSETUP_JOIN_STATUS(0);
        if NetGetJoinInformation(PCWSTR::null(), &mut buffer, &mut status) != 0 {
            return (None, false);
        }
        let name = crate::net::pwstr_to_string(buffer);
        let is_domain = status == NetSetupDomainName;
        if !buffer.is_null() {
            let _ = NetApiBufferFree(Some(buffer.0 as *const core::ffi::c_void));
        }
        (Some(name), is_domain)
    }
}

pub fn info() -> IdentityInfo {
    let active = registry::active_computer_name()
        .or_else(registry::hostname)
        .unwrap_or_else(|| "UNKNOWN".to_string());
    let pending = registry::pending_computer_name();
    let reboot_required = pending
        .as_deref()
        .map(|value| !value.eq_ignore_ascii_case(&active))
        .unwrap_or(false);
    let (joined_name, part_of_domain) = join_state();
    let fallback = registry::workgroup_or_domain();

    IdentityInfo {
        computer_name: active,
        pending_computer_name: pending,
        workgroup: if part_of_domain {
            None
        } else {
            joined_name.clone().or(fallback.clone())
        },
        domain: if part_of_domain {
            joined_name.or(fallback)
        } else {
            None
        },
        part_of_domain,
        reboot_required,
    }
}

fn validate_netbios_name(name: &str) -> AppResult<()> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.len() > 15 {
        return Err(AppError::invalid(
            "计算机名长度必须在 1-15 个字符之间（NetBIOS 限制）",
        ));
    }
    if !trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err(AppError::invalid("计算机名只能包含字母、数字和连字符"));
    }
    if trimmed.chars().all(|c| c.is_ascii_digit()) {
        return Err(AppError::invalid("计算机名不能全部由数字组成"));
    }
    Ok(())
}

pub fn set_computer_name(name: &str) -> AppResult<()> {
    elevation::require_elevation("修改计算机名")?;
    validate_netbios_name(name)?;
    let value = wide(name.trim());
    unsafe {
        SetComputerNameExW(ComputerNamePhysicalDnsHostname, PCWSTR(value.as_ptr())).map_err(
            |err| {
                AppError::new(ErrorCode::CommandFailed, "修改计算机名失败")
                    .detail(err.to_string())
            },
        )?;
        // The NetBIOS name is truncated to 15 characters; ignore failures there.
        let _ = SetComputerNameExW(ComputerNamePhysicalNetBIOS, PCWSTR(value.as_ptr()));
    }
    Ok(())
}

pub fn set_workgroup(name: &str) -> AppResult<()> {
    elevation::require_elevation("修改工作组")?;
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.len() > 15 {
        return Err(AppError::invalid("工作组名称长度必须在 1-15 个字符之间"));
    }
    let value = wide(trimmed);
    let code = unsafe {
        NetJoinDomain(
            PCWSTR::null(),
            PCWSTR(value.as_ptr()),
            PCWSTR::null(),
            PCWSTR::null(),
            PCWSTR::null(),
            NETSETUP_JOIN_DOMAIN,
        )
    };
    if code != 0 {
        return Err(AppError::new(ErrorCode::CommandFailed, "修改工作组失败")
            .detail(format!("NetJoinDomain 返回 {code}"))
            .hint("请确认工作组名称正确，且当前账户具备相应权限"));
    }
    Ok(())
}

pub fn validate_mac(mac: &str) -> AppResult<[u8; 6]> {
    let bytes = parse_mac_bytes(mac)
        .ok_or_else(|| AppError::invalid("MAC 地址需要 12 位十六进制字符，例如 AA-BB-CC-DD-EE-FF"))?;
    if bytes.iter().all(|byte| *byte == 0) || bytes.iter().all(|byte| *byte == 0xFF) {
        return Err(AppError::invalid("MAC 地址不能全为 0 或全为 FF"));
    }
    if bytes[0] & 0x01 == 0x01 {
        return Err(AppError::invalid(
            "该地址的组播位被置位，不能作为单播网卡地址（第一字节最低位应为偶数）",
        ));
    }
    Ok(bytes)
}

/// Writes the `NetworkAddress` override and restarts the adapter so the driver
/// picks it up. Passing `None` clears the override.
pub fn change_mac(adapter_id: &str, mac: Option<&str>) -> AppResult<AdapterInfo> {
    elevation::require_elevation("修改 MAC 地址")?;
    let info = adapters::get(adapter_id)?;
    if let Some(value) = mac {
        validate_mac(value)?;
    }
    registry::write_network_address(adapter_id, mac)?;

    // Restart the device so the driver re-reads NetworkAddress.
    let mut updated = adapters::get(adapter_id)?;
    if info.enabled && device::set_enabled(adapter_id, false).is_ok() {
        sleep(Duration::from_millis(1200));
        let _ = device::set_enabled(adapter_id, true);
        sleep(Duration::from_millis(1600));
        updated = adapters::get(adapter_id)?;
    }

    // Some drivers (Intel Wi-Fi among them) ignore the soft cycle; rebuild the
    // device stack instead and re-read.
    if !override_applied(mac, &updated) {
        if let Some(instance_id) = updated.device_instance_id.clone() {
            if device::restart_device(&instance_id).is_ok() {
                // The device disappears from the adapter list while it restarts.
                let deadline = std::time::Instant::now() + Duration::from_secs(15);
                loop {
                    sleep(Duration::from_millis(800));
                    if let Ok(adapter) = adapters::get(adapter_id) {
                        updated = adapter;
                        if override_applied(mac, &updated) || std::time::Instant::now() >= deadline {
                            break;
                        }
                    }
                    if std::time::Instant::now() >= deadline {
                        break;
                    }
                }
            }
        }
    }
    Ok(updated)
}

/// True when the effective MAC or the recorded override matches the request.
fn override_applied(requested: Option<&str>, adapter: &AdapterInfo) -> bool {
    let Some(expected) = requested else {
        return true; // clearing the override cannot be verified against hardware
    };
    let Some(expected) = crate::net::format_mac_string(expected) else {
        return false;
    };
    adapter.mac.eq_ignore_ascii_case(&expected)
        || adapter
            .mac_override
            .as_deref()
            .map(|value| value.eq_ignore_ascii_case(&expected))
            .unwrap_or(false)
}
