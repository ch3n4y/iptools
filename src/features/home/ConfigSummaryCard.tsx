import { Button, Space, Tag } from "antd";
import { EditOutlined } from "@ant-design/icons";
import type { ReactNode } from "react";
import AdapterStatusTag from "../../components/AdapterStatusTag";
import SectionCard from "../../components/SectionCard";
import type { AdapterInfo } from "../../lib/types";
import { parseMaskText } from "./netmask";
import type { HomeForm } from "./homeForm";

interface Props {
  adapter: AdapterInfo;
  form: HomeForm;
  disabled: boolean;
  onEdit: () => void;
}

function Kv({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="kv">
      <span className="kv__label">{label}</span>
      <span className={mono ? "kv__value kv__value--mono" : "kv__value"}>{value}</span>
    </div>
  );
}

/**
 * 「IP 配置」的只读视图，和编辑表单共用同一个卡片位置与同一份表单数据：
 * 默认看到的就是当前配置（进入页面、读取当前配置、写入成功后都回到这里），
 * 需要改动时点「编辑」切到输入态。
 */
export default function ConfigSummaryCard({ adapter, form, disabled, onEdit }: Props) {
  const addresses = form.addresses
    .map((row) => ({ address: row.address.trim(), mask: row.mask.trim() }))
    .filter((row) => row.address.length > 0)
    .map((row) => {
      const prefix = parseMaskText(row.mask);
      return prefix === null ? row.address : `${row.address}/${prefix}`;
    });

  const dns = form.dns.map((server) => server.trim()).filter(Boolean);

  return (
    <SectionCard
      title="IP 配置"
      hint={form.mode === "dhcp" ? "自动获取（DHCP）" : "手动设置（静态）"}
      extra={
        <Space size={8}>
          <AdapterStatusTag adapter={adapter} />
          {form.mode === "dhcp" ? <Tag color="blue">DHCP</Tag> : <Tag color="geekblue">静态</Tag>}
          <Button type="primary" icon={<EditOutlined />} disabled={disabled} onClick={onEdit}>
            编辑
          </Button>
        </Space>
      }
    >
      <div className="kv-grid">
        <Kv
          label="IPv4 地址"
          mono
          value={addresses.length > 0 ? addresses.join("、") : "未配置（自动获取或未连接）"}
        />
        <Kv
          label="默认网关"
          mono
          value={form.gateway.trim() ? form.gateway.trim() : "自动 / 未设置"}
        />
        <Kv
          label="DNS 服务器"
          mono
          value={form.dnsMode === "static" ? dns.join("、") || "未填写" : "自动获取（DHCP）"}
        />
        <Kv label="接口跃点数" mono value={form.metric === null ? "自动" : String(form.metric)} />
      </div>
    </SectionCard>
  );
}
