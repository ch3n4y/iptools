import {
  Alert,
  App as AntApp,
  Button,
  Input,
  Popconfirm,
  Select,
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  AimOutlined,
  CheckCircleOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  DownloadOutlined,
  PlusOutlined,
  PoweroffOutlined,
  ReloadOutlined,
  SaveOutlined,
  SwapOutlined,
  SyncOutlined,
  ThunderboltOutlined,
  UndoOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { useEffect, useRef, useState } from "react";
import AdapterStatusTag from "../../components/AdapterStatusTag";
import ConfirmApplyDialog from "../../components/ConfirmApplyDialog";
import SectionCard from "../../components/SectionCard";
import StatusBanner from "../../components/StatusBanner";
import { adapters as adaptersApi, schemes as schemesApi } from "../../lib/api";
import { toAppError, type AppError } from "../../lib/errors";
import { formatTimestamp } from "../../lib/format";
import type {
  AdapterBackup,
  AdapterInfo,
  AddressSpec,
  ApplyPlan,
  ApplyRequest,
  ApplyResult,
  DnsMode,
  Scheme,
} from "../../lib/types";
import { currentAdapter, useAppStore } from "../../state/store";
import ApplyResultPanel, { describeApplyResult } from "../schemes/ApplyResultPanel";
import { addressSpecOf, isValidIpv4, parseOptionalNumber } from "../schemes/address";

interface Banner {
  level: "info" | "success" | "warning" | "error";
  title: string;
  message?: string | null;
  error?: AppError | null;
}

interface AddressRow {
  address: string;
  mask: string;
}

interface Pending {
  request: ApplyRequest;
  action: string;
  title: string;
}

type BuildResult = { ok: true; request: ApplyRequest } | { ok: false; message: string };

const CLASS_MASK_HINT = "按 A/B/C 类地址填写默认掩码（255.0.0.0 / 255.255.0.0 / 255.255.255.0）";

export default function AdvancedView() {
  const { message } = AntApp.useApp();
  const adapters = useAppStore((state) => state.adapters);
  const selectedAdapterId = useAppStore((state) => state.selectedAdapterId);
  const selectAdapter = useAppStore((state) => state.selectAdapter);
  const refreshAdapters = useAppStore((state) => state.refreshAdapters);
  const refreshSchemes = useAppStore((state) => state.refreshSchemes);
  const identity = useAppStore((state) => state.identity);
  const adapter = useAppStore(currentAdapter);

  const [dhcp, setDhcp] = useState(false);
  const [rows, setRows] = useState<AddressRow[]>([{ address: "", mask: "255.255.255.0" }]);
  const [gateway, setGateway] = useState("");
  const [gatewayMetric, setGatewayMetric] = useState("");
  const [dnsMode, setDnsMode] = useState<DnsMode>("dhcp");
  const [dns, setDns] = useState<string[]>([]);
  const [metric, setMetric] = useState("");
  const [schemeName, setSchemeName] = useState("");

  const [working, setWorking] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [validation, setValidation] = useState<ApplyPlan | null>(null);

  const [pending, setPending] = useState<Pending | null>(null);
  const [plan, setPlan] = useState<ApplyPlan | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [planLoading, setPlanLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [lastResult, setLastResult] = useState<{ result: ApplyResult; action: string } | null>(null);

  const [backup, setBackup] = useState<{ backup: AdapterBackup; capturedAtMs: number } | null>(null);

  const adapterId = adapter?.id ?? selectedAdapterId ?? null;
  const hostname = identity?.computerName ?? null;
  const busy = working || applying || planLoading;

  const loadedIdRef = useRef<string | null>(null);

  const fillFrom = (info: AdapterInfo) => {
    setDhcp(info.dhcpEnabled);
    setRows(
      info.ipv4.addresses.length > 0
        ? info.ipv4.addresses.map((entry) => ({ address: entry.address, mask: entry.mask }))
        : [{ address: "", mask: "255.255.255.0" }],
    );
    setGateway(info.ipv4.gateway ?? "");
    setGatewayMetric(info.ipv4.gatewayMetric === null ? "" : String(info.ipv4.gatewayMetric));
    setDnsMode(info.dns.source === "static" && info.dns.servers.length > 0 ? "static" : "dhcp");
    setDns(info.dns.servers);
    setMetric(info.metric === null ? "" : String(info.metric));
    setValidation(null);
    setFormError(null);
  };

  useEffect(() => {
    if (!adapter) {
      loadedIdRef.current = null;
      return;
    }
    if (loadedIdRef.current === adapter.id) return;
    loadedIdRef.current = adapter.id;
    fillFrom(adapter);
  }, [adapter]);

  useEffect(() => {
    setBackup(null);
  }, [adapterId]);

  const updateRow = (index: number, partial: Partial<AddressRow>) =>
    setRows((prev) =>
      prev.map((row, position) => (position === index ? { ...row, ...partial } : row)),
    );

  const reloadFromAdapter = () => {
    if (!adapter) {
      message.warning("请先选择目标网卡");
      return;
    }
    fillFrom(adapter);
    message.success(`已读取「${adapter.name}」当前配置到表单`);
  };

  const buildRequest = (targetId: string): BuildResult => {
    const addresses: AddressSpec[] = [];
    if (!dhcp) {
      const filled = rows.filter((row) => row.address.trim() !== "");
      if (filled.length === 0) {
        return { ok: false, message: "手动设置模式下至少需要填写一个 IP 地址" };
      }
      for (const [index, row] of filled.entries()) {
        const spec = addressSpecOf(row.address, row.mask);
        if (!spec) {
          return {
            ok: false,
            message: `第 ${index + 1} 个地址不合法：IP 需为 192.168.1.10 形式，掩码可填 255.255.255.0 或 24`,
          };
        }
        addresses.push(spec);
      }
    }

    let gatewayText = "";
    let gatewayMetricValue: number | null = null;
    if (!dhcp) {
      gatewayText = gateway.trim();
      if (gatewayText !== "" && !isValidIpv4(gatewayText)) {
        return { ok: false, message: "默认网关不合法，应形如 192.168.1.1" };
      }
      const parsedGatewayMetric = parseOptionalNumber(gatewayMetric);
      if (parsedGatewayMetric === undefined) {
        return { ok: false, message: "网关跃点数只能是数字" };
      }
      gatewayMetricValue = parsedGatewayMetric;
    }
    const metricValue = parseOptionalNumber(metric);
    if (metricValue === undefined) {
      return { ok: false, message: "接口跃点数只能是数字" };
    }

    const servers = dns.map((server) => server.trim()).filter((server) => server !== "");
    if (dnsMode === "static") {
      if (servers.length === 0) {
        return { ok: false, message: "DNS 为手动设置时至少填写一个服务器地址" };
      }
      const bad = servers.find((server) => !isValidIpv4(server));
      if (bad) return { ok: false, message: `DNS 服务器不合法：${bad}` };
    }

    return {
      ok: true,
      request: {
        adapterId: targetId,
        dhcp,
        addresses: dhcp ? [] : addresses,
        gateway: dhcp ? null : gatewayText === "" ? null : gatewayText,
        gatewayMetric: dhcp ? null : gatewayMetricValue,
        dnsMode,
        dns: dnsMode === "static" ? servers : [],
        metric: metricValue,
      },
    };
  };

  const runValidation = async () => {
    if (!adapterId) {
      message.warning("请先选择目标网卡");
      return;
    }
    const built = buildRequest(adapterId);
    if (!built.ok) {
      setValidation(null);
      setFormError(built.message);
      return;
    }
    setFormError(null);
    setWorking(true);
    try {
      setValidation(await adaptersApi.planApply(built.request));
    } catch (caught) {
      setValidation(null);
      setBanner({ level: "error", title: "校验配置失败", error: toAppError(caught) });
    } finally {
      setWorking(false);
    }
  };

  const openConfirm = async (request: ApplyRequest, action: string, title: string) => {
    setPending({ request, action, title });
    setPlan(null);
    setPlanOpen(true);
    setPlanLoading(true);
    try {
      setPlan(await adaptersApi.planApply(request));
    } catch (caught) {
      setPlanOpen(false);
      setPlan(null);
      setBanner({ level: "error", title: "无法生成变更预览", error: toAppError(caught) });
    } finally {
      setPlanLoading(false);
    }
  };

  const startApply = async () => {
    if (!adapterId) {
      message.warning("请先选择目标网卡");
      return;
    }
    const built = buildRequest(adapterId);
    if (!built.ok) {
      setFormError(built.message);
      setBanner({ level: "error", title: "请先修正表单内容", message: built.message });
      return;
    }
    setFormError(null);
    await openConfirm(built.request, "应用高级选项配置", "确认应用网络配置");
  };

  const startDhcpReset = async () => {
    if (!adapterId) {
      message.warning("请先选择目标网卡");
      return;
    }
    await openConfirm(
      {
        adapterId,
        dhcp: true,
        addresses: [],
        gateway: null,
        gatewayMetric: null,
        dnsMode: "dhcp",
        dns: [],
        metric: null,
      },
      "恢复为自动获取（DHCP）",
      "确认恢复为自动获取",
    );
  };

  const confirmApply = async () => {
    const current = pending;
    if (!current) return;
    setApplying(true);
    try {
      const result = await adaptersApi.applyConfig(current.request);
      const summary = describeApplyResult(result, current.action);
      setPlanOpen(false);
      setLastResult({ result, action: current.action });
      setBanner({ level: summary.level, title: summary.title, message: summary.message });
      loadedIdRef.current = null;
      await refreshAdapters({ silent: true });
    } catch (caught) {
      setPlanOpen(false);
      setBanner({ level: "error", title: `${current.action}失败`, error: toAppError(caught) });
    } finally {
      setApplying(false);
    }
  };

  const saveAsScheme = async () => {
    if (!adapterId) {
      message.warning("请先选择目标网卡");
      return;
    }
    const name = schemeName.trim();
    if (!name) {
      setFormError("请先填写要保存的方案名称");
      return;
    }
    const built = buildRequest(adapterId);
    if (!built.ok) {
      setFormError(built.message);
      return;
    }
    setFormError(null);
    setWorking(true);
    try {
      const scheme: Scheme = {
        id: "",
        name,
        tags: [],
        matchMac: adapter?.mac ?? null,
        matchHostname: hostname,
        matchAdapterName: adapter?.name ?? null,
        dhcp: built.request.dhcp,
        addresses: built.request.addresses,
        gateway: built.request.gateway,
        gatewayMetric: built.request.gatewayMetric,
        dnsMode: built.request.dnsMode,
        dns: built.request.dns,
        metric: built.request.metric,
        note: "从高级选项页保存",
        createdAtMs: 0,
        updatedAtMs: 0,
      };
      const saved = await schemesApi.saveScheme(scheme);
      await refreshSchemes();
      setSchemeName("");
      setBanner({
        level: "success",
        title: `已保存方案「${saved.name}」`,
        message: "可在「方案管理」页面中应用、编辑或导出该方案。",
      });
    } catch (caught) {
      setBanner({ level: "error", title: "保存方案失败", error: toAppError(caught) });
    } finally {
      setWorking(false);
    }
  };

  const generateGateway = async () => {
    const index = rows.findIndex((row) => row.address.trim() !== "");
    if (index < 0) {
      message.warning("请先填写 IP 地址");
      return;
    }
    const spec = addressSpecOf(rows[index].address, rows[index].mask);
    if (!spec) {
      setFormError("第 1 个地址的 IP 或掩码不合法，无法推导网关");
      return;
    }
    setWorking(true);
    try {
      const derived = await adaptersApi.deriveGateway(spec.address, spec.mask);
      if (!derived) {
        message.warning("无法从该地址推导网关（掩码过小或地址不合法）");
        return;
      }
      setGateway(derived);
      setFormError(null);
      message.success(`已按子网生成网关 ${derived}`);
    } catch (caught) {
      setBanner({ level: "error", title: "生成网关失败", error: toAppError(caught) });
    } finally {
      setWorking(false);
    }
  };

  const applyClassMask = async (index?: number) => {
    const targets = index === undefined ? rows.map((_row, position) => position) : [index];
    setWorking(true);
    try {
      const updates = new Map<number, string>();
      for (const position of targets) {
        const row = rows[position];
        if (!row || !isValidIpv4(row.address)) continue;
        updates.set(position, await adaptersApi.defaultMaskFor(row.address.trim()));
      }
      if (updates.size === 0) {
        message.warning("请先填写合法的 IP 地址");
        return;
      }
      setRows((prev) =>
        prev.map((row, position) => {
          const mask = updates.get(position);
          return mask ? { ...row, mask } : row;
        }),
      );
      message.success("已按 A/B/C 类地址填入默认掩码");
    } catch (caught) {
      setBanner({ level: "error", title: "读取默认掩码失败", error: toAppError(caught) });
    } finally {
      setWorking(false);
    }
  };

  const toggleAdapter = async () => {
    if (!adapter) return;
    setWorking(true);
    try {
      const updated = await adaptersApi.setAdapterEnabled(adapter.id, !adapter.enabled);
      await refreshAdapters({ silent: true });
      setBanner({
        level: "success",
        title: `${updated.enabled ? "已启用" : "已禁用"}网卡「${updated.name}」`,
        message: updated.enabled
          ? "网卡已启用，通常需要几秒钟才能重新连接。"
          : "网卡已禁用；再次启用后才能继续配置它。",
      });
    } catch (caught) {
      setBanner({
        level: "error",
        title: adapter.enabled ? "禁用网卡失败" : "启用网卡失败",
        error: toAppError(caught),
      });
    } finally {
      setWorking(false);
    }
  };

  const takeBackup = async () => {
    if (!adapterId) {
      message.warning("请先选择目标网卡");
      return;
    }
    setWorking(true);
    try {
      const captured = await adaptersApi.captureBackup(adapterId);
      setBackup({ backup: captured, capturedAtMs: Date.now() });
      message.success(`已备份「${captured.adapterName}」的当前配置`);
    } catch (caught) {
      setBanner({ level: "error", title: "备份网卡配置失败", error: toAppError(caught) });
    } finally {
      setWorking(false);
    }
  };

  const restoreFromBackup = async () => {
    const current = backup;
    if (!current) return;
    setWorking(true);
    try {
      const action = `恢复备份（${current.backup.adapterName}）`;
      const result = await adaptersApi.restoreBackup(current.backup);
      const summary = describeApplyResult(result, action);
      setLastResult({ result, action });
      setBanner({ level: summary.level, title: summary.title, message: summary.message });
      loadedIdRef.current = null;
      await refreshAdapters({ silent: true });
    } catch (caught) {
      setBanner({ level: "error", title: "恢复备份失败", error: toAppError(caught) });
    } finally {
      setWorking(false);
    }
  };

  if (!adapter) {
    return (
      <div>
        <div className="page-head">
          <div>
            <h1 className="page-head__title">高级选项</h1>
            <p className="page-head__desc">单网卡多 IP、自动网关、子网类掩码与网卡备份恢复。</p>
          </div>
        </div>
        <SectionCard title="目标网卡">
          <div className="empty-state">
            <div className="empty-state__title">没有可用的网卡</div>
            <p>请先在「网卡配置」中选择一块网卡，再回到本页进行高级配置。</p>
            <Button
              icon={<ReloadOutlined />}
              loading={working}
              onClick={() => void refreshAdapters()}
            >
              重新读取网卡列表
            </Button>
          </div>
        </SectionCard>
      </div>
    );
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-head__title">高级选项</h1>
          <p className="page-head__desc">
            单网卡多 IP、按子网生成网关、A/B/C 类默认掩码、网卡启用禁用与备份恢复。
          </p>
        </div>
        <div className="page-head__actions">
          <Button icon={<SyncOutlined />} disabled={busy} onClick={reloadFromAdapter}>
            读取当前网卡
          </Button>
          <Tooltip title="重新读取网卡列表">
            <Button
              icon={<ReloadOutlined />}
              aria-label="刷新网卡列表"
              loading={working}
              onClick={() => void refreshAdapters()}
            />
          </Tooltip>
        </div>
      </div>

      {banner ? (
        <StatusBanner
          level={banner.level}
          title={banner.title}
          message={banner.message}
          error={banner.error}
          onDismiss={() => setBanner(null)}
        />
      ) : null}

      <SectionCard
        title="目标网卡"
        hint="所有写入操作都作用于这块网卡"
        extra={
          <Space>
            <AdapterStatusTag adapter={adapter} />
            <Tag color={adapter.enabled ? "blue" : "orange"}>
              {adapter.enabled ? "已启用" : "已禁用"}
            </Tag>
          </Space>
        }
      >
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <Select
            value={adapter.id}
            aria-label="目标网卡"
            style={{ minWidth: 340, maxWidth: 520 }}
            onChange={(value: string) => selectAdapter(value)}
            options={adapters.map((item) => ({
              value: item.id,
              label: `${item.name}${item.isVirtual ? "（虚拟网卡）" : ""}${item.isWireless ? "（无线）" : ""} — ${item.description || item.mac}`,
            }))}
          />
          <span className="cell-mono">{adapter.mac}</span>
          <span className="kv__label">
            {adapter.dhcpEnabled ? "当前自动获取（DHCP）" : "当前手动设置"}
          </span>
        </div>
      </SectionCard>

      <SectionCard
        title="单网卡多 IP"
        hint="最多 6 个地址；写入前会生成变更预览并读回校验"
        extra={
          <Space>
            <Button
              size="small"
              icon={<PlusOutlined />}
              disabled={busy || rows.length >= 6 || dhcp}
              onClick={() => setRows((prev) => [...prev, { address: "", mask: "255.255.255.0" }])}
            >
              添加地址
            </Button>
            <Button
              size="small"
              icon={<AimOutlined />}
              disabled={busy || dhcp}
              onClick={() => void generateGateway()}
            >
              按子网生成网关
            </Button>
            <Tooltip title={CLASS_MASK_HINT}>
              <Button
                size="small"
                icon={<SwapOutlined />}
                aria-label="全部按 A/B/C 类地址套用默认掩码"
                disabled={busy || dhcp}
                onClick={() => void applyClassMask()}
              >
                类掩码
              </Button>
            </Tooltip>
          </Space>
        }
      >
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Space size={6}>
              <Switch
                aria-label="获取方式（自动获取 / 手动设置）"
                checked={dhcp}
                checkedChildren="自动"
                unCheckedChildren="手动"
                disabled={busy}
                onChange={(checked) => setDhcp(checked)}
              />
              <span className="kv__label">自动获取 IP 地址（DHCP）</span>
            </Space>
            {dhcp ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                自动获取时下面的地址与网关不会被写入，DNS 与跃点数仍然生效。
              </Typography.Text>
            ) : null}
          </div>

          <Space direction="vertical" size={8} style={{ width: "100%" }}>
            {rows.map((row, index) => (
              <div key={index} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <Input
                  value={row.address}
                  aria-label={`第 ${index + 1} 个 IP 地址`}
                  className="mono"
                  disabled={busy || dhcp}
                  placeholder="192.168.1.10"
                  onChange={(event) => updateRow(index, { address: event.target.value })}
                />
                <Input
                  value={row.mask}
                  aria-label={`第 ${index + 1} 个 IP 的子网掩码`}
                  className="mono"
                  style={{ width: 190 }}
                  disabled={busy || dhcp}
                  placeholder="255.255.255.0"
                  onChange={(event) => updateRow(index, { mask: event.target.value })}
                />
                <Tooltip title="按该地址的 A/B/C 类填写默认掩码">
                  <Button
                    size="small"
                    aria-label={`为第 ${index + 1} 个地址填默认掩码`}
                    disabled={busy || dhcp}
                    onClick={() => void applyClassMask(index)}
                  >
                    类掩码
                  </Button>
                </Tooltip>
                <Tooltip title="删除该地址">
                  <Button
                    type="text"
                    danger
                    aria-label={`删除第 ${index + 1} 个地址`}
                    icon={<DeleteOutlined />}
                    disabled={busy || dhcp || rows.length <= 1}
                    onClick={() => setRows((prev) => prev.filter((_row, position) => position !== index))}
                  />
                </Tooltip>
              </div>
            ))}
          </Space>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <div className="kv">
              <span className="kv__label">默认网关</span>
              <Input
                value={gateway}
                aria-label="默认网关"
                className="mono"
                disabled={busy || dhcp}
                placeholder="192.168.1.1"
                onChange={(event) => setGateway(event.target.value)}
              />
            </div>
            <div className="kv">
              <span className="kv__label">网关跃点数</span>
              <Input
                value={gatewayMetric}
                aria-label="网关跃点数"
                className="mono"
                inputMode="numeric"
                disabled={busy || dhcp}
                placeholder="留空为自动"
                onChange={(event) => setGatewayMetric(event.target.value)}
              />
            </div>
            <div className="kv">
              <span className="kv__label">接口跃点数</span>
              <Input
                value={metric}
                aria-label="接口跃点数"
                className="mono"
                inputMode="numeric"
                disabled={busy}
                placeholder="留空为自动"
                onChange={(event) => setMetric(event.target.value)}
              />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 12 }}>
            <div className="kv">
              <span className="kv__label">DNS 模式</span>
              <Select
                value={dnsMode}
                aria-label="DNS 模式"
                style={{ width: "100%" }}
                disabled={busy}
                onChange={(value: DnsMode) => setDnsMode(value)}
                options={[
                  { value: "dhcp", label: "自动获取" },
                  { value: "static", label: "手动设置" },
                ]}
              />
            </div>
            <div className="kv">
              <span className="kv__label">DNS 服务器（回车分隔）</span>
              <Select
                mode="tags"
                value={dns}
                aria-label="DNS 服务器"
                className="mono"
                disabled={busy || dnsMode === "dhcp"}
                placeholder={dnsMode === "dhcp" ? "自动获取，无需填写" : "223.5.5.5"}
                tokenSeparators={[",", ";", " ", "，"]}
                onChange={(value: string[]) => setDns(value)}
                style={{ width: "100%" }}
              />
            </div>
          </div>

          {formError ? <Alert type="error" showIcon message={formError} /> : null}

          <Space wrap>
            <Button
              icon={<CheckCircleOutlined />}
              disabled={busy}
              onClick={() => void runValidation()}
            >
              校验配置
            </Button>
            <Button
              type="primary"
              icon={<ThunderboltOutlined />}
              disabled={busy}
              onClick={() => void startApply()}
            >
              应用配置
            </Button>
            <span className="kv__label">校验只读取，不会写入系统配置</span>
          </Space>

          {validation ? (
            <Alert
              type={validation.errors.length > 0 ? "error" : "success"}
              showIcon
              message={
                validation.errors.length > 0
                  ? `校验未通过（${validation.errors.length} 项错误）`
                  : "校验通过，可以应用"
              }
              description={
                <Space direction="vertical" size={8} style={{ width: "100%" }}>
                  {validation.errors.length > 0 ? (
                    <ul className="plan-list">
                      {validation.errors.map((item) => (
                        <li className="plan-row" key={item}>
                          <span className="plan-row__label">错误</span>
                          <span className="plan-row__change">{item}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {validation.warnings.length > 0 ? (
                    <ul className="plan-list">
                      {validation.warnings.map((item) => (
                        <li className="plan-row" key={item}>
                          <span className="plan-row__label">警告</span>
                          <span className="plan-row__change">{item}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {validation.changes.length > 0 ? (
                    <ul className="plan-list">
                      {validation.changes.map((change) => (
                        <li className="plan-row" key={change.field}>
                          <span className="plan-row__label">{change.label}</span>
                          <span className="plan-row__change">
                            <span className="plan-row__from">{change.from || "无"}</span>
                            <span aria-hidden="true">→</span>
                            <span className="plan-row__to">{change.to || "无"}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <Typography.Text type="secondary">
                      与网卡现状一致，没有需要写入的变更。
                    </Typography.Text>
                  )}
                </Space>
              }
            />
          ) : null}

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Input
              value={schemeName}
              aria-label="方案名称"
              style={{ maxWidth: 280 }}
              disabled={busy}
              placeholder="方案名称，例如：实验室双 IP"
              onChange={(event) => setSchemeName(event.target.value)}
            />
            <Button icon={<SaveOutlined />} disabled={busy} onClick={() => void saveAsScheme()}>
              保存为方案
            </Button>
            <span className="kv__label">保存后可在「方案管理」中一键应用</span>
          </div>
        </Space>
      </SectionCard>

      <SectionCard title="危险操作" hint="以下操作会立即改变网卡状态">
        <div className="danger-note">
          <WarningOutlined style={{ marginTop: 3 }} />
          <span>
            禁用网卡或写入配置会立即中断当前网络连接，可能导致远程桌面断开。请确认在本地操作，
            并优先使用备份功能保留当前配置。
          </span>
        </div>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 12 }}>
          <Popconfirm
            title={adapter.enabled ? "禁用该网卡？" : "启用该网卡？"}
            description={
              adapter.enabled
                ? "禁用后该网卡立即断开，需要重新启用才能恢复连接。"
                : "启用后该网卡会按现有配置恢复连接。"
            }
            okText={adapter.enabled ? "确认禁用" : "确认启用"}
            cancelText="取消"
            okButtonProps={{ danger: adapter.enabled }}
            disabled={busy}
            onConfirm={() => void toggleAdapter()}
          >
            <Button icon={<PoweroffOutlined />} danger={adapter.enabled} disabled={busy}>
              {adapter.enabled ? "禁用该网卡" : "启用该网卡"}
            </Button>
          </Popconfirm>

          <Popconfirm
            title="恢复为自动获取（DHCP）？"
            description="将清空静态地址、网关与 DNS，改为自动获取；操作前会显示变更预览。"
            okText="继续"
            cancelText="取消"
            disabled={busy}
            onConfirm={() => void startDhcpReset()}
          >
            <Button icon={<UndoOutlined />} disabled={busy}>
              恢复为自动获取
            </Button>
          </Popconfirm>

          <Button
            icon={<DatabaseOutlined />}
            disabled={busy}
            onClick={() => void takeBackup()}
          >
            备份当前配置
          </Button>

          <Popconfirm
            title="恢复该备份？"
            description="会把网卡配置写回备份时的状态，并立即生效。"
            okText="确认恢复"
            cancelText="取消"
            disabled={busy || !backup}
            onConfirm={() => void restoreFromBackup()}
          >
            <Button icon={<DownloadOutlined />} disabled={busy || !backup}>
              恢复该备份
            </Button>
          </Popconfirm>
        </div>

        <div style={{ marginTop: 12 }} className="kv-grid">
          <div className="kv">
            <span className="kv__label">备份状态</span>
            <span className="kv__value">
              {backup
                ? `已备份「${backup.backup.adapterName}」 · ${formatTimestamp(backup.capturedAtMs)}`
                : "尚未备份"}
            </span>
          </div>
          <div className="kv">
            <span className="kv__label">备份内容</span>
            <span className="kv__value cell-mono">
              {backup
                ? `${backup.backup.dhcp ? "DHCP" : backup.backup.addresses.map((spec) => `${spec.address}/${spec.prefix}`).join("，") || "无地址"} · DNS ${
                    backup.backup.dnsMode === "dhcp" ? "自动" : backup.backup.dns.join("，") || "无"
                  }`
                : "—"}
            </span>
          </div>
        </div>
      </SectionCard>

      {lastResult ? (
        <SectionCard
          title="最近一次写入结果"
          extra={
            <Button size="small" onClick={() => setLastResult(null)}>
              清除
            </Button>
          }
        >
          <ApplyResultPanel result={lastResult.result} action={lastResult.action} />
        </SectionCard>
      ) : null}

      <SectionCard title="网卡诊断（只读）" hint="来自系统的原始字段，写入失败时可据此排查">
        <div className="kv-grid">
          <div className="kv">
            <span className="kv__label">网卡 ID</span>
            <span className="kv__value kv__value--mono">{adapter.id}</span>
          </div>
          <div className="kv">
            <span className="kv__label">deviceInstanceId</span>
            <span className="kv__value kv__value--mono">{adapter.deviceInstanceId ?? "—"}</span>
          </div>
          <div className="kv">
            <span className="kv__label">mediaType</span>
            <span className="kv__value kv__value--mono">{adapter.mediaType || "—"}</span>
          </div>
          <div className="kv">
            <span className="kv__label">metric</span>
            <span className="kv__value kv__value--mono">
              {adapter.metric === null ? "自动" : adapter.metric}
            </span>
          </div>
          <div className="kv">
            <span className="kv__label">mtu</span>
            <span className="kv__value kv__value--mono">{adapter.mtu}</span>
          </div>
          <div className="kv">
            <span className="kv__label">isVirtual</span>
            <span className="kv__value kv__value--mono">{adapter.isVirtual ? "true" : "false"}</span>
          </div>
          <div className="kv">
            <span className="kv__label">enabled</span>
            <span className="kv__value kv__value--mono">{adapter.enabled ? "true" : "false"}</span>
          </div>
          <div className="kv">
            <span className="kv__label">dns.source</span>
            <span className="kv__value kv__value--mono">
              {adapter.dns.source}
              {adapter.dns.servers.length > 0 ? `（${adapter.dns.servers.join("，")}）` : ""}
            </span>
          </div>
          <div className="kv">
            <span className="kv__label">interfaceIndex</span>
            <span className="kv__value kv__value--mono">{adapter.index}</span>
          </div>
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
      </SectionCard>

      <ConfirmApplyDialog
        open={planOpen}
        plan={plan}
        loadingPlan={planLoading}
        applying={applying}
        title={pending?.title ?? "确认写入"}
        confirmText="确认写入"
        onCancel={() => {
          if (applying) return;
          setPlanOpen(false);
          setPlan(null);
        }}
        onConfirm={() => void confirmApply()}
      />
    </div>
  );
}
