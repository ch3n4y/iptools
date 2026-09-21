//! Device-level operations through SetupAPI: enable/disable an adapter and read
//! the device instance id / disabled flag that the network stack does not expose.

use std::collections::HashMap;

use windows::core::{GUID, PCWSTR};
use windows::Win32::Devices::DeviceAndDriverInstallation::{
    SetupDiCallClassInstaller, SetupDiDestroyDeviceInfoList, SetupDiEnumDeviceInfo,
    SetupDiGetClassDevsW, SetupDiGetDeviceInstanceIdW, SetupDiOpenDevRegKey,
    SetupDiSetClassInstallParamsW, DICS_DISABLE, DICS_ENABLE, DICS_FLAG_CONFIGSPECIFIC,
    DICS_FLAG_GLOBAL, DIF_PROPERTYCHANGE, DIREG_DRV, GUID_DEVCLASS_NET, SETUP_DI_GET_CLASS_DEVS_FLAGS,
    SP_CLASSINSTALL_HEADER, SP_DEVINFO_DATA, SP_PROPCHANGE_PARAMS,
};
use windows::Win32::Foundation::ERROR_SUCCESS;
use windows::Win32::System::Registry::{
    RegCloseKey, RegQueryValueExW, HKEY, KEY_READ, REG_VALUE_TYPE,
};

use crate::error::{AppError, AppResult, ErrorCode};
use crate::net::registry::CONFIGFLAG_DISABLED;

#[derive(Debug, Clone, Default)]
pub struct DeviceEntry {
    pub instance_id: String,
    pub description: String,
    pub disabled: bool,
}

unsafe fn read_reg_raw(hkey: HKEY, name: &str, buffer: &mut [u8], size: &mut u32) -> Option<REG_VALUE_TYPE> {
    let name_wide: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
    let mut kind = REG_VALUE_TYPE(0);
    *size = buffer.len() as u32;
    let status = RegQueryValueExW(
        hkey,
        PCWSTR(name_wide.as_ptr()),
        None,
        Some(&mut kind),
        Some(buffer.as_mut_ptr()),
        Some(size),
    );
    if status != ERROR_SUCCESS {
        return None;
    }
    Some(kind)
}

unsafe fn read_reg_string(hkey: HKEY, name: &str) -> Option<String> {
    let mut buffer = [0u8; 1024];
    let mut size: u32 = 0;
    read_reg_raw(hkey, name, &mut buffer, &mut size)?;
    let bytes = &buffer[..size as usize];
    let mut units: Vec<u16> = Vec::with_capacity(bytes.len() / 2);
    let mut index = 0;
    while index + 1 < bytes.len() {
        units.push(u16::from_le_bytes([bytes[index], bytes[index + 1]]));
        index += 2;
    }
    let end = units.iter().position(|unit| *unit == 0).unwrap_or(units.len());
    Some(String::from_utf16_lossy(&units[..end]))
}

unsafe fn read_reg_dword(hkey: HKEY, name: &str) -> Option<u32> {
    let mut buffer = [0u8; 4];
    let mut size: u32 = 0;
    read_reg_raw(hkey, name, &mut buffer, &mut size)?;
    if size < 4 {
        return None;
    }
    Some(u32::from_le_bytes([buffer[0], buffer[1], buffer[2], buffer[3]]))
}

struct DeviceSet {
    handle: windows::Win32::Devices::DeviceAndDriverInstallation::HDEVINFO,
}

impl Drop for DeviceSet {
    fn drop(&mut self) {
        unsafe {
            let _ = SetupDiDestroyDeviceInfoList(self.handle);
        }
    }
}

fn open_device_set() -> AppResult<DeviceSet> {
    unsafe {
        let handle = SetupDiGetClassDevsW(Some(&GUID_DEVCLASS_NET), PCWSTR::null(), None, SETUP_DI_GET_CLASS_DEVS_FLAGS(0))
        .map_err(|err| {
            AppError::new(ErrorCode::CommandFailed, "无法枚举网络设备")
                .detail(err.to_string())
        })?;
        Ok(DeviceSet { handle })
    }
}

