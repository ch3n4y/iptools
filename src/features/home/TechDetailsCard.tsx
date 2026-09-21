import type { ReactNode } from "react";
import { Collapse, Tag } from "antd";
import SectionCard from "../../components/SectionCard";
import type { AdapterInfo } from "../../lib/types";

function Kv({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="kv">
      <span className="kv__label">{label}</span>
      <span className="kv__value kv__value--mono">{value}</span>
    </div>
  );
}

/** Read-only dump of the raw adapter fields, folded away until it is needed. */
export default function TechDetailsCard({ adapter }: { adapter: AdapterInfo }) {
  return (
    <SectionCard title="技术详情" hint="来自系统的原始只读字段，写入失败时可据此排查">
      <Collapse
        ghost
        size="small"
        items={[
          {
            key: "tech",
            label: "展开查看原始字段",
            children: (
              <>
                <div className="kv-grid">
                  <Kv label="网卡 ID" value={adapter.id} />
                  <Kv label="deviceInstanceId" value={adapter.deviceInstanceId ?? "—"} />
                  <Kv label="mediaType" value={adapter.mediaType || "—"} />
                  <Kv label="mtu" value={adapter.mtu} />
                  <Kv label="接口跃点数" value={adapter.metric === null ? "自动" : adapter.metric} />
                  <Kv label="isVirtual" value={adapter.isVirtual ? "true" : "false"} />
                  <Kv label="enabled" value={adapter.enabled ? "true" : "false"} />
                  <Kv label="dhcpEnabled" value={adapter.dhcpEnabled ? "true" : "false"} />
                  <Kv
                    label="dns.source"
                    value={
                      `${adapter.dns.source}${
                        adapter.dns.servers.length > 0 ? `（${adapter.dns.servers.join("，")}）` : ""
                      }`
                    }
                  />
                </div>

                <div style={{ marginTop: 12 }}>
                  <span className="kv__label">addresses（地址 / 前缀 / 来源 origin）</span>
                  {adapter.ipv4.addresses.length > 0 ? (
                    <ul className="plan-list" style={{ marginTop: 8 }}>
                      {adapter.ipv4.addresses.map((entry) => (
                        <li className="plan-row" key={`${entry.address}/${entry.prefix}`}>
                          <span className="plan-row__label">{entry.mask}</span>
                          <span className="plan-row__change cell-mono">
                            {entry.address}/{entry.prefix}
                            <Tag style={{ marginInlineEnd: 0 }}>{entry.origin}</Tag>
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="kv__label" style={{ marginTop: 4 }}>
                      没有配置 IPv4 地址（自动获取或未连接）
                    </div>
                  )}
                </div>
              </>
            ),
          },
        ]}
      />
    </SectionCard>
  );
}
