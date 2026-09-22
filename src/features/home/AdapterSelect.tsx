import { Button, Checkbox, Select, Space } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { useMemo, useState } from "react";
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

const STATUS_TEXT: Record<AdapterInfo["status"], string> = {
  connected: "已连接",
  disconnected: "未连接",
  disabled: "已禁用",
  faulty: "设备异常",
  unknown: "未知",
};

/**
 * 网卡选择器：默认只显示一行下拉，把「名称 · 状态 · 地址」放在选项里，
 * 其余细节（描述、MAC、序号…）留给「网卡信息与诊断」折叠区，避免首页铺满信息。
 */
export default function AdapterSelect({
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
      // 已选中的网卡始终保留，否则筛选后下拉会显示成裸 ID
      if (adapter.id === selectedAdapterId) return true;
      if (hideVirtual && adapter.isVirtual) return false;
      if (onlyConnected && adapter.status !== "connected") return false;
      if (!needle) return true;
      return `${adapter.name} ${adapter.description} ${adapter.mac}`.toLowerCase().includes(needle);
    });
  }, [adapters, query, hideVirtual, onlyConnected, selectedAdapterId]);

  return (
    <Space wrap size={8} style={{ marginBottom: 12 }}>
      <Select
        showSearch
        value={selectedAdapterId}
        placeholder="选择网卡"
        aria-label="选择网卡"
        loading={loading}
        disabled={disabled}
        style={{ minWidth: 320 }}
        searchValue={query}
        onSearch={setQuery}
        filterOption={false}
        onChange={(value) => {
          setQuery("");
          onSelect(value);
        }}
        options={filtered.map((adapter) => ({
          value: adapter.id,
          label: `${adapter.name} · ${STATUS_TEXT[adapter.status]} · ${addressSummary(adapter)}`,
        }))}
      />
      <Button icon={<ReloadOutlined />} loading={loading} disabled={disabled} onClick={onRefresh}>
        刷新
      </Button>
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
      <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-faint)" }}>
        共 {adapters.length} 张 · 显示 {filtered.length} 张 · 更新于 {formatRelative(lastRefreshedAt)}
      </span>
    </Space>
  );
}
