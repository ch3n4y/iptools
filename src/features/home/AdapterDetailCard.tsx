import { App as AntApp, Button, Space, Tag, Tooltip } from "antd";
import { CopyOutlined } from "@ant-design/icons";
import type { CSSProperties, ReactNode } from "react";
import AdapterStatusTag from "../../components/AdapterStatusTag";
import SectionCard from "../../components/SectionCard";
import { formatSpeed } from "../../lib/format";
import type { AdapterInfo } from "../../lib/types";

interface Props {
  adapter: AdapterInfo;
  disabled: boolean;
}

/** Inline replacement for <Space> inside the span-based `.kv__value`. */
const INLINE_VALUE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  maxWidth: "100%",
};

const INLINE_VALUE_START: CSSProperties = { ...INLINE_VALUE, alignItems: "flex-start" };

function Kv({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="kv">
      <span className="kv__label">{label}</span>
      <span className={mono ? "kv__value kv__value--mono" : "kv__value"}>{value}</span>
    </div>
  );
}

function dnsSourceLabel(source: string): string {
  if (source === "dhcp") return "自动获取（DHCP）";
  if (source === "static") return "手动设置（静态）";
  return source || "未知";
}

/** Read-only snapshot of the selected adapter, mirroring the original tool's detail pane. */
export default function AdapterDetailCard({ adapter, disabled }: Props) {
  const { message } = AntApp.useApp();

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      message.success(`已复制${label}`);
    } catch {
      message.warning("当前环境不允许访问剪贴板，请手动选择复制");
    }
  };

  const copyButton = (text: string | null, label: string) => (
    <Button
      type="text"
      size="small"
      icon={<CopyOutlined />}
      disabled={disabled || !text}
      aria-label={`复制${label}`}
      onClick={() => {
        if (text) void copy(text, label);
      }}
    />
  );

  return (
    <SectionCard
      title="选中网卡详情"
      hint={adapter.name}
      extra={
        <Space size={8}>
          <AdapterStatusTag adapter={adapter} />
          {adapter.isWireless ? <Tag>无线</Tag> : null}
          {adapter.isVirtual ? <Tag>虚拟</Tag> : null}
          {adapter.dhcpEnabled ? <Tag color="blue">DHCP</Tag> : <Tag color="geekblue">静态</Tag>}
        </Space>
      }
    >
      <div className="kv-grid">
        <Kv label="描述" value={adapter.description || "（无描述）"} />
        <Kv
          label="当前 MAC"
          mono
          value={
            <span style={INLINE_VALUE}>
              <span className="mono">{adapter.mac || "—"}</span>
              {copyButton(adapter.mac, "当前 MAC")}
            </span>
          }
        />
        <Kv
          label="永久 MAC"
          mono
          value={
            <span style={INLINE_VALUE}>
              <span className="mono">{adapter.permanentMac ?? "未读取到"}</span>
              {copyButton(adapter.permanentMac, "永久 MAC")}
            </span>
          }
        />
        <Kv
          label="MAC 覆盖值"
          mono
          value={
            adapter.macOverride ? (
              <span style={INLINE_VALUE}>
                <span className="mono">{adapter.macOverride}</span>
                {copyButton(adapter.macOverride, "MAC 覆盖值")}
              </span>
            ) : (
              "未设置"
            )
          }
        />
        <Kv label="MTU" mono value={adapter.mtu > 0 ? String(adapter.mtu) : "—"} />
        <Kv label="链路速度" mono value={formatSpeed(adapter.linkSpeedBps)} />
        <Kv
          label="接口跃点数"
          mono
          value={adapter.metric === null ? "自动" : String(adapter.metric)}
        />
        <Kv
          label="IPv4 地址"
          mono
          value={
            adapter.ipv4.addresses.length > 0
              ? adapter.ipv4.addresses
                  .map((entry) => `${entry.address}/${entry.prefix}`)
                  .join("、")
              : "—"
          }
        />
        <Kv label="默认网关" mono value={adapter.ipv4.gateway ?? "自动 / 未设置"} />
        <Kv
          label="IP 获取方式"
          value={adapter.dhcpEnabled ? "自动获取（DHCP）" : "手动设置（静态）"}
        />
        <Kv
          label="DNS 来源"
          value={`${dnsSourceLabel(adapter.dns.source)}${
            adapter.dns.servers.length > 0 ? ` · ${adapter.dns.servers.join("、")}` : ""
          }`}
        />
        <Kv label="媒体类型" value={adapter.mediaType || "未知"} />
        <Kv
          label="设备实例 ID"
          mono
          value={
            <span style={INLINE_VALUE_START}>
              <span className="mono" style={{ wordBreak: "break-all", fontSize: "var(--fs-xs)" }}>
                {adapter.deviceInstanceId ?? "—"}
              </span>
              {copyButton(adapter.deviceInstanceId, "设备实例 ID")}
            </span>
          }
        />
        <Kv
          label="网卡 ID"
          mono
          value={<Tooltip title={adapter.id}>{adapter.id}</Tooltip>}
        />
      </div>
    </SectionCard>
  );
}
