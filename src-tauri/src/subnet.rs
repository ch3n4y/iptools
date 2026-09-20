//! Pure subnet arithmetic and IPv4 configuration validation.
//!
//! Nothing in this module touches Win32, so it is fully unit-tested and can be
//! exercised from `cargo test` without administrator rights.

use crate::dto::{AddressSpec, SubnetCalc, ValidationIssue};

/// Parses a dotted-quad IPv4 address into host-order bits (first octet in the
/// most significant byte). Returns `None` for anything malformed.
pub fn parse_ipv4(input: &str) -> Option<u32> {
    let text = input.trim();
    if text.is_empty() {
        return None;
    }
    let parts: Vec<&str> = text.split('.').collect();
    if parts.len() != 4 {
        return None;
    }
    let mut value: u32 = 0;
    for part in parts {
        if part.is_empty() || part.len() > 3 || !part.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        let octet: u32 = part.parse().ok()?;
        if octet > 255 {
            return None;
        }
        value = (value << 8) | octet;
    }
    Some(value)
}

pub fn format_ipv4(value: u32) -> String {
    format!(
        "{}.{}.{}.{}",
        (value >> 24) & 0xff,
        (value >> 16) & 0xff,
        (value >> 8) & 0xff,
        value & 0xff
    )
}

/// A valid netmask is a run of ones followed by a run of zeros (and is not `/0`).
pub fn is_contiguous_mask(mask: u32) -> bool {
    let inverted = !mask;
    inverted & inverted.wrapping_add(1) == 0
}

pub fn prefix_from_mask(mask: u32) -> Option<u32> {
    if !is_contiguous_mask(mask) {
        return None;
    }
    let prefix = mask.count_ones();
    if prefix == 0 {
        None
    } else {
        Some(prefix)
    }
}

pub fn mask_from_prefix(prefix: u32) -> Option<u32> {
    if prefix == 0 || prefix > 32 {
        None
    } else {
        Some(u32::MAX << (32 - prefix))
    }
}

pub fn mask_text_from_prefix(prefix: u32) -> String {
    mask_from_prefix(prefix)
        .map(format_ipv4)
        .unwrap_or_else(|| "255.255.255.0".to_string())
}

/// Accepts `24`, `/24` or a dotted-quad mask and returns `(prefix, mask)`.
pub fn parse_mask_or_prefix(text: &str) -> Option<(u32, u32)> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Some(rest) = trimmed.strip_prefix('/') {
        let prefix: u32 = rest.trim().parse().ok()?;
        return mask_from_prefix(prefix).map(|mask| (prefix, mask));
    }
    if let Ok(prefix) = trimmed.parse::<u32>() {
        return mask_from_prefix(prefix).map(|mask| (prefix, mask));
    }
    let mask = parse_ipv4(trimmed)?;
    prefix_from_mask(mask).map(|prefix| (prefix, mask))
}

pub fn network_address(ip: u32, mask: u32) -> u32 {
    ip & mask
}

pub fn broadcast_address(ip: u32, mask: u32) -> u32 {
    ip | !mask
}

pub fn wildcard(mask: u32) -> u32 {
    !mask
}

pub fn total_addresses(prefix: u32) -> u64 {
    if prefix >= 32 {
        1
    } else {
        1u64 << (32 - prefix)
    }
}

pub fn usable_host_count(prefix: u32) -> u64 {
    match prefix {
        0 => 0,
        31 => 2,
        32 => 1,
        p => total_addresses(p) - 2,
    }
}

/// First and last usable host address. `/31` and `/32` have no network/broadcast
/// concept (RFC 3021), so the full range is returned for them.
pub fn host_range(ip: u32, mask: u32) -> (u32, u32) {
    let network = network_address(ip, mask);
    let broadcast = broadcast_address(ip, mask);
    let prefix = mask.count_ones();
    if prefix >= 31 {
        (network, broadcast)
    } else {
        (network + 1, broadcast - 1)
    }
}

pub fn class_of(ip: u32) -> &'static str {
    let first = (ip >> 24) as u8;
    if first < 128 {
        "A"
    } else if first < 192 {
        "B"
    } else if first < 224 {
        "C"
    } else if first < 240 {
        "D"
    } else {
        "E"
    }
}

