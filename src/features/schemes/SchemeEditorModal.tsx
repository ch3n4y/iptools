import { Alert, Button, Input, Modal, Select, Space, Switch, Tag, Tooltip, Typography } from "antd";
import { DeleteOutlined, EnvironmentOutlined, PlusOutlined } from "@ant-design/icons";
import { useEffect, useState, type ReactNode } from "react";
import StatusBanner from "../../components/StatusBanner";
import type { AppError } from "../../lib/errors";
import { formatTimestamp } from "../../lib/format";
import type { AdapterInfo, AddressSpec, Scheme } from "../../lib/types";
import {
  addressSpecOf,
  blankScheme,
  isValidIpv4,
  parseOptionalNumber,
} from "./address";

interface AddressRow {
  address: string;
  mask: string;
}

interface Props {
  open: boolean;
  /** null = create a new scheme. */
  scheme: Scheme | null;
  adapter: AdapterInfo | null;
  hostname: string | null;
  saving: boolean;
  error: AppError | null;
  onCancel: () => void;
  onSubmit: (scheme: Scheme) => void;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <span className="kv__label">{label}</span>
      {children}
      {hint ? <span className="kv__label">{hint}</span> : null}
    </div>
  );
}

export default function SchemeEditorModal({
  open,
  scheme,
  adapter,
  hostname,
  saving,
  error,
  onCancel,
  onSubmit,
}: Props) {
  const [draft, setDraft] = useState<Scheme>(() => scheme ?? blankScheme());
  const [rows, setRows] = useState<AddressRow[]>([]);
  const [gatewayMetricText, setGatewayMetricText] = useState("");
  const [metricText, setMetricText] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const next = scheme ?? blankScheme();
    setDraft(next);
    setRows(
      next.addresses.length > 0
        ? next.addresses.map((spec) => ({ address: spec.address, mask: spec.mask }))
        : [{ address: "", mask: "255.255.255.0" }],
    );
    setGatewayMetricText(next.gatewayMetric === null ? "" : String(next.gatewayMetric));
    setMetricText(next.metric === null ? "" : String(next.metric));
    setFormError(null);
  }, [open, scheme]);

  const patch = (partial: Partial<Scheme>) => setDraft((prev) => ({ ...prev, ...partial }));

  const updateRow = (index: number, partial: Partial<AddressRow>) =>
    setRows((prev) => prev.map((row, position) => (position === index ? { ...row, ...partial } : row)));

  const fillFromAdapter = () => {
    if (!adapter) return;
    patch({
      matchMac: adapter.mac,
      matchHostname: hostname,
      matchAdapterName: adapter.name,
    });
  };

  const submit = () => {
    const name = draft.name.trim();
    if (!name) {
      setFormError("请填写方案名称");
      return;
    }

    const addresses: AddressSpec[] = [];
    if (!draft.dhcp) {
      const filled = rows.filter((row) => row.address.trim() !== "");
      if (filled.length === 0) {
        setFormError("手动设置模式下至少需要填写一个 IP 地址");
        return;
      }
      for (const [index, row] of filled.entries()) {
        const spec = addressSpecOf(row.address, row.mask);
        if (!spec) {
          setFormError(
            `第 ${index + 1} 个地址不合法：IP 需为 192.168.1.10 形式，掩码可填 255.255.255.0 或 24`,
          );
          return;
        }
        addresses.push(spec);
      }
    }

    const gatewayMetric = draft.dhcp ? null : parseOptionalNumber(gatewayMetricText);
    if (gatewayMetric === undefined) {
      setFormError("网关跃点数只能是数字");
      return;
    }
    const metric = parseOptionalNumber(metricText);
    if (metric === undefined) {
      setFormError("接口跃点数只能是数字");
      return;
    }

    const gateway = draft.dhcp || !draft.gateway?.trim() ? null : draft.gateway.trim();
    if (gateway && !isValidIpv4(gateway)) {
      setFormError("默认网关不合法，应形如 192.168.1.1");
      return;
    }

    const dns = draft.dns.map((server) => server.trim()).filter((server) => server !== "");
    if (draft.dnsMode === "static") {
      if (dns.length === 0) {
        setFormError("DNS 为手动设置时至少填写一个服务器地址");
        return;
      }
      const bad = dns.find((server) => !isValidIpv4(server));
      if (bad) {
        setFormError(`DNS 服务器不合法：${bad}`);
        return;
      }
    }

    setFormError(null);
    onSubmit({
      ...draft,
      name,
      tags: draft.tags.map((tag) => tag.trim()).filter((tag) => tag !== ""),
      note: draft.note.trim(),
      matchMac: draft.matchMac?.trim() ? draft.matchMac.trim() : null,
      matchHostname: draft.matchHostname?.trim() ? draft.matchHostname.trim() : null,
      matchAdapterName: draft.matchAdapterName?.trim() ? draft.matchAdapterName.trim() : null,
      addresses: draft.dhcp ? [] : addresses,
      gateway: draft.dhcp ? null : gateway,
      gatewayMetric: draft.dhcp ? null : gatewayMetric,
      dnsMode: draft.dnsMode,
      dns: draft.dnsMode === "static" ? dns : [],
      metric,
    });
  };

  const editing = !!scheme && scheme.id !== "";

  return (
    <Modal
      open={open}
      title={editing ? `编辑方案：${scheme?.name ?? ""}` : "新建方案"}
      width={760}
      okText={saving ? "保存中…" : "保存方案"}
      cancelText="取消"
      confirmLoading={saving}
      maskClosable={!saving}
      onOk={submit}
      onCancel={saving ? undefined : onCancel}
      destroyOnHidden
    >
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        {formError ? <Alert type="error" showIcon message={formError} /> : null}
        {error ? <StatusBanner level="error" title="保存方案失败" error={error} /> : null}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="方案名称（必填）">
            <Input
              value={draft.name}
              aria-label="方案名称"
              placeholder="例如：办公室固定 IP"
              onChange={(event) => patch({ name: event.target.value })}
            />
          </Field>
          <Field label="标签" hint="回车分隔，用于分类筛选">
            <Select
              mode="tags"
              value={draft.tags}
              aria-label="标签"
              placeholder="常用 / 出差 / 调试"
              tokenSeparators={[",", ";", " ", "，"]}
              onChange={(value: string[]) => patch({ tags: value })}
              style={{ width: "100%" }}
            />
          </Field>
        </div>

        <Field label="备注">
          <Input.TextArea
            value={draft.note}
            aria-label="备注"
            rows={2}
            placeholder="可选，说明这个方案的用途"
            onChange={(event) => patch({ note: event.target.value })}
          />
        </Field>

        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <Typography.Text strong>匹配规则</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              留空表示通用方案；填写后会在列表中标记是否匹配当前网卡
            </Typography.Text>
            <Tooltip title={adapter ? "填入当前选中网卡的 MAC / 主机名 / 网卡名" : "未选择网卡"}>
              <Button
                size="small"
                icon={<EnvironmentOutlined />}
                disabled={!adapter}
                onClick={fillFromAdapter}
              >
                使用当前网卡
              </Button>
            </Tooltip>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <Field label="匹配 MAC">
              <Input
                value={draft.matchMac ?? ""}
                aria-label="匹配 MAC"
                className="mono"
                placeholder="E8-80-88-85-62-11"
                onChange={(event) => patch({ matchMac: event.target.value })}
              />
            </Field>
            <Field label="匹配主机名">
              <Input
                value={draft.matchHostname ?? ""}
                aria-label="匹配主机名"
                className="mono"
                placeholder="DESKTOP-XXXX"
                onChange={(event) => patch({ matchHostname: event.target.value })}
              />
            </Field>
            <Field label="匹配网卡名">
              <Input
                value={draft.matchAdapterName ?? ""}
                aria-label="匹配网卡名"
                placeholder="以太网"
                onChange={(event) => patch({ matchAdapterName: event.target.value })}
              />
            </Field>
          </div>
        </div>

        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
            <Typography.Text strong>IP 配置</Typography.Text>
            <Space size={6}>
              <Switch
                checked={draft.dhcp}
                checkedChildren="自动"
                unCheckedChildren="手动"
                onChange={(checked) => patch({ dhcp: checked })}
              />
              <span className="kv__label">自动获取 IP 地址（DHCP）</span>
            </Space>
          </div>

          {draft.dhcp ? (
            <Alert
              type="info"
              showIcon
              message="该方案将把网卡切回 DHCP，下面的地址与网关不会被写入。"
            />
          ) : (
            <Space direction="vertical" size={8} style={{ width: "100%" }}>
              {rows.map((row, index) => (
                <div key={index} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <Input
                    value={row.address}
                    aria-label={`第 ${index + 1} 个 IP 地址`}
                    className="mono"
                    placeholder="192.168.1.10"
                    onChange={(event) => updateRow(index, { address: event.target.value })}
                  />
                  <Input
                    value={row.mask}
                    aria-label={`第 ${index + 1} 个 IP 的子网掩码`}
                    className="mono"
                    style={{ width: 190 }}
                    placeholder="255.255.255.0"
                    onChange={(event) => updateRow(index, { mask: event.target.value })}
                  />
                  <Tooltip title="删除该地址">
                    <Button
                      type="text"
                      danger
                      aria-label={`删除第 ${index + 1} 个地址`}
                      icon={<DeleteOutlined />}
                      disabled={saving || rows.length <= 1}
                      onClick={() =>
                        setRows((prev) => prev.filter((_, position) => position !== index))
                      }
                    />
                  </Tooltip>
                </div>
              ))}
              <Space>
                <Button
                  size="small"
                  icon={<PlusOutlined />}
                  disabled={saving || rows.length >= 6}
                  onClick={() => setRows((prev) => [...prev, { address: "", mask: "255.255.255.0" }])}
                >
                  添加地址（最多 6 个）
                </Button>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  掩码可填 255.255.255.0 或 24
                </Typography.Text>
              </Space>
            </Space>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          <Field label="默认网关">
            <Input
              value={draft.gateway ?? ""}
              aria-label="默认网关"
              className="mono"
              disabled={draft.dhcp}
              placeholder="192.168.1.1"
              onChange={(event) => patch({ gateway: event.target.value })}
            />
          </Field>
          <Field label="网关跃点数">
            <Input
              value={gatewayMetricText}
              aria-label="网关跃点数"
              className="mono"
              inputMode="numeric"
              disabled={draft.dhcp}
              placeholder="留空为自动"
              onChange={(event) => setGatewayMetricText(event.target.value)}
            />
          </Field>
          <Field label="接口跃点数">
            <Input
              value={metricText}
              aria-label="接口跃点数"
              className="mono"
              inputMode="numeric"
              placeholder="留空为自动"
              onChange={(event) => setMetricText(event.target.value)}
            />
          </Field>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: 12 }}>
          <Field label="DNS 模式">
            <Select
              value={draft.dnsMode}
              aria-label="DNS 模式"
              style={{ width: "100%" }}
              onChange={(value: "dhcp" | "static") => patch({ dnsMode: value })}
              options={[
                { value: "dhcp", label: "自动获取" },
                { value: "static", label: "手动设置" },
              ]}
            />
          </Field>
          <Field label="DNS 服务器" hint="回车分隔多个地址，例如 223.5.5.5">
            <Select
              mode="tags"
              value={draft.dns}
              aria-label="DNS 服务器"
              className="mono"
              disabled={draft.dnsMode === "dhcp"}
              placeholder={draft.dnsMode === "dhcp" ? "自动获取，无需填写" : "223.5.5.5"}
              tokenSeparators={[",", ";", " ", "，"]}
              onChange={(value: string[]) => patch({ dns: value })}
              style={{ width: "100%" }}
            />
          </Field>
        </div>

        {editing ? (
          <div className="tag-row">
            <Tag>创建：{formatTimestamp(scheme?.createdAtMs ?? 0)}</Tag>
            <Tag>更新：{formatTimestamp(scheme?.updatedAtMs ?? 0)}</Tag>
            <Tag>ID：{scheme?.id}</Tag>
          </div>
        ) : null}
      </Space>
    </Modal>
  );
}
