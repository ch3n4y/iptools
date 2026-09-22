//! Windows networking layer: adapter enumeration, registry state, device
//! enable/disable, and the write path.

pub mod adapters;
pub mod device;
pub mod elevation;
pub mod identity;
pub mod registry;
pub mod write;

use windows::core::{PSTR, PWSTR};
use windows::Win32::Networking::WinSock::{SOCKADDR_IN, SOCKET_ADDRESS, AF_INET};

/// Reads a NUL-terminated wide string without assuming an owning wrapper.
pub unsafe fn pwstr_to_string(value: PWSTR) -> String {
    if value.is_null() {
        return String::new();
    }
    let mut len = 0usize;
    while *value.0.add(len) != 0 {
        len += 1;
    }
    String::from_utf16_lossy(std::slice::from_raw_parts(value.0, len))
}

/// Reads a NUL-terminated ANSI string (used for `AdapterName`).
pub unsafe fn pstr_to_string(value: PSTR) -> String {
    if value.is_null() {
        return String::new();
    }
    let mut len = 0usize;
    while *value.0.add(len) != 0 {
        len += 1;
    }
    String::from_utf8_lossy(std::slice::from_raw_parts(value.0, len)).to_string()
}

pub unsafe fn socket_address_to_ipv4(address: &SOCKET_ADDRESS) -> Option<String> {
    if address.lpSockaddr.is_null() {
        return None;
    }
    let sockaddr = &*address.lpSockaddr;
    if sockaddr.sa_family != AF_INET {
        return None;
    }
    let sockaddr_in = &*(address.lpSockaddr as *const SOCKADDR_IN);
    let raw = sockaddr_in.sin_addr.S_un.S_addr;
    Some(crate::subnet::format_ipv4(u32::from_be(raw)))
}

pub fn format_mac(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<String>>()
        .join("-")
}

/// Accepts `AABBCCDDEEFF`, `AA-BB-CC-DD-EE-FF`, `aa:bb:...` and returns 6 bytes.
pub fn parse_mac_bytes(text: &str) -> Option<[u8; 6]> {
    let hex: String = text
        .chars()
        .filter(|c| c.is_ascii_hexdigit())
        .collect();
    if hex.len() != 12 {
        return None;
    }
    let mut out = [0u8; 6];
    for index in 0..6 {
        out[index] = u8::from_str_radix(&hex[index * 2..index * 2 + 2], 16).ok()?;
    }
    Some(out)
}

pub fn format_mac_string(text: &str) -> Option<String> {
    parse_mac_bytes(text).map(|bytes| format_mac(&bytes))
}

/// A locally administered, unicast MAC with a vendor-looking prefix.
pub fn random_mac() -> String {
    let mut bytes = [0u8; 6];
    for byte in bytes.iter_mut() {
        *byte = rand::random::<u8>();
    }
    // Locally administered (bit 1 of the first octet) and unicast (bit 0 clear).
    bytes[0] = (bytes[0] & 0xFC) | 0x02;
    format_mac(&bytes)
}

/// Drivers report a handful of plausible media types; map them for display.
pub fn media_type_name(if_type: u32) -> &'static str {
    match if_type {
        6 => "Ethernet",
        71 => "Wireless80211",
        24 => "Loopback",
        131 => "Tunnel",
        237 => "IEEE1394",
        243 => "Wwanpp",
        244 => "Wwanpp2",
        _ => "Other",
    }
}

pub const IF_TYPE_ETHERNET: u32 = 6;
pub const IF_TYPE_IEEE80211: u32 = 71;
pub const IF_TYPE_LOOPBACK: u32 = 24;
pub const IF_TYPE_TUNNEL: u32 = 131;

/// Heuristic used to tag virtual/tunnel adapters so the UI can hide them.
pub fn looks_virtual(name: &str, description: &str, if_type: u32) -> bool {
    if if_type == IF_TYPE_LOOPBACK || if_type == IF_TYPE_TUNNEL {
        return true;
    }
    let haystack = format!("{name} {description}").to_ascii_lowercase();
    const NEEDLES: [&str; 24] = [
        "virtual",
        "vmware",
        "hyper-v",
        "vethernet",
        "virtualbox",
        "loopback",
        "tap-",
        "tap0",
        "tun",
        "wintun",
        "wireguard",
        "openvpn",
        "tailscale",
        "zerotier",
        "npcap",
        "wan miniport",
        "bluetooth",
        "microsoft km-test",
        "docker",
        "veth",
        "bridge",
        "npf",
        "teredo",
        "isatap",
    ];
    NEEDLES.iter().any(|needle| haystack.contains(needle))
}