/// The mask implied by the address class (used by the "double-click the mask
/// label to cycle A/B/C" affordance of the original tool).
pub fn default_mask_for_ip(ip: u32) -> u32 {
    let first = (ip >> 24) as u8;
    if first < 128 {
        u32::from_be_bytes([255, 0, 0, 0])
    } else if first < 192 {
        u32::from_be_bytes([255, 255, 0, 0])
    } else {
        u32::from_be_bytes([255, 255, 255, 0])
    }
}

pub fn is_private(ip: u32) -> bool {
    let [a, b, _, _] = ip.to_be_bytes();
    a == 10 || (a == 172 && (16..=31).contains(&b)) || (a == 192 && b == 168)
}

pub fn is_loopback(ip: u32) -> bool {
    (ip >> 24) as u8 == 127
}

pub fn is_link_local(ip: u32) -> bool {
    (ip >> 16) as u16 == 0xA9FE
}

pub fn is_multicast(ip: u32) -> bool {
    (ip >> 28) == 0xE
}

/// Suggests the conventional gateway for an address/mask pair: the first host
/// address of the subnet (`.1` in the usual case).
pub fn derive_gateway(ip: u32, mask: u32) -> Option<u32> {
    let prefix = prefix_from_mask(mask)?;
    if prefix >= 31 {
        return None;
    }
    let network = network_address(ip, mask);
    let candidate = network + 1;
    if candidate == ip {
        Some(network + 2)
    } else {
        Some(candidate)
    }
}

/// Full subnet report backing the subnet-mask calculator view.
pub fn calculate(ip: Option<&str>, mask_text: &str) -> Result<SubnetCalc, String> {
    let (prefix, mask) =
        parse_mask_or_prefix(mask_text).ok_or_else(|| format!("子网掩码不合法：{mask_text}"))?;
    let address = match ip {
        Some(text) if !text.trim().is_empty() => Some(
            parse_ipv4(text).ok_or_else(|| format!("IP 地址不合法：{text}"))?,
        ),
        _ => None,
    };
    let reference = address.unwrap_or(0);
    let network = network_address(reference, mask);
    let broadcast = broadcast_address(reference, mask);
    let (first_host, last_host) = host_range(reference, mask);

    let mut notes = Vec::new();
    if prefix >= 31 {
        notes.push(format!(
            "/{prefix} 为点对点网段（RFC 3021）：没有网络地址与广播地址的保留，两端都可作主机地址"
        ));
    } else {
        notes.push(format!("/{prefix} 共 {} 个地址", total_addresses(prefix)));
    }
    if let Some(addr) = address {
        if is_multicast(addr) {
            notes.push("该地址属于组播地址段（224.0.0.0/4），不能作为主机地址".to_string());
        }
        if is_loopback(addr) {
            notes.push("该地址属于回环地址段（127.0.0.0/8）".to_string());
        }
        if is_link_local(addr) {
            notes.push("该地址属于自动专用地址（169.254.0.0/16），通常是 DHCP 失败后的兜底地址".to_string());
        }
        if prefix < 31 {
            if addr == network {
                notes.push("该地址是网络地址，不能分配给主机".to_string());
            } else if addr == broadcast {
                notes.push("该地址是广播地址，不能分配给主机".to_string());
            }
        }
        if is_private(addr) {
            notes.push("属于私有地址空间".to_string());
        } else {
            notes.push("属于公网地址空间".to_string());
        }
    }

    Ok(SubnetCalc {
        ip: address.map(format_ipv4),
        mask: format_ipv4(mask),
        prefix,
        wildcard: format_ipv4(wildcard(mask)),
        network: format_ipv4(network),
        broadcast: format_ipv4(broadcast),
        first_host: format_ipv4(first_host),
        last_host: format_ipv4(last_host),
        total_addresses: total_addresses(prefix),
        usable_host_count: usable_host_count(prefix),
        ip_class: address.map(class_of).unwrap_or("C").to_string(),
        is_private: address.map(is_private).unwrap_or(false),
        notes,
    })
}

fn issue(level: &str, field: &str, message: impl Into<String>) -> ValidationIssue {
    ValidationIssue {
        level: level.to_string(),
        field: field.to_string(),
        message: message.into(),
    }
}

