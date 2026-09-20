//! Registry view of interface state: DHCP flag, static/DHCP values, interface
//! metric, MAC override and the machine identity stored by the network stack.

use winreg::enums::{HKEY_LOCAL_MACHINE, KEY_READ, KEY_SET_VALUE};
use winreg::RegKey;

use crate::error::{AppError, AppResult, ErrorCode};
use crate::net::format_mac_string;

pub const TCPIP_INTERFACES: &str = r"SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces";
pub const TCPIP_PARAMETERS: &str = r"SYSTEM\CurrentControlSet\Services\Tcpip\Parameters";
pub const NET_CLASS: &str =
    r"SYSTEM\CurrentControlSet\Control\Class\{4d36e972-e325-11ce-bfc1-08002be10318}";
pub const ACTIVE_COMPUTER_NAME: &str = r"SYSTEM\CurrentControlSet\Control\ComputerName\ActiveComputerName";
pub const PENDING_COMPUTER_NAME: &str = r"SYSTEM\CurrentControlSet\Control\ComputerName\ComputerName";

/// `CONFIGFLAG_DISABLED` as written by Device Manager into the driver key.
pub const CONFIGFLAG_DISABLED: u32 = 0x0000_0001;

#[derive(Debug, Clone, Default)]
pub struct InterfaceRegistry {
    pub enable_dhcp: Option<bool>,
    pub static_addresses: Vec<String>,
    pub static_masks: Vec<String>,
    pub static_gateways: Vec<String>,
    pub static_dns: Vec<String>,
    pub dhcp_address: Option<String>,
    pub interface_metric: Option<u32>,
    pub domain: Option<String>,
    /// `NameServer` holds the static DNS list; empty means "from DHCP".
    pub name_server: Option<String>,
}

fn local_machine() -> RegKey {
    RegKey::predef(HKEY_LOCAL_MACHINE)
}

fn get_multi(key: &RegKey, name: &str) -> Vec<String> {
    if let Ok(list) = key.get_value::<Vec<String>, _>(name) {
        return list
            .into_iter()
            .map(|item| item.trim().to_string())
            .filter(|item| !item.is_empty())
            .collect();
    }
    if let Ok(single) = key.get_value::<String, _>(name) {
        return single
            .split([',', ' ', ';'])
            .map(|item| item.trim().to_string())
            .filter(|item| !item.is_empty())
            .collect();
    }
    Vec::new()
}

fn get_text(key: &RegKey, name: &str) -> Option<String> {
    key.get_value::<String, _>(name)
        .ok()
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
}

fn get_u32(key: &RegKey, name: &str) -> Option<u32> {
    if let Ok(value) = key.get_value::<u32, _>(name) {
        return Some(value);
    }
    get_text(key, name).and_then(|text| text.parse::<u32>().ok())
}

pub fn read_interface(guid: &str) -> InterfaceRegistry {
    let path = format!("{TCPIP_INTERFACES}\\{guid}");
    let Ok(key) = local_machine().open_subkey_with_flags(&path, KEY_READ) else {
        return InterfaceRegistry::default();
    };
    InterfaceRegistry {
        enable_dhcp: get_u32(&key, "EnableDHCP").map(|value| value == 1),
        static_addresses: get_multi(&key, "IPAddress"),
        static_masks: get_multi(&key, "SubnetMask"),
        static_gateways: get_multi(&key, "DefaultGateway"),
        static_dns: get_multi(&key, "NameServer"),
        dhcp_address: get_text(&key, "DhcpIPAddress"),
        interface_metric: get_u32(&key, "InterfaceMetric"),
        domain: get_text(&key, "Domain"),
        name_server: get_text(&key, "NameServer"),
    }
}

/// Finds the driver key (`...\Class\{4d36e972-...}\0007`) owning a NetCfg GUID.
pub fn class_subkey_for(guid: &str) -> Option<String> {
    let class = local_machine().open_subkey_with_flags(NET_CLASS, KEY_READ).ok()?;
    for name in class.enum_keys().flatten() {
        if name.len() != 4 {
            continue;
        }
        let Ok(subkey) = class.open_subkey_with_flags(&name, KEY_READ) else {
            continue;
        };
        if let Some(value) = get_text(&subkey, "NetCfgInstanceId") {
            if value.trim_matches('{').trim_matches('}').eq_ignore_ascii_case(
                guid.trim_matches('{').trim_matches('}'),
            ) {
                return Some(format!("{NET_CLASS}\\{name}"));
            }
        }
    }
    None
}

