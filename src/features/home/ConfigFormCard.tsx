import {
  Alert,
  Button,
  Divider,
  Input,
  InputNumber,
  Radio,
  Space,
  Spin,
  Typography,
} from "antd";
import {
  DeleteOutlined,
  PlusOutlined,
  PoweroffOutlined,
  ReloadOutlined,
  SaveOutlined,
  ThunderboltOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import type { CSSProperties } from "react";
import SectionCard from "../../components/SectionCard";
import type { AdapterInfo } from "../../lib/types";
import {
  MAX_ADDRESS_ROWS,
  MAX_DNS_SERVERS,
  type AddressRowState,
  type HomeForm,
} from "./homeForm";

interface Props {
  adapter: AdapterInfo;
  form: HomeForm;
  /** Already filtered to the fields the user has touched. */
  errors: Record<string, string>;
  disabled: boolean;
  onPatch: (patch: Partial<HomeForm>) => void;
  onAddressPatch: (key: string, patch: Partial<AddressRowState>) => void;
  onAddressAdd: () => void;
  onAddressRemove: (key: string) => void;
  onFieldBlur: (field: string) => void;
  onDefaultMask: (key: string) => void;
  onDeriveGateway: () => void;
  onReadCurrent: () => void;
  onApply: () => void;
  onToggleEnabled: () => void;
}

const MONO_INPUT: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontVariantNumeric: "tabular-nums",
};

const addressGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(180px, 1fr) minmax(180px, 1fr) auto",
  gap: 12,
  alignItems: "start",
};

const actionColumn: CSSProperties = { display: "flex", gap: 4, paddingTop: 20 };

const sectionTitle: CSSProperties = {
  fontSize: "var(--fs-sm)",
  fontWeight: 600,
  margin: "0 0 8px",
};

const hintText: CSSProperties = { fontSize: "var(--fs-xs)", color: "var(--text-faint)" };

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <span id={id} role="alert" style={{ color: "var(--danger)", fontSize: "var(--fs-xs)" }}>
      {message}
    </span>
  );
}

