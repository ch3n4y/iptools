//! Adapter enumeration and the read-back used to verify writes.
//!
//! Data comes from `GetAdaptersAddresses` (addresses, gateway, DNS, status),
//! `GetIfEntry2` (media connect state, permanent MAC), `GetIpInterfaceEntry`
//! (metric) and the registry (DHCP flag, MAC override, device state).

use windows::Win32::Foundation::{ERROR_BUFFER_OVERFLOW, NO_ERROR};
use windows::Win32::NetworkManagement::IpHelper::{
    GetAdaptersAddresses, GetIfEntry2, GetIpInterfaceEntry, SetIpInterfaceEntry,
    GAA_FLAG_INCLUDE_GATEWAYS, GAA_FLAG_INCLUDE_PREFIX, GAA_FLAG_SKIP_ANYCAST,
    GAA_FLAG_SKIP_MULTICAST, IP_ADAPTER_ADDRESSES_LH, MIB_IF_ROW2, MIB_IPINTERFACE_ROW,
};
use windows::Win32::NetworkManagement::Ndis::{
    IfOperStatusDown, IfOperStatusLowerLayerDown, IfOperStatusNotPresent, IfOperStatusUp,
    MediaConnectStateConnected, MediaConnectStateDisconnected, NET_LUID_LH,
};
use windows::Win32::Networking::WinSock::{
    IpPrefixOriginDhcp, IpPrefixOriginManual, NL_PREFIX_ORIGIN, AF_INET, AF_UNSPEC,
};

use crate::dto::{AdapterInfo, AdapterStatus, AddressEntry, DnsView, Ipv4View};
use crate::error::{win32_error, AppError, AppResult, ErrorCode};
use crate::net::{self, device, registry};
use crate::subnet;

pub struct RawAdapter {
    pub info: AdapterInfo,
    pub luid_value: u64,
}

fn origin_name(prefix_origin: NL_PREFIX_ORIGIN) -> &'static str {
    if prefix_origin == IpPrefixOriginDhcp {
        "dhcp"
    } else if prefix_origin == IpPrefixOriginManual {
        "manual"
    } else {
        "other"
    }
}

fn status_of(
    is_enabled: bool,
    oper_status: windows::Win32::NetworkManagement::Ndis::IF_OPER_STATUS,
    media_state: Option<windows::Win32::NetworkManagement::Ndis::NET_IF_MEDIA_CONNECT_STATE>,
) -> AdapterStatus {
    if !is_enabled {
        return AdapterStatus::Disabled;
    }
    let connected = media_state == Some(MediaConnectStateConnected);
    let disconnected = media_state == Some(MediaConnectStateDisconnected);
    if oper_status == IfOperStatusUp && (connected || media_state.is_none()) {
        return AdapterStatus::Connected;
    }
    if oper_status == IfOperStatusNotPresent || oper_status == IfOperStatusLowerLayerDown {
        return AdapterStatus::Faulty;
    }
    if disconnected || oper_status == IfOperStatusDown {
        return AdapterStatus::Disconnected;
    }
    AdapterStatus::Unknown
}

unsafe fn if_row(luid: NET_LUID_LH, index: u32) -> Option<MIB_IF_ROW2> {
    let mut row: MIB_IF_ROW2 = std::mem::zeroed();
    row.InterfaceLuid = luid;
    row.InterfaceIndex = index;
    if GetIfEntry2(&mut row) == NO_ERROR {
        Some(row)
    } else {
        None
    }
}

fn fetch_adapter_list() -> AppResult<Vec<u8>> {
    let mut size: u32 = 16 * 1024;
    let flags = GAA_FLAG_SKIP_ANYCAST
        | GAA_FLAG_SKIP_MULTICAST
        | GAA_FLAG_INCLUDE_PREFIX
        | GAA_FLAG_INCLUDE_GATEWAYS;
    for _ in 0..6 {
        let mut buffer = vec![0u8; size as usize];
        let status = unsafe {
            GetAdaptersAddresses(
                AF_UNSPEC.0 as u32,
                flags,
                None,
                Some(buffer.as_mut_ptr() as *mut IP_ADAPTER_ADDRESSES_LH),
                &mut size,
            )
        };
        if status == ERROR_BUFFER_OVERFLOW.0 {
            size = size.max(16 * 1024) + 16 * 1024;
            continue;
        }
        if status == NO_ERROR.0 {
            return Ok(buffer);
        }
        return Err(win32_error(status, "枚举网卡失败"));
    }
    Err(AppError::new(
        ErrorCode::CommandFailed,
        "网卡列表过大，无法一次性读取",
    ))
}

