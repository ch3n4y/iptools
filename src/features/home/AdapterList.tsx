import { Button, Checkbox, Empty, Input, Space, Tag, Typography } from "antd";
import { ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { useMemo, useState, type CSSProperties } from "react";
import AdapterStatusTag from "../../components/AdapterStatusTag";
import SectionCard from "../../components/SectionCard";
import { formatRelative } from "../../lib/format";
import type { AdapterInfo } from "../../lib/types";
import { addressSummary } from "./homeForm";

interface Props {
  adapters: AdapterInfo[];
  selectedAdapterId: string | null;
  loading: boolean;
  disabled: boolean;
  lastRefreshedAt: number;
  onSelect: (adapterId: string) => void;
  onRefresh: () => void;
}

function rowStyle(selected: boolean): CSSProperties {
  return {
    width: "100%",
    textAlign: "left",
    display: "block",
    padding: "8px 12px",
    border: `1px solid ${selected ? "var(--accent-line)" : "var(--line)"}`,
    background: selected ? "var(--accent-soft)" : "var(--surface-inset)",
    color: "inherit",
    borderRadius: "var(--r-sm)",
    cursor: "pointer",
    lineHeight: 1.5,
  };
}

/** Adapter picker: search + filters over the store's adapter list. */
export default function AdapterList({
  adapters,
  selectedAdapterId,
  loading,
  disabled,
  lastRefreshedAt,
  onSelect,
  onRefresh,
}: Props) {
  const [query, setQuery] = useState("");
  const [hideVirtual, setHideVirtual] = useState(false);
  const [onlyConnected, setOnlyConnected] = useState(false);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return adapters.filter((adapter) => {
      if (hideVirtual && adapter.isVirtual) return false;
      if (onlyConnected && adapter.status !== "connected") return false;
      if (!needle) return true;
      return `${adapter.name} ${adapter.description} ${adapter.mac}`.toLowerCase().includes(needle);
    });
  }, [adapters, query, hideVirtual, onlyConnected]);

  const selectionHidden =
    selectedAdapterId !== null && !filtered.some((adapter) => adapter.id === selectedAdapterId);

  return (
    <SectionCard
      title="网卡列表"
      hint={`共 ${adapters.length} 张，显示 ${filtered.length} 张 · 更新于 ${formatRelative(lastRefreshedAt)}`}
      extra={
        <Button icon={<ReloadOutlined />} loading={loading} disabled={disabled} onClick={onRefresh}>
          刷新
        </Button>
      }
    >
      <Space wrap size={12} style={{ marginBottom: 12 }}>
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="按名称 / 描述 / MAC 搜索"
          aria-label="搜索网卡：名称、描述或 MAC 地址"
          value={query}
          disabled={disabled}
          onChange={(event) => setQuery(event.target.value)}
          style={{ width: 260 }}
        />
        <Checkbox
          checked={hideVirtual}
          disabled={disabled}
          onChange={(event) => setHideVirtual(event.target.checked)}
        >
          隐藏虚拟网卡
        </Checkbox>
        <Checkbox
          checked={onlyConnected}
          disabled={disabled}
          onChange={(event) => setOnlyConnected(event.target.checked)}
        >
          只看已连接
        </Checkbox>
      </Space>

      {selectionHidden ? (
        <Typography.Text type="warning" style={{ display: "block", marginBottom: 8 }}>
          当前选中的网卡被筛选条件隐藏；下方详情与表单仍按该网卡显示。
        </Typography.Text>
      ) : null}

      {filtered.length === 0 ? (
        <Empty description="没有符合筛选条件的网卡" />
      ) : (
        <ul
          className="scroll-pane scroll-pane--fit"
          style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}
        >
          {filtered.map((adapter) => {
            const selected = adapter.id === selectedAdapterId;
            return (
              <li key={adapter.id}>
                <button
                  type="button"
                  aria-current={selected ? "true" : undefined}
                  disabled={disabled}
                  onClick={() => onSelect(adapter.id)}
                  style={rowStyle(selected)}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span
                      className={`status-dot status-dot--${adapter.status}`}
                      aria-hidden="true"
                    />
                    <span style={{ fontWeight: selected ? 600 : 500 }}>{adapter.name}</span>
                    <AdapterStatusTag adapter={adapter} />
                    {adapter.isWireless ? <Tag>无线</Tag> : null}
                    {adapter.isVirtual ? <Tag>虚拟</Tag> : null}
                    {!adapter.enabled ? <Tag color="orange">已停用</Tag> : null}
                    <span className="cell-mono" style={{ marginLeft: "auto", color: "var(--text-faint)" }}>
                      系统序号 #{adapter.index}
                    </span>
                  </span>
                  <span className="cell-mono" style={{ display: "block", marginTop: 4, color: "var(--text-soft)" }}>
                    {adapter.mac} · {addressSummary(adapter)}
                  </span>
                  <span
                    style={{
                      display: "block",
                      marginTop: 2,
                      fontSize: "var(--fs-xs)",
                      color: "var(--text-faint)",
                    }}
                  >
                    {adapter.description || "（无描述）"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