/** Editable IP / gateway / DNS form for the selected adapter. */
export default function ConfigFormCard({
  adapter,
  form,
  errors,
  disabled,
  onPatch,
  onAddressPatch,
  onAddressAdd,
  onAddressRemove,
  onFieldBlur,
  onDefaultMask,
  onDeriveGateway,
  onReadCurrent,
  onApply,
  onToggleEnabled,
}: Props) {
  const manual = form.mode === "static";
  const addressesDisabled = disabled || !manual;
  const dnsDisabled = disabled || form.dnsMode !== "static";
  const remaining = MAX_ADDRESS_ROWS - form.addresses.length;

  return (
    <SectionCard
      title="IP 配置"
      hint="支持单网卡多 IP；掩码可填 255.255.255.0 或 /24"
      extra={
        <Space wrap size={8}>
          <Button icon={<ReloadOutlined />} disabled={disabled} onClick={onReadCurrent}>
            读取当前配置
          </Button>
          <Button icon={<PoweroffOutlined />} disabled={disabled} onClick={onToggleEnabled}>
            {adapter.enabled ? "禁用网卡" : "启用网卡"}
          </Button>
          <Button
            type="primary"
            danger
            icon={<SaveOutlined />}
            disabled={disabled}
            onClick={onApply}
          >
            应用配置
          </Button>
        </Space>
      }
    >
      {disabled ? (
        <Space style={{ marginBottom: 12 }}>
          <Spin size="small" />
          <Typography.Text type="secondary">正在与系统交互，请稍候…</Typography.Text>
        </Space>
      ) : null}

      {!adapter.enabled ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="该网卡当前已禁用"
          description="写入地址前请先点击「启用网卡」；禁用状态下系统会拒绝修改 IP 配置。"
        />
      ) : null}

      <div className="kv-grid">
        <div className="kv">
          <span className="kv__label" id="home-mode-label">
            获取方式
          </span>
          <Radio.Group
            aria-labelledby="home-mode-label"
            value={form.mode}
            disabled={disabled}
            onChange={(event) =>
              onPatch({ mode: event.target.value === "dhcp" ? "dhcp" : "static" })
            }
            options={[
              { label: "自动获取（DHCP）", value: "dhcp" },
              { label: "手动设置（静态）", value: "static" },
            ]}
          />
        </div>
        <div className="kv">
          <label className="kv__label" htmlFor="home-metric">
            接口跃点数（留空 = 自动）
          </label>
          <InputNumber<number>
            id="home-metric"
            style={{ ...MONO_INPUT, width: "100%" }}
            min={0}
            max={9999}
            precision={0}
            placeholder="自动"
            value={form.metric}
            disabled={disabled}
            status={errors["metric"] ? "error" : undefined}
            aria-invalid={errors["metric"] ? true : undefined}
            aria-describedby={errors["metric"] ? "home-metric-error" : undefined}
            onChange={(value) => onPatch({ metric: typeof value === "number" ? value : null })}
            onBlur={() => onFieldBlur("metric")}
          />
          <FieldError id="home-metric-error" message={errors["metric"]} />
        </div>
      </div>

      <Divider style={{ margin: "16px 0 12px" }} />

      <h3 style={sectionTitle}>IPv4 地址（最多 {MAX_ADDRESS_ROWS} 个）</h3>
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        {form.addresses.map((row, index) => {
          const ipError = errors[`ip:${row.key}`];
          const maskError = errors[`mask:${row.key}`];
          return (
            <div key={row.key} style={addressGrid}>
              <div className="kv">
                <label className="kv__label" htmlFor={`home-ip-${row.key}`}>
                  IP 地址 {index + 1}
                </label>
                <Input
                  id={`home-ip-${row.key}`}
                  className="mono"
                  style={MONO_INPUT}
                  placeholder="192.168.1.10"
                  value={row.address}
                  disabled={addressesDisabled}
                  status={ipError ? "error" : undefined}
                  aria-invalid={ipError ? true : undefined}
                  aria-describedby={ipError ? `home-ip-${row.key}-error` : undefined}
                  onChange={(event) => onAddressPatch(row.key, { address: event.target.value })}
                  onBlur={() => onFieldBlur(`ip:${row.key}`)}
                />
                <FieldError id={`home-ip-${row.key}-error`} message={ipError} />
              </div>

              <div className="kv">
                <label
                  className="kv__label"
                  htmlFor={`home-mask-${row.key}`}
                  title="双击标签可按 A / B / C 类自动填写默认掩码"
                  style={{ cursor: "pointer" }}
                  onDoubleClick={() => onDefaultMask(row.key)}
                >
                  子网掩码 {index + 1}（双击标签填默认值）
                </label>
                <Input
                  id={`home-mask-${row.key}`}
                  className="mono"
                  style={MONO_INPUT}
                  placeholder="255.255.255.0 或 /24"
                  value={row.mask}
                  disabled={addressesDisabled}
                  status={maskError ? "error" : undefined}
                  aria-invalid={maskError ? true : undefined}
                  aria-describedby={maskError ? `home-mask-${row.key}-error` : undefined}
                  onChange={(event) => onAddressPatch(row.key, { mask: event.target.value })}
                  onBlur={() => onFieldBlur(`mask:${row.key}`)}
                />
                <FieldError id={`home-mask-${row.key}-error`} message={maskError} />
              </div>

              <div style={actionColumn}>
                <Button
                  size="small"
                  disabled={addressesDisabled}
                  onClick={() => onDefaultMask(row.key)}
                >
                  默认掩码
                </Button>
                <Button
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  disabled={disabled || form.addresses.length <= 1}
                  aria-label={`删除第 ${index + 1} 个 IP 地址`}
                  onClick={() => onAddressRemove(row.key)}
                >
                  删除
                </Button>
              </div>
            </div>
          );
        })}
      </Space>
      <Space style={{ marginTop: 8 }}>
        <Button
          icon={<PlusOutlined />}
          disabled={disabled || remaining <= 0}
          onClick={onAddressAdd}
        >
          添加地址
        </Button>
        <span style={hintText}>
          {remaining > 0 ? `还可添加 ${remaining} 个地址` : `已达上限（${MAX_ADDRESS_ROWS} 个）`}
        </span>
      </Space>

      <Divider style={{ margin: "16px 0 12px" }} />

      <h3 style={sectionTitle}>默认网关</h3>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(180px, 1fr) auto",
          gap: 12,
          alignItems: "start",
        }}
      >
        <div className="kv">
          <label
            className="kv__label"
            htmlFor="home-gateway"
            title="双击标签可按第一个地址所在子网自动推导网关"
            style={{ cursor: "pointer" }}
            onDoubleClick={onDeriveGateway}
          >
            默认网关（双击标签自动推导）
          </label>
          <Input
            id="home-gateway"
            className="mono"
            style={MONO_INPUT}
            placeholder="192.168.1.1"
            value={form.gateway}
            disabled={addressesDisabled}
            status={errors["gateway"] ? "error" : undefined}
            aria-invalid={errors["gateway"] ? true : undefined}
            aria-describedby={errors["gateway"] ? "home-gateway-error" : undefined}
            onChange={(event) => onPatch({ gateway: event.target.value })}
            onBlur={() => onFieldBlur("gateway")}
          />
          <FieldError id="home-gateway-error" message={errors["gateway"]} />
        </div>
        <div style={actionColumn}>
          <Button
            icon={<ThunderboltOutlined />}
            disabled={addressesDisabled}
            onClick={onDeriveGateway}
          >
            按子网推导
          </Button>
        </div>
      </div>

      <Divider style={{ margin: "16px 0 12px" }} />

      <h3 style={sectionTitle}>DNS 服务器（最多 {MAX_DNS_SERVERS} 个）</h3>
      <div className="kv" style={{ marginBottom: 12 }}>
        <span className="kv__label" id="home-dns-mode-label">
          DNS 获取方式
        </span>
        <Radio.Group
          aria-labelledby="home-dns-mode-label"
          value={form.dnsMode}
          disabled={disabled}
          onChange={(event) =>
            onPatch({ dnsMode: event.target.value === "static" ? "static" : "dhcp" })
          }
          options={[
            { label: "自动获取", value: "dhcp" },
            { label: "手动设置", value: "static" },
          ]}
        />
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${MAX_DNS_SERVERS}, minmax(150px, 1fr))`,
          gap: 12,
          alignItems: "start",
        }}
      >
        {form.dns.map((server, index) => {
          const error = errors[`dns:${index}`];
          return (
            <div className="kv" key={`dns-${index}`}>
              <label className="kv__label" htmlFor={`home-dns-${index}`}>
                DNS 服务器 {index + 1}
              </label>
              <Input
                id={`home-dns-${index}`}
                className="mono"
                style={MONO_INPUT}
                placeholder={index === 0 ? "223.5.5.5" : "留空表示不使用"}
                value={server}
                disabled={dnsDisabled}
                status={error ? "error" : undefined}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `home-dns-${index}-error` : undefined}
                onChange={(event) => {
                  const next = form.dns.map((item, position) =>
                    position === index ? event.target.value : item,
                  );
                  onPatch({ dns: next });
                }}
                onBlur={() => onFieldBlur(`dns:${index}`)}
              />
              <FieldError id={`home-dns-${index}-error`} message={error} />
            </div>
          );
        })}
      </div>

      <Divider style={{ margin: "16px 0 12px" }} />

      <div className="danger-note">
        <WarningOutlined style={{ marginTop: 3 }} />
        <span>
          「应用配置」会立即写入系统网络配置，可能导致当前连接短暂中断。写入前会弹出变更预览并要求二次确认，
          写入后自动读回校验，校验不通过时尝试恢复修改前的配置。
        </span>
      </div>
    </SectionCard>
  );
}