pub fn enumerate() -> AppResult<Vec<RawAdapter>> {
    let buffer = fetch_adapter_list()?;
    let devices = device::map_by_net_cfg_id();
    let mut adapters: Vec<RawAdapter> = Vec::new();

    unsafe {
        let mut cursor = buffer.as_ptr() as *const IP_ADAPTER_ADDRESSES_LH;
        while !cursor.is_null() {
            let current = &*cursor;
            let id = net::pstr_to_string(current.AdapterName);
            let name = net::pwstr_to_string(current.FriendlyName);
            let description = net::pwstr_to_string(current.Description);

            if !id.trim().is_empty() {
                let if_index = current.Anonymous1.Anonymous.IfIndex;
                let if_type = current.IfType;
                let iface = registry::read_interface(&id);
                let device_entry = devices.get(&id.trim().to_lowercase());
                // Prefer the device-tree view, but fall back to the driver key's
                // ConfigFlags so a disabled adapter is still reported correctly.
                let is_enabled = device_entry
                    .map(|entry| !entry.disabled)
                    .unwrap_or_else(|| !registry::is_device_disabled(&id));
                let row = if_row(current.Luid, if_index);
                let media_state = row.as_ref().map(|value| value.MediaConnectState);

                let mut addresses: Vec<AddressEntry> = Vec::new();
                let mut unicast = current.FirstUnicastAddress;
                while !unicast.is_null() {
                    let entry = &*unicast;
                    if let Some(address) = net::socket_address_to_ipv4(&entry.Address) {
                        let prefix = entry.OnLinkPrefixLength.min(32) as u32;
                        addresses.push(AddressEntry {
                            address,
                            prefix,
                            mask: subnet::mask_text_from_prefix(prefix),
                            origin: origin_name(entry.PrefixOrigin).to_string(),
                        });
                    }
                    unicast = entry.Next;
                }

                let mut gateway = None;
                let mut gateway_cursor = current.FirstGatewayAddress;
                while !gateway_cursor.is_null() {
                    let entry = &*gateway_cursor;
                    if let Some(address) = net::socket_address_to_ipv4(&entry.Address) {
                        gateway = Some(address);
                        break;
                    }
                    gateway_cursor = entry.Next;
                }

                let mut dns_servers: Vec<String> = Vec::new();
                let mut dns_cursor = current.FirstDnsServerAddress;
                while !dns_cursor.is_null() {
                    let entry = &*dns_cursor;
                    if let Some(address) = net::socket_address_to_ipv4(&entry.Address) {
                        dns_servers.push(address);
                    }
                    dns_cursor = entry.Next;
                }

                let mac_bytes = if current.PhysicalAddressLength > 0 {
                    current.PhysicalAddress[..(current.PhysicalAddressLength.min(8) as usize)].to_vec()
                } else {
                    Vec::new()
                };
                let mac = net::format_mac(&mac_bytes);
                let permanent_mac = row
                    .as_ref()
                    .filter(|value| value.PermanentPhysicalAddress.iter().any(|byte| *byte != 0))
                    .map(|value| {
                        let length = value.PhysicalAddressLength.min(32) as usize;
                        net::format_mac(&value.PermanentPhysicalAddress[..length.max(6).min(32)])
                    })
                    .filter(|value| *value != mac);
                let mac_override = registry::read_network_address(&id);

                // A manual address means the user configured this adapter by
                // hand; Windows may still report EnableDHCP=1 (Wi-Fi profiles do),
                // so the presence of manual addresses wins.
                let has_manual = addresses.iter().any(|entry| entry.origin == "manual");
                let dhcp_enabled = if has_manual {
                    false
                } else {
                    iface
                        .enable_dhcp
                        .unwrap_or_else(|| addresses.iter().any(|entry| entry.origin == "dhcp"))
                };

                let dns_source = if iface
                    .name_server
                    .as_deref()
                    .map(|text| !text.trim().is_empty())
                    .unwrap_or(false)
                {
                    "static"
                } else {
                    "dhcp"
                };

                let status = status_of(is_enabled, current.OperStatus, media_state);

                adapters.push(RawAdapter {
                    luid_value: current.Luid.Value,
                    info: AdapterInfo {
                        id: id.clone(),
                        name,
                        description,
                        mac,
                        permanent_mac,
                        mac_override,
                        index: if_index,
                        metric: iface.interface_metric,
                        mtu: current.Mtu,
                        is_wireless: if_type == net::IF_TYPE_IEEE80211,
                        is_virtual: net::looks_virtual(
                            &net::pwstr_to_string(current.FriendlyName),
                            &net::pwstr_to_string(current.Description),
                            if_type,
                        ),
                        media_type: net::media_type_name(if_type).to_string(),
                        status,
                        link_speed_bps: current.TransmitLinkSpeed,
                        enabled: is_enabled,
                        dhcp_enabled,
                        ipv4: Ipv4View {
                            addresses,
                            gateway,
                            gateway_metric: None,
                        },
                        dns: DnsView {
                            servers: dns_servers,
                            source: dns_source.to_string(),
                        },
                        device_instance_id: device_entry
                            .map(|entry| entry.instance_id.clone())
                            .filter(|value| !value.is_empty()),
                    },
                });
            }

            cursor = current.Next;
        }
    }

    // Disabled adapters are absent from `GetAdaptersAddresses`, so they are
    // reconstructed from the device tree + registry. Without this they would
    // vanish from the UI right after being disabled, with no way back.
    let known: std::collections::HashSet<String> = adapters
        .iter()
        .map(|adapter| adapter.info.id.to_lowercase())
        .collect();
    for (id, entry) in devices.iter() {
        if known.contains(id) || !entry.disabled {
            continue;
        }
        let name = registry::connection_name(id)
            .or_else(|| registry::driver_description(id))
            .unwrap_or_else(|| entry.instance_id.clone());
        let description = registry::driver_description(id).unwrap_or_default();
        adapters.push(RawAdapter {
            luid_value: 0,
            info: AdapterInfo {
                id: id.clone(),
                name: name.clone(),
                description: description.clone(),
                mac: registry::read_network_address(id).unwrap_or_default(),
                permanent_mac: None,
                mac_override: registry::read_network_address(id),
                index: 0,
                metric: None,
                mtu: 0,
                is_wireless: description.to_lowercase().contains("wi-fi")
                    || description.to_lowercase().contains("wireless"),
                is_virtual: net::looks_virtual(&name, &description, 0),
                media_type: "Other".to_string(),
                status: AdapterStatus::Disabled,
                link_speed_bps: 0,
                enabled: false,
                dhcp_enabled: false,
                ipv4: Ipv4View {
                    addresses: Vec::new(),
                    gateway: None,
                    gateway_metric: None,
                },
                dns: DnsView {
                    servers: Vec::new(),
                    source: "dhcp".to_string(),
                },
                device_instance_id: Some(entry.instance_id.clone()).filter(|value| !value.is_empty()),
            },
        });
    }

    // Connected adapters first, then ones with a default gateway, then by index —
    // this reproduces the "prefer the connected adapter" behaviour of the original.
    adapters.sort_by_key(|adapter| {
        let status_rank = if adapter.info.status == AdapterStatus::Connected {
            0u8
        } else {
            1
        };
        let gateway_rank = if adapter.info.ipv4.gateway.is_some() {
            0u8
        } else {
            1
        };
        (status_rank, gateway_rank, adapter.info.index)
    });
    Ok(adapters)
}