pub fn read_driver_value(guid: &str, value_name: &str) -> Option<String> {
    let key_path = class_subkey_for(guid)?;
    let key = local_machine().open_subkey_with_flags(&key_path, KEY_READ).ok()?;
    get_text(&key, value_name)
}

pub fn read_config_flags(guid: &str) -> Option<u32> {
    let key_path = class_subkey_for(guid)?;
    let key = local_machine().open_subkey_with_flags(&key_path, KEY_READ).ok()?;
    get_u32(&key, "ConfigFlags")
}

pub fn is_device_disabled(guid: &str) -> bool {
    read_config_flags(guid)
        .map(|flags| flags & CONFIGFLAG_DISABLED == CONFIGFLAG_DISABLED)
        .unwrap_or(false)
}

/// The `NetworkAddress` override, when a user changed the MAC previously.
pub fn read_network_address(guid: &str) -> Option<String> {
    let raw = read_driver_value(guid, "NetworkAddress")?;
    format_mac_string(&raw)
}

/// Writes (or clears) the `NetworkAddress` override. Requires elevation.
pub fn write_network_address(guid: &str, mac: Option<&str>) -> AppResult<()> {
    let key_path = class_subkey_for(guid).ok_or_else(|| {
        AppError::new(
            ErrorCode::NotFound,
            "未能在注册表中找到该网卡的驱动键，无法修改 MAC 地址",
        )
        .detail(guid.to_string())
    })?;
    let key = local_machine()
        .open_subkey_with_flags(&key_path, KEY_SET_VALUE)
        .map_err(|err| {
            AppError::new(ErrorCode::NotElevated, "无法写入网卡驱动键（需要管理员权限）")
                .detail(format!("{key_path}：{err}"))
        })?;

    match mac {
        Some(value) => {
            let normalized = format_mac_string(value).ok_or_else(|| {
                AppError::invalid(format!("MAC 地址格式不正确：{value}"))
            })?;
            // Drivers accept the value without separators.
            let compact: String = normalized.chars().filter(|c| *c != '-').collect();
            key.set_value("NetworkAddress", &compact).map_err(|err| {
                AppError::new(ErrorCode::CommandFailed, "写入 MAC 地址失败")
                    .detail(format!("{key_path}：{err}"))
            })?;
        }
        None => {
            match key.delete_value("NetworkAddress") {
                Ok(()) => {}
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
                Err(err) => {
                    return Err(AppError::new(ErrorCode::CommandFailed, "清除 MAC 地址失败")
                        .detail(format!("{key_path}：{err}")));
                }
            }
        }
    }
    Ok(())
}

pub fn active_computer_name() -> Option<String> {
    let key = local_machine()
        .open_subkey_with_flags(ACTIVE_COMPUTER_NAME, KEY_READ)
        .ok()?;
    get_text(&key, "ComputerName")
}

pub fn pending_computer_name() -> Option<String> {
    let key = local_machine()
        .open_subkey_with_flags(PENDING_COMPUTER_NAME, KEY_READ)
        .ok()?;
    get_text(&key, "ComputerName")
}

pub fn hostname() -> Option<String> {
    let key = local_machine()
        .open_subkey_with_flags(TCPIP_PARAMETERS, KEY_READ)
        .ok()?;
    get_text(&key, "Hostname").or_else(|| get_text(&key, "NV Hostname"))
}

pub fn domain() -> Option<String> {
    let key = local_machine()
        .open_subkey_with_flags(TCPIP_PARAMETERS, KEY_READ)
        .ok()?;
    get_text(&key, "Domain")
}

pub fn workgroup_or_domain() -> Option<String> {
    let key = local_machine()
        .open_subkey_with_flags(TCPIP_PARAMETERS, KEY_READ)
        .ok()?;
    get_text(&key, "Domain").or_else(|| get_text(&key, "NV Domain"))
}