/// Walks every installed network device once and indexes it by NetCfg GUID.
pub fn map_by_net_cfg_id() -> HashMap<String, DeviceEntry> {
    let mut map = HashMap::new();
    let Ok(set) = open_device_set() else {
        return map;
    };
    unsafe {
        let mut index = 0u32;
        loop {
            let mut data = SP_DEVINFO_DATA {
                cbSize: std::mem::size_of::<SP_DEVINFO_DATA>() as u32,
                ClassGuid: GUID::from_u128(0),
                DevInst: 0,
                Reserved: 0,
            };
            if SetupDiEnumDeviceInfo(set.handle, index, &mut data).is_err() {
                break;
            }
            index += 1;

            let mut name_buffer = [0u16; 512];
            let instance_id =
                match SetupDiGetDeviceInstanceIdW(set.handle, &data, Some(&mut name_buffer), None) {
                    Ok(()) => {
                        let end = name_buffer
                            .iter()
                            .position(|unit| *unit == 0)
                            .unwrap_or(name_buffer.len());
                        String::from_utf16_lossy(&name_buffer[..end])
                    }
                    Err(_) => String::new(),
                };

            let dev_key = SetupDiOpenDevRegKey(
                set.handle,
                &data,
                DICS_FLAG_GLOBAL.0,
                0,
                DIREG_DRV,
                KEY_READ.0,
            );

            if let Ok(key) = dev_key {
                let net_cfg_id = read_reg_string(key, "NetCfgInstanceId");
                let config_flags = read_reg_dword(key, "ConfigFlags").unwrap_or(0);
                let _ = RegCloseKey(key);
                // Device Manager does not always leave ConfigFlags behind, so the
                // configuration manager status is authoritative for "disabled".
                let disabled = devnode_status(data.DevInst)
                    .map(|problem| {
                        problem == windows::Win32::Devices::DeviceAndDriverInstallation::CM_PROB_DISABLED
                    })
                    .unwrap_or(config_flags & CONFIGFLAG_DISABLED == CONFIGFLAG_DISABLED);
                if let Some(identifier) = net_cfg_id {
                    if !identifier.trim().is_empty() {
                        map.insert(
                            identifier.trim().to_lowercase(),
                            DeviceEntry {
                                instance_id,
                                description: String::new(),
                                disabled,
                            },
                        );
                    }
                }
            }
        }
    }
    map
}

fn change_state(set: &DeviceSet, data: &SP_DEVINFO_DATA, enable: bool) -> AppResult<()> {
    let state = if enable { DICS_ENABLE } else { DICS_DISABLE };
    let mut last_error: Option<AppError> = None;
    // Device Manager performs both a global and a per-profile change.
    for scope in [DICS_FLAG_GLOBAL, DICS_FLAG_CONFIGSPECIFIC] {
        let params = SP_PROPCHANGE_PARAMS {
            ClassInstallHeader: SP_CLASSINSTALL_HEADER {
                cbSize: std::mem::size_of::<SP_PROPCHANGE_PARAMS>() as u32,
                InstallFunction: DIF_PROPERTYCHANGE,
            },
            StateChange: state,
            Scope: scope,
            HwProfile: 0,
        };
        unsafe {
            if let Err(err) = SetupDiSetClassInstallParamsW(
                set.handle,
                Some(data),
                Some(&params.ClassInstallHeader),
                std::mem::size_of::<SP_PROPCHANGE_PARAMS>() as u32,
            ) {
                last_error = Some(
                    AppError::new(ErrorCode::CommandFailed, "无法设置设备安装参数")
                        .detail(err.to_string()),
                );
                continue;
            }
            if let Err(err) = SetupDiCallClassInstaller(DIF_PROPERTYCHANGE, set.handle, Some(data)) {
                last_error = Some(
                    AppError::new(ErrorCode::CommandFailed, "系统拒绝更改设备状态")
                        .detail(err.to_string()),
                );
                continue;
            }
        }
        last_error = None;
        break;
    }
    match last_error {
        Some(err) => Err(err.hint("请确认程序以管理员身份运行，并且该设备允许被更改状态")),
        None => Ok(()),
    }
}

/// Enables or disables the adapter identified by its NetCfg GUID.
///
/// `pnputil` is tried first: it uses the documented device-state API and works
/// for devices whose class installer rejects `DIF_PROPERTYCHANGE` (Intel Wi-Fi
/// answers that path with ERROR_INVALID_USER_BUFFER). SetupAPI stays as the
/// fallback for systems where pnputil cannot resolve the instance.
pub fn set_enabled(guid: &str, enable: bool) -> AppResult<()> {
    if let Some(entry) = map_by_net_cfg_id().get(&guid.trim().to_lowercase()) {
        if !entry.instance_id.is_empty() && set_enabled_pnputil(&entry.instance_id, enable).is_ok() {
            return Ok(());
        }
    }
    set_enabled_setupapi(guid, enable)
}