/// Validates a pending configuration before anything is written to the system.
/// `peers` carries `(adapter_name, addresses)` for the other adapters so address
/// conflicts are caught up front.
pub fn validate(
    dhcp: bool,
    addresses: &[AddressSpec],
    gateway: Option<&str>,
    dns: &[String],
    peers: &[(String, Vec<String>)],
) -> Vec<ValidationIssue> {
    let mut issues = Vec::new();

    if dhcp {
        if !addresses.is_empty() {
            issues.push(issue(
                "warning",
                "dhcp",
                "已选择自动获取（DHCP），手动填写的 IP 地址将被忽略",
            ));
        }
        return issues;
    }

    if addresses.is_empty() {
        issues.push(issue("error", "addresses", "静态模式下至少需要填写一个 IP 地址"));
    }

    let mut seen: Vec<u32> = Vec::new();
    for (index, spec) in addresses.iter().enumerate() {
        let field = format!("addresses[{index}]");
        let Some(ip) = parse_ipv4(&spec.address) else {
            issues.push(issue("error", &field, format!("IP 地址不合法：{}", spec.address)));
            continue;
        };
        if spec.prefix == 0 || spec.prefix > 32 {
            issues.push(issue(
                "error",
                &field,
                format!("子网掩码长度不合法：/{}", spec.prefix),
            ));
            continue;
        }
        let mask = mask_from_prefix(spec.prefix).unwrap_or(0);
        if prefix_from_mask(mask).is_none() {
            issues.push(issue("error", &field, "子网掩码不连续，无法使用"));
            continue;
        }
        if is_loopback(ip) {
            issues.push(issue("error", &field, "回环地址不能配置到网卡上"));
        }
        if is_multicast(ip) {
            issues.push(issue("error", &field, "组播地址不能配置到网卡上"));
        }
        if spec.prefix < 31 {
            if ip == network_address(ip, mask) {
                issues.push(issue(
                    "error",
                    &field,
                    format!("{} 是网络地址，不能作为主机地址", spec.address),
                ));
            } else if ip == broadcast_address(ip, mask) {
                issues.push(issue(
                    "error",
                    &field,
                    format!("{} 是广播地址，不能作为主机地址", spec.address),
                ));
            }
        }
        if seen.contains(&ip) {
            issues.push(issue("error", &field, format!("{} 重复填写了", spec.address)));
        }
        seen.push(ip);
        for (peer_name, peer_ips) in peers {
            if peer_ips.iter().any(|candidate| parse_ipv4(candidate) == Some(ip)) {
                issues.push(issue(
                    "error",
                    &field,
                    format!("{} 已被其他网卡占用（{peer_name}）", spec.address),
                ));
            }
        }
    }

    if let Some(gateway_text) = gateway.map(str::trim).filter(|text| !text.is_empty()) {
        match parse_ipv4(gateway_text) {
            None => issues.push(issue(
                "error",
                "gateway",
                format!("默认网关不合法：{gateway_text}"),
            )),
            Some(gw) => {
                if seen.contains(&gw) {
                    issues.push(issue("error", "gateway", "默认网关与网卡地址相同"));
                }
                let inside = addresses.iter().any(|spec| {
                    parse_ipv4(&spec.address)
                        .map(|ip| {
                            mask_from_prefix(spec.prefix)
                                .map(|mask| network_address(ip, mask) == network_address(gw, mask))
                                .unwrap_or(false)
                        })
                        .unwrap_or(false)
                });
                if !inside && !addresses.is_empty() {
                    issues.push(issue(
                        "warning",
                        "gateway",
                        "默认网关不在已配置的任何子网内，保存后可能无法上网",
                    ));
                }
            }
        }
    } else if !addresses.is_empty() {
        issues.push(issue(
            "warning",
            "gateway",
            "未填写默认网关，仅本网段通信可用",
        ));
    }

    for (index, server) in dns.iter().enumerate() {
        let trimmed = server.trim();
        if trimmed.is_empty() {
            continue;
        }
        if parse_ipv4(trimmed).is_none() {
            issues.push(issue(
                "error",
                &format!("dns[{index}]"),
                format!("DNS 服务器地址不合法：{trimmed}"),
            ));
        }
    }

    issues
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec(address: &str, prefix: u32) -> AddressSpec {
        AddressSpec {
            address: address.to_string(),
            prefix,
            mask: mask_text_from_prefix(prefix),
        }
    }

    #[test]
    fn parses_and_formats_ipv4() {
        assert_eq!(parse_ipv4("192.168.1.10"), Some(0xC0A8010A));
        assert_eq!(format_ipv4(0xC0A8010A), "192.168.1.10");
        assert_eq!(parse_ipv4(" 10.0.0.1 "), Some(0x0A000001));
        assert_eq!(parse_ipv4("256.1.1.1"), None);
        assert_eq!(parse_ipv4("1.2.3"), None);
        assert_eq!(parse_ipv4("1.2.3.4.5"), None);
        assert_eq!(parse_ipv4("1.2.3.a"), None);
        assert_eq!(parse_ipv4(""), None);
    }

    #[test]
    fn converts_between_prefix_and_mask() {
        assert_eq!(mask_from_prefix(24), Some(0xFFFFFF00));
        assert_eq!(mask_from_prefix(32), Some(u32::MAX));
        assert_eq!(mask_from_prefix(8), Some(0xFF000000));
        assert_eq!(mask_from_prefix(0), None);
        assert_eq!(mask_from_prefix(33), None);
        assert_eq!(prefix_from_mask(0xFFFFFF00), Some(24));
        assert_eq!(prefix_from_mask(0xFF000000), Some(8));
        assert_eq!(prefix_from_mask(u32::MAX), Some(32));
        assert_eq!(prefix_from_mask(0), None);
        // Non-contiguous masks are rejected.
        assert_eq!(prefix_from_mask(0xFF00FF00), None);
        for prefix in 1..=32u32 {
            let mask = mask_from_prefix(prefix).unwrap();
            assert_eq!(prefix_from_mask(mask), Some(prefix));
        }
    }

    #[test]
    fn parses_mask_or_prefix_input() {
        assert_eq!(parse_mask_or_prefix("24"), Some((24, 0xFFFFFF00)));
        assert_eq!(parse_mask_or_prefix("/24"), Some((24, 0xFFFFFF00)));
        assert_eq!(parse_mask_or_prefix("255.255.255.0"), Some((24, 0xFFFFFF00)));
        assert_eq!(parse_mask_or_prefix("255.255.0.255"), None);
        assert_eq!(parse_mask_or_prefix(""), None);
        assert_eq!(parse_mask_or_prefix("abc"), None);
    }

    #[test]
    fn computes_network_broadcast_and_hosts() {
        let ip = parse_ipv4("192.168.10.37").unwrap();
        let mask = mask_from_prefix(24).unwrap();
        assert_eq!(format_ipv4(network_address(ip, mask)), "192.168.10.0");
        assert_eq!(format_ipv4(broadcast_address(ip, mask)), "192.168.10.255");
        assert_eq!(format_ipv4(wildcard(mask)), "0.0.0.255");
        let (first, last) = host_range(ip, mask);
        assert_eq!(format_ipv4(first), "192.168.10.1");
        assert_eq!(format_ipv4(last), "192.168.10.254");
        assert_eq!(usable_host_count(24), 254);
    }

    #[test]
    fn handles_point_to_point_and_host_prefixes() {
        let ip = parse_ipv4("10.1.1.1").unwrap();
        let mask31 = mask_from_prefix(31).unwrap();
        assert_eq!(usable_host_count(31), 2);
        let (first, last) = host_range(ip, mask31);
        assert_eq!((format_ipv4(first), format_ipv4(last)), ("10.1.1.0".to_string(), "10.1.1.1".to_string()));
        let mask32 = mask_from_prefix(32).unwrap();
        assert_eq!(usable_host_count(32), 1);
        assert_eq!(total_addresses(30), 4);
    }

    #[test]
    fn derives_gateway_from_subnet() {
        let ip = parse_ipv4("172.16.5.20").unwrap();
        let mask = mask_from_prefix(24).unwrap();
        assert_eq!(derive_gateway(ip, mask).map(format_ipv4), Some("172.16.5.1".to_string()));
        // When the host address *is* .1, the next address is suggested instead.
        let first = parse_ipv4("172.16.5.1").unwrap();
        assert_eq!(derive_gateway(first, mask).map(format_ipv4), Some("172.16.5.2".to_string()));
        assert_eq!(derive_gateway(ip, mask), Some(0xAC100501));
    }

    #[test]
    fn classifies_addresses() {
        assert_eq!(class_of(parse_ipv4("10.0.0.1").unwrap()), "A");
        assert_eq!(class_of(parse_ipv4("172.16.0.1").unwrap()), "B");
        assert_eq!(class_of(parse_ipv4("192.168.0.1").unwrap()), "C");
        assert_eq!(class_of(parse_ipv4("224.0.0.1").unwrap()), "D");
        assert_eq!(class_of(parse_ipv4("240.0.0.1").unwrap()), "E");
        assert!(is_private(parse_ipv4("10.255.255.254").unwrap()));
        assert!(is_private(parse_ipv4("172.31.0.1").unwrap()));
        assert!(!is_private(parse_ipv4("172.32.0.1").unwrap()));
        assert!(is_private(parse_ipv4("192.168.1.1").unwrap()));
        assert!(!is_private(parse_ipv4("8.8.8.8").unwrap()));
        assert!(is_link_local(parse_ipv4("169.254.3.4").unwrap()));
    }

    #[test]
    fn suggests_class_default_mask() {
        assert_eq!(default_mask_for_ip(parse_ipv4("10.1.2.3").unwrap()), 0xFF000000);
        assert_eq!(default_mask_for_ip(parse_ipv4("150.1.2.3").unwrap()), 0xFFFF0000);
        assert_eq!(default_mask_for_ip(parse_ipv4("200.1.2.3").unwrap()), 0xFFFFFF00);
    }

    #[test]
    fn calculates_full_report() {
        let report = calculate(Some("192.168.1.130"), "255.255.255.128").unwrap();
        assert_eq!(report.prefix, 25);
        assert_eq!(report.mask, "255.255.255.128");
        assert_eq!(report.wildcard, "0.0.0.127");
        assert_eq!(report.network, "192.168.1.128");
        assert_eq!(report.broadcast, "192.168.1.255");
        assert_eq!(report.first_host, "192.168.1.129");
        assert_eq!(report.last_host, "192.168.1.254");
        assert_eq!(report.usable_host_count, 126);
        assert!(report.is_private);
        assert!(calculate(Some("192.168.1.1"), "255.0.255.0").is_err());
        assert!(calculate(Some("999.1.1.1"), "24").is_err());
    }

    #[test]
    fn validation_flags_broken_configurations() {
        let peers = vec![("以太网".to_string(), vec!["192.168.1.50".to_string()])];

        let issues = validate(
            false,
            &[spec("192.168.1.0", 24)],
            Some("192.168.1.1"),
            &[],
            &peers,
        );
        assert!(issues
            .iter()
            .any(|i| i.level == "error" && i.message.contains("网络地址")));

        let issues = validate(
            false,
            &[spec("192.168.1.50", 24)],
            Some("192.168.1.1"),
            &[],
            &peers,
        );
        assert!(issues
            .iter()
            .any(|i| i.level == "error" && i.message.contains("已被其他网卡占用")));

        let issues = validate(
            false,
            &[spec("192.168.1.10", 24), spec("192.168.1.10", 24)],
            Some("192.168.1.1"),
            &["8.8.8.8".to_string()],
            &[],
        );
        assert!(issues.iter().any(|i| i.message.contains("重复填写")));

        let issues = validate(
            false,
            &[spec("192.168.1.10", 24)],
            Some("10.0.0.1"),
            &["not-an-ip".to_string()],
            &[],
        );
        assert!(issues.iter().any(|i| i.level == "error" && i.field == "dns[0]"));
        assert!(issues
            .iter()
            .any(|i| i.level == "warning" && i.message.contains("不在已配置的任何子网内")));

        let issues = validate(false, &[], None, &[], &[]);
        assert_eq!(issues.iter().filter(|i| i.level == "error").count(), 1);

        // DHCP ignores the manual addresses but warns about them.
        let issues = validate(true, &[spec("192.168.1.10", 24)], None, &[], &[]);
        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].level, "warning");

        // /31 and /32 addresses are legal host addresses.
        let issues = validate(
            false,
            &[spec("10.0.0.0", 31), spec("10.0.0.1", 31)],
            None,
            &[],
            &[],
        );
        assert!(issues.iter().all(|i| i.level != "error"), "{issues:?}");
    }
}
