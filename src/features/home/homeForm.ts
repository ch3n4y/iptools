/**
 * Pure form model for the home view: adapter -> form, form -> validated request.
 *
 * Keeping this out of the component means the tricky parts (mask parsing,
 * multi-address validation) are testable and the JSX stays about layout.
 */
import type { AdapterInfo, AddressSpec, ApplyRequest, DnsMode } from "../../lib/types";
import { isValidIpv4, maskFromPrefix, parseMaskText } from "./netmask";

export const MAX_ADDRESS_ROWS = 4;
export const MAX_DNS_SERVERS = 3;
const MAX_METRIC = 9999;

let rowSeq = 0;

function nextRowKey(): string {
  rowSeq += 1;
  return `addr-${rowSeq}`;
}

export interface AddressRowState {
  key: string;
  address: string;
  mask: string;
}

export interface HomeForm {
  mode: "dhcp" | "static";
  addresses: AddressRowState[];
  gateway: string;
  gatewayMetric: number | null;
  dnsMode: DnsMode;
  dns: string[];
  metric: number | null;
}

export function blankRow(): AddressRowState {
  return { key: nextRowKey(), address: "", mask: "" };
}

function emptyDns(): string[] {
  return Array.from({ length: MAX_DNS_SERVERS }, () => "");
}

export function blankForm(): HomeForm {
  return {
    mode: "dhcp",
    addresses: [blankRow()],
    gateway: "",
    gatewayMetric: null,
    dnsMode: "dhcp",
    dns: emptyDns(),
    metric: null,
  };
}

/** Read-back of the live adapter, used by 「读取当前配置」 and after a write. */
export function formFromAdapter(adapter: AdapterInfo): HomeForm {
  const rows: AddressRowState[] = adapter.ipv4.addresses.map((entry) => ({
    key: nextRowKey(),
    address: entry.address,
    mask: parseMaskText(entry.mask) === null ? maskFromPrefix(entry.prefix) : entry.mask,
  }));

  const dns = adapter.dns.servers.slice(0, MAX_DNS_SERVERS);
  while (dns.length < MAX_DNS_SERVERS) dns.push("");

  return {
    mode: adapter.dhcpEnabled ? "dhcp" : "static",
    addresses: rows.length > 0 ? rows : [blankRow()],
    gateway: adapter.ipv4.gateway ?? "",
    gatewayMetric: adapter.ipv4.gatewayMetric,
    dnsMode: adapter.dns.source === "static" ? "static" : "dhcp",
    dns,
    metric: adapter.metric,
  };
}

function isMetricValue(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= MAX_METRIC;
}

/**
 * Field keyed validation messages. Keys match the form control ids so the view
 * can show a message only for the fields the user has already touched.
 */
export function validateForm(form: HomeForm): Record<string, string> {
  const issues: Record<string, string> = {};

  if (form.mode === "static") {
    const owners = new Map<string, string[]>();
    for (const row of form.addresses) {
      const address = row.address.trim();
      if (!address) {
        issues[`ip:${row.key}`] = "请填写 IP 地址";
      } else if (!isValidIpv4(address)) {
        issues[`ip:${row.key}`] = "IP 地址格式不正确（示例：192.168.1.10）";
      } else {
        const keys = owners.get(address) ?? [];
        keys.push(row.key);
        owners.set(address, keys);
      }

      const mask = row.mask.trim();
      if (!mask) {
        issues[`mask:${row.key}`] = "请填写子网掩码";
      } else if (parseMaskText(mask) === null) {
        issues[`mask:${row.key}`] = "掩码应为 255.255.255.0 或 /24 形式，且必须是连续掩码";
      }
    }

    for (const [address, keys] of owners) {
      if (keys.length > 1) {
        for (const key of keys) issues[`ip:${key}`] = `地址 ${address} 重复`;
      }
    }

    const gateway = form.gateway.trim();
    if (gateway && !isValidIpv4(gateway)) {
      issues["gateway"] = "默认网关格式不正确（示例：192.168.1.1）";
    }
    if (form.gatewayMetric !== null && !isMetricValue(form.gatewayMetric)) {
      issues["gatewayMetric"] = `网关跃点应为 0 - ${MAX_METRIC} 之间的整数`;
    }
  }

  if (form.dnsMode === "static") {
    if (!form.dns.some((server) => server.trim().length > 0)) {
      issues["dns:0"] = "手动设置 DNS 时，至少填写一个服务器地址";
    }
    form.dns.forEach((server, index) => {
      const value = server.trim();
      if (value && !isValidIpv4(value)) {
        issues[`dns:${index}`] = "DNS 服务器地址格式不正确";
      }
    });
  }

  if (form.metric !== null && !isMetricValue(form.metric)) {
    issues["metric"] = `接口跃点数应为 0 - ${MAX_METRIC} 之间的整数`;
  }

  return issues;
}

/** Only call once {@link validateForm} is clean. */
export function buildRequest(adapterId: string, form: HomeForm): ApplyRequest {
  const addresses: AddressSpec[] =
    form.mode === "static"
      ? form.addresses
          .filter((row) => row.address.trim().length > 0)
          .map((row) => {
            const prefix = parseMaskText(row.mask) ?? 24;
            return { address: row.address.trim(), prefix, mask: maskFromPrefix(prefix) };
          })
      : [];

  return {
    adapterId,
    dhcp: form.mode === "dhcp",
    addresses,
    gateway: form.mode === "static" && form.gateway.trim() ? form.gateway.trim() : null,
    gatewayMetric: form.mode === "static" ? form.gatewayMetric : null,
    dnsMode: form.dnsMode,
    dns: form.dnsMode === "static" ? form.dns.map((server) => server.trim()).filter(Boolean) : [],
    metric: form.metric,
  };
}

export function addressSummary(adapter: AdapterInfo): string {
  if (adapter.ipv4.addresses.length === 0) {
    return adapter.dhcpEnabled ? "未获取到 IP（DHCP）" : "未配置 IP";
  }
  return adapter.ipv4.addresses.map((entry) => `${entry.address}/${entry.prefix}`).join("、");
}