fn set_enabled_pnputil(instance_id: &str, enable: bool) -> AppResult<()> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let action = if enable { "/enable-device" } else { "/disable-device" };
    let output = std::process::Command::new(pnputil_executable())
        .args([action, instance_id])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|err| {
            AppError::new(ErrorCode::CommandFailed, "无法调用 pnputil 更改设备状态")
                .detail(err.to_string())
        })?;
    let text = decode_oem(&output.stdout) + &decode_oem(&output.stderr);
    if output.status.success() && !text.to_lowercase().contains("failed") {
        Ok(())
    } else {
        Err(AppError::new(ErrorCode::CommandFailed, "系统拒绝更改设备状态").detail(text))
    }
}

/// SetupAPI based state change (legacy fallback).
fn set_enabled_setupapi(guid: &str, enable: bool) -> AppResult<()> {
    let set = open_device_set()?;
    let target = guid.trim().to_lowercase();
    unsafe {
        let mut index = 0u32;
        loop {
            let mut data = SP_DEVINFO_DATA {
                cbSize: std::mem::size_of::<SP_DEVINFO_DATA>() as u32,
                ClassGuid: GUID::from_u128(0),
                DevInst: 0,
                Reserved: 0,
            };
            if SetupDiEnumDeviceInfo(set.handle, index, &mut data).is_err() {
                break;
            }
            index += 1;
            let Ok(key) = SetupDiOpenDevRegKey(
                set.handle,
                &data,
                DICS_FLAG_GLOBAL.0,
                0,
                DIREG_DRV,
                KEY_READ.0,
            ) else {
                continue;
            };
            let net_cfg_id = read_reg_string(key, "NetCfgInstanceId");
            let _ = RegCloseKey(key);
            let Some(identifier) = net_cfg_id else {
                continue;
            };
            if identifier.trim().to_lowercase() != target {
                continue;
            }
            return change_state(&set, &data, enable);
        }
    }
    Err(AppError::new(
        ErrorCode::AdapterNotFound,
        "未找到该网卡对应的系统设备，无法启用或禁用",
    )
    .detail(guid.to_string()))
}


/// Problem code reported by the configuration manager for a device node.
fn devnode_status(devinst: u32) -> Option<windows::Win32::Devices::DeviceAndDriverInstallation::CM_PROB> {
    use windows::Win32::Devices::DeviceAndDriverInstallation::{
        CM_DEVNODE_STATUS_FLAGS, CM_Get_DevNode_Status, CR_SUCCESS,
    };
    let mut status = CM_DEVNODE_STATUS_FLAGS(0);
    let mut problem = windows::Win32::Devices::DeviceAndDriverInstallation::CM_PROB(0);
    let result = unsafe { CM_Get_DevNode_Status(&mut status, &mut problem, devinst, 0) };
    if result == CR_SUCCESS {
        Some(problem)
    } else {
        None
    }
}

/// Absolute path so a same-named file next to the executable can never be
/// executed instead of the system tool.
fn pnputil_executable() -> std::path::PathBuf {
    let root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_string());
    std::path::Path::new(&root)
        .join("System32")
        .join("pnputil.exe")
}

fn decode_oem(bytes: &[u8]) -> String {
    match std::str::from_utf8(bytes) {
        Ok(text) => text.to_string(),
        Err(_) => encoding_rs::GB18030.decode(bytes).0.to_string(),
    }
}

/// Restarts a device instance through `pnputil`.
///
/// A soft disable/enable cycle is enough for most drivers, but some (notably
/// Intel Wi-Fi) only re-read `NetworkAddress` when the device stack is rebuilt,
/// so the MAC write path falls back to this.
pub fn restart_device(instance_id: &str) -> AppResult<()> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let output = std::process::Command::new(pnputil_executable())
        .args(["/restart-device", instance_id])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|err| {
            AppError::new(ErrorCode::CommandFailed, "无法调用 pnputil 重启设备")
                .detail(err.to_string())
        })?;
    if output.status.success() {
        Ok(())
    } else {
        Err(
            AppError::new(ErrorCode::CommandFailed, "设备重启失败")
                .detail(decode_oem(&output.stdout) + &decode_oem(&output.stderr)),
        )
    }
}
