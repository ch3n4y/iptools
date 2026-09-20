import { Tag } from "antd";
import type { AdapterInfo, Scheme } from "../../lib/types";
import { normalizeMacKey } from "./address";

interface MatchProps {
  scheme: Scheme;
  adapter: AdapterInfo | null;
  hostname: string | null;
}

/** MAC / hostname / adapter-name rule, flagged when it matches the current adapter. */
export function SchemeMatchCell({ scheme, adapter, hostname }: MatchProps) {
  const macHit =
    !!scheme.matchMac && !!adapter && normalizeMacKey(adapter.mac) === normalizeMacKey(scheme.matchMac);
  const hostHit =
    !!scheme.matchHostname &&
    !!hostname &&
    scheme.matchHostname.trim().toLowerCase() === hostname.trim().toLowerCase();
  const nameHit =
    !!scheme.matchAdapterName &&
    !!adapter &&
    scheme.matchAdapterName.trim().toLowerCase() === adapter.name.trim().toLowerCase();

  const items: Array<{ label: string; value: string; hit: boolean }> = [];
  if (scheme.matchMac) items.push({ label: "MAC", value: scheme.matchMac, hit: macHit });
  if (scheme.matchHostname) items.push({ label: "主机名", value: scheme.matchHostname, hit: hostHit });
  if (scheme.matchAdapterName) {
    items.push({ label: "网卡名", value: scheme.matchAdapterName, hit: nameHit });
  }

  const matched = items.some((item) => item.hit);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {matched ? (
        <Tag color="green" style={{ alignSelf: "flex-start", marginInlineEnd: 0 }}>
          匹配当前网卡
        </Tag>
      ) : null}
      {items.length === 0 ? (
        <span className="kv__label">通用（未限制匹配）</span>
      ) : (
        items.map((item) => (
          <span className="cell-mono" key={item.label}>
            {item.label}：{item.value}
            {item.hit ? (
              <span aria-hidden="true" title="与当前网卡一致">
                {" "}
                ✔
              </span>
            ) : null}
          </span>
        ))
      )}
    </div>
  );
}

/** DHCP or IP/mask list, gateway, DNS and metrics in one compact cell. */
export function SchemeSummaryCell({ scheme }: { scheme: Scheme }) {
  const gatewayMetric = scheme.gatewayMetric === null ? "" : `（跃点 ${scheme.gatewayMetric}）`;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span className="cell-mono">
        {scheme.dhcp
          ? "自动获取（DHCP）"
          : scheme.addresses.length > 0
            ? scheme.addresses.map((spec) => `${spec.address}/${spec.prefix}`).join("，")
            : "未配置地址"}
      </span>
      {!scheme.dhcp ? (
        <span className="cell-mono">
          网关：{scheme.gateway ? scheme.gateway : "无"}
          {gatewayMetric}
        </span>
      ) : null}
      <span className="cell-mono">
        DNS：{scheme.dnsMode === "dhcp" ? "自动获取" : scheme.dns.length > 0 ? scheme.dns.join("，") : "未设置"}
      </span>
      <span className="cell-mono">接口跃点数：{scheme.metric === null ? "自动" : scheme.metric}</span>
    </div>
  );
}