pub fn list() -> AppResult<Vec<AdapterInfo>> {
    Ok(enumerate()?
        .into_iter()
        .map(|adapter| adapter.info)
        .collect())
}

pub fn get(id: &str) -> AppResult<AdapterInfo> {
    enumerate()?
        .into_iter()
        .find(|adapter| adapter.info.id.eq_ignore_ascii_case(id))
        .map(|adapter| adapter.info)
        .ok_or_else(|| {
            AppError::new(ErrorCode::AdapterNotFound, "未找到指定的网卡")
                .detail(id.to_string())
                .hint("网卡可能已被移除，请刷新后重试")
        })
}

pub fn luid_of(id: &str) -> Option<NET_LUID_LH> {
    enumerate()
        .ok()?
        .into_iter()
        .find(|adapter| adapter.info.id.eq_ignore_ascii_case(id))
        .map(|adapter| NET_LUID_LH {
            Value: adapter.luid_value,
        })
}

/// Interface metric. `None` means "automatic metric".
pub fn metric_of(id: &str) -> Option<u32> {
    let luid = luid_of(id)?;
    unsafe {
        let mut row: MIB_IPINTERFACE_ROW = std::mem::zeroed();
        row.Family = AF_INET;
        row.InterfaceLuid = luid;
        if GetIpInterfaceEntry(&mut row) != NO_ERROR {
            return None;
        }
        if row.UseAutomaticMetric {
            None
        } else {
            Some(row.Metric)
        }
    }
}

pub fn set_metric(id: &str, metric: u32) -> AppResult<()> {
    let luid = luid_of(id).ok_or_else(|| {
        AppError::new(ErrorCode::AdapterNotFound, "未找到指定的网卡").detail(id.to_string())
    })?;
    unsafe {
        let mut row: MIB_IPINTERFACE_ROW = std::mem::zeroed();
        row.Family = AF_INET;
        row.InterfaceLuid = luid;
        let status = GetIpInterfaceEntry(&mut row);
        if status != NO_ERROR {
            return Err(win32_error(status.0, "读取网卡跃点数失败"));
        }
        row.UseAutomaticMetric = false;
        row.Metric = metric;
        let status = SetIpInterfaceEntry(&mut row);
        if status != NO_ERROR {
            return Err(win32_error(status.0, "设置网卡跃点数失败"));
        }
    }
    Ok(())
}

/// The currently connected adapter that owns a default gateway (used by the
/// subnet scanner to pick a sensible default range).
pub fn primary_connected() -> Option<AdapterInfo> {
    list()
        .ok()?
        .into_iter()
        .find(|adapter| {
            adapter.enabled
                && !adapter.is_virtual
                && adapter.status == AdapterStatus::Connected
                && !adapter.ipv4.addresses.is_empty()
        })
}
