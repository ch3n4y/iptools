import { App as AntApp, Button, Empty, Skeleton, Space, Tag, Typography } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ConfirmApplyDialog from "../../components/ConfirmApplyDialog";
import SectionCard from "../../components/SectionCard";
import StatusBanner from "../../components/StatusBanner";
import { adapters as adaptersApi } from "../../lib/api";
import { AppError, errorSummary, toAppError } from "../../lib/errors";
import type {
  AdapterBackup,
  AdapterInfo,
  ApplyPlan,
  ApplyRequest,
  ApplyResult,
} from "../../lib/types";
import { useAppStore } from "../../state/store";
import AdapterDetailCard from "./AdapterDetailCard";
import AdapterList from "./AdapterList";
import ApplyResultPanel from "./ApplyResultPanel";
import BackupCard from "./BackupCard";
import ConfigFormCard from "./ConfigFormCard";
import MacCard from "./MacCard";
import TechDetailsCard from "./TechDetailsCard";
import {
  MAX_ADDRESS_ROWS,
  blankForm,
  blankRow,
  buildRequest,
  formFromAdapter,
  validateForm,
  type AddressRowState,
  type HomeForm,
} from "./homeForm";
import { isValidIpv4, maskFromPrefix, parseMaskText } from "./netmask";

/**
 * Explicit view state machine. Nothing is inferred ad hoc in the JSX: the phase
 * is computed from the store + write state and drives both the status tag and
 * which regions render.
 */
type Phase = "loading" | "empty" | "ready" | "busy" | "success" | "recoverable" | "failure";

const PHASE_LABEL: Record<Phase, string> = {
  loading: "加载中",
  empty: "未检测到可用网卡",
  ready: "就绪",
  busy: "写入中",
  success: "写入成功",
  recoverable: "失败（可恢复）",
  failure: "失败",
};

const PHASE_COLOR: Record<Phase, string> = {
  loading: "blue",
  empty: "default",
  ready: "green",
  busy: "processing",
  success: "green",
  recoverable: "orange",
  failure: "red",
};

interface PhaseInput {
  listLoading: boolean;
  adapterCount: number;
  listFailed: boolean;
  busy: boolean;
  result: ApplyResult | null;
  error: AppError | null;
  hasBackup: boolean;
}

function resolvePhase(input: PhaseInput): Phase {
  if (input.listLoading) return "loading";
  if (input.adapterCount === 0) return input.listFailed ? "failure" : "empty";
  if (input.busy) return "busy";
  if (input.error) return "failure";
  if (input.result) {
    if (input.result.success && input.result.verified) return "success";
    if (!input.result.success) {
      return input.result.rollbackPerformed || input.hasBackup ? "recoverable" : "failure";
    }
    // Written, but the read-back check reported differences: still "recoverable"
    // because a backup exists and the user can re-read or restore.
    return "recoverable";
  }
  return "ready";
}

export default function HomeView() {
  const { message, modal } = AntApp.useApp();

  const adapters = useAppStore((state) => state.adapters);
  const adaptersState = useAppStore((state) => state.adaptersState);
  const adaptersError = useAppStore((state) => state.adaptersError);
  const lastRefreshedAt = useAppStore((state) => state.lastRefreshedAt);
  const selectedAdapterId = useAppStore((state) => state.selectedAdapterId);
  const selectAdapter = useAppStore((state) => state.selectAdapter);
  const refreshAdapters = useAppStore((state) => state.refreshAdapters);
  const refreshAdapter = useAppStore((state) => state.refreshAdapter);

  const [form, setForm] = useState<HomeForm>(blankForm);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [planOpen, setPlanOpen] = useState(false);
  const [plan, setPlan] = useState<ApplyPlan | null>(null);
  const [planning, setPlanning] = useState(false);
  const [pendingRequest, setPendingRequest] = useState<ApplyRequest | null>(null);
  const [applying, setApplying] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [applyError, setApplyError] = useState<AppError | null>(null);
  const [backup, setBackup] = useState<AdapterBackup | null>(null);
  const [backupAt, setBackupAt] = useState<number | null>(null);
  const [backupError, setBackupError] = useState<AppError | null>(null);
  const lastFilledRef = useRef<string | null>(null);

  const selectedAdapter = useMemo(
    () => adapters.find((adapter) => adapter.id === selectedAdapterId) ?? null,
    [adapters, selectedAdapterId],
  );

  const busy = applying || planning || toggling || restoring;

  const fillFrom = useCallback((adapter: AdapterInfo | null) => {
    lastFilledRef.current = adapter?.id ?? null;
    setForm(adapter ? formFromAdapter(adapter) : blankForm());
    setTouched({});
  }, []);

  // Fill the form when the selection changes (never on silent polling refreshes,
  // which would discard what the user is typing).
  useEffect(() => {
    const id = selectedAdapter?.id ?? null;
    if (lastFilledRef.current === id) return;
    fillFrom(selectedAdapter);
    setResult(null);
    setApplyError(null);
    setBackup(null);
    setBackupAt(null);
    setBackupError(null);
  }, [selectedAdapter, fillFrom]);

  const formErrors = useMemo(() => validateForm(form), [form]);
  const displayedErrors = useMemo(() => {
    const shown: Record<string, string> = {};
    for (const [key, text] of Object.entries(formErrors)) {
      if (touched[key]) shown[key] = text;
    }
    return shown;
  }, [formErrors, touched]);

  const phase = resolvePhase({
    listLoading: adaptersState === "loading" && adapters.length === 0,
    adapterCount: adapters.length,
    listFailed: adaptersState === "error",
    busy,
    result,
    error: applyError,
    hasBackup: backup !== null,
  });

  const handleRefreshList = useCallback(() => {
    void refreshAdapters();
  }, [refreshAdapters]);

  const patchForm = useCallback((patch: Partial<HomeForm>) => {
    setForm((prev) => ({ ...prev, ...patch }));
  }, []);

  const patchAddress = useCallback((key: string, patch: Partial<AddressRowState>) => {
    setForm((prev) => ({
      ...prev,
      addresses: prev.addresses.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    }));
  }, []);

  const addAddress = useCallback(() => {
    setForm((prev) =>
      prev.addresses.length >= MAX_ADDRESS_ROWS
        ? prev
        : { ...prev, addresses: [...prev.addresses, blankRow()] },
    );
  }, []);

  const removeAddress = useCallback((key: string) => {
    setForm((prev) =>
      prev.addresses.length <= 1
        ? prev
        : { ...prev, addresses: prev.addresses.filter((row) => row.key !== key) },
    );
  }, []);

  const handleFieldBlur = useCallback((field: string) => {
    setTouched((prev) => (prev[field] ? prev : { ...prev, [field]: true }));
  }, []);

  const handleDefaultMask = useCallback(
    async (key: string) => {
      const row = form.addresses.find((item) => item.key === key);
      if (!row) return;
      const address = row.address.trim();
      if (!isValidIpv4(address)) {
        message.warning("请先填写有效的 IP 地址，再按地址类推导默认掩码");
        return;
      }
      try {
        const mask = await adaptersApi.defaultMaskFor(address);
        patchAddress(key, { mask });
        message.success(`已按地址类填写默认掩码 ${mask}`);
      } catch (error) {
        message.error(errorSummary(toAppError(error)));
      }
    },
    [form.addresses, message, patchAddress],
  );

  const handleDeriveGateway = useCallback(async () => {
    const first = form.addresses[0];
    const address = first?.address.trim() ?? "";
    const prefix = first ? parseMaskText(first.mask) : null;
    if (!isValidIpv4(address) || prefix === null) {
      message.warning("请先在第一行填写有效的 IP 地址与子网掩码，再推导网关");
      return;
    }
    try {
      const gateway = await adaptersApi.deriveGateway(address, maskFromPrefix(prefix));
      if (!gateway) {
        message.warning("无法根据当前地址与掩码推导网关，请手动填写");
        return;
      }
      patchForm({ gateway });
      message.success(`已按子网推导网关 ${gateway}`);
    } catch (error) {
      message.error(errorSummary(toAppError(error)));
    }
  }, [form.addresses, message, patchForm]);

  const handleReadCurrent = useCallback(async () => {
    if (!selectedAdapter) return;
    try {
      const fresh = await refreshAdapter(selectedAdapter.id);
      fillFrom(fresh ?? selectedAdapter);
      if (fresh) {
        message.success("已读取网卡当前配置");
      } else {
        message.warning("读取网卡失败，已按最近一次的数据回填表单");
      }
    } catch (error) {
      const appError = toAppError(error);
      setApplyError(appError);
      message.error(errorSummary(appError));
    }
  }, [fillFrom, message, refreshAdapter, selectedAdapter]);

  /** Step 1 of a write: validate locally, then ask the backend for a plan. */
  const handleApply = useCallback(async () => {
    if (!selectedAdapter) return;

    const issues = validateForm(form);
    const issueKeys = Object.keys(issues);
    if (issueKeys.length > 0) {
      setTouched((prev) => {
        const next = { ...prev };
        for (const key of issueKeys) next[key] = true;
        return next;
      });
      setResult(null);
      setApplyError(
        new AppError({
          code: "INVALID_INPUT",
          message: `表单中存在 ${issueKeys.length} 处需要修正的内容`,
          detail: Object.values(issues).join("\n"),
          hint: "修正后再次点击「应用配置」",
        }),
      );
      message.error("请先修正表单中的错误");
      return;
    }

    const request = buildRequest(selectedAdapter.id, form);
    setPendingRequest(request);
    setPlan(null);
    setPlanOpen(true);
    setPlanning(true);
    setApplyError(null);
    setResult(null);
    try {
      const nextPlan = await adaptersApi.planApply(request);
      setPlan(nextPlan);
    } catch (error) {
      const appError = toAppError(error);
      setApplyError(appError);
      setPlanOpen(false);
      setPendingRequest(null);
      message.error(errorSummary(appError));
    } finally {
      setPlanning(false);
    }
  }, [form, message, selectedAdapter]);

  /** Step 2: the user confirmed the plan — back up, then write. */
  const confirmApply = useCallback(async () => {
    if (!pendingRequest) return;
    setApplying(true);
    try {
      try {
        const snapshot = await adaptersApi.captureBackup(pendingRequest.adapterId);
        setBackup(snapshot);
        setBackupAt(Date.now());
        setBackupError(null);
      } catch (error) {
        setBackupError(toAppError(error));
      }

      const applied = await adaptersApi.applyConfig(pendingRequest);
      setResult(applied);
      setApplyError(null);
      if (applied.backup) {
        setBackup(applied.backup);
        setBackupAt(Date.now());
        setBackupError(null);
      }
      if (applied.adapter) fillFrom(applied.adapter);

      if (applied.success && applied.verified) {
        message.success("配置已生效并通过读回校验");
      } else if (applied.success) {
        message.warning("配置已写入，但读回校验存在差异");
      } else {
        message.error(applied.message || "配置写入失败");
      }
    } catch (error) {
      const appError = toAppError(error);
      setApplyError(appError);
      setResult(null);
      message.error(errorSummary(appError));
    } finally {
      setApplying(false);
      setPlanOpen(false);
      setPlan(null);
      setPendingRequest(null);
      void refreshAdapters({ silent: true });
    }
  }, [fillFrom, message, pendingRequest, refreshAdapters]);

  const handlePlanCancel = useCallback(() => {
    if (applying) return;
    setPlanOpen(false);
    setPlan(null);
    setPendingRequest(null);
  }, [applying]);

  const handleToggleEnabled = useCallback(() => {
    if (!selectedAdapter) return;
    const target = !selectedAdapter.enabled;
    const adapterId = selectedAdapter.id;
    const name = selectedAdapter.name;
    modal.confirm({
      title: target ? `确认启用网卡「${name}」？` : `确认禁用网卡「${name}」？`,
      content: target
        ? "启用后系统会重新检测该网卡，网络可能需要几秒钟才能恢复。"
        : "禁用会立即中断该网卡上的所有网络连接，正在使用它的远程连接（例如远程桌面）会断开。",
      okText: target ? "确认启用" : "确认禁用",
      cancelText: "取消",
      okButtonProps: { danger: !target },
      centered: true,
      onOk: async () => {
        setToggling(true);
        try {
          const updated = await adaptersApi.setAdapterEnabled(adapterId, target);
          fillFrom(updated);
          message.success(target ? "网卡已启用" : "网卡已禁用");
        } catch (error) {
          const appError = toAppError(error);
          setApplyError(appError);
          message.error(errorSummary(appError));
        } finally {
          setToggling(false);
          void refreshAdapters({ silent: true });
        }
      },
    });
  }, [fillFrom, message, modal, refreshAdapters, selectedAdapter]);

  const handleRestore = useCallback(() => {
    if (!backup) return;
    const snapshot = backup;
    modal.confirm({
      title: "确认按备份恢复网卡配置？",
      content: `将把「${snapshot.adapterName}」的 IP 地址、网关与 DNS 恢复为备份时的状态，可能导致当前连接短暂中断。`,
      okText: "确认恢复",
      cancelText: "取消",
      okButtonProps: { danger: true },
      centered: true,
      onOk: async () => {
        setRestoring(true);
        try {
          const restored = await adaptersApi.restoreBackup(snapshot);
          setResult(restored);
          setApplyError(null);
          if (restored.adapter) fillFrom(restored.adapter);
          if (restored.success && restored.verified) {
            message.success("已按备份恢复配置并通过读回校验");
          } else {
            message.warning(restored.message || "恢复已提交，但读回校验存在差异");
          }
        } catch (error) {
          const appError = toAppError(error);
          setApplyError(appError);
          setResult(null);
          message.error(errorSummary(appError));
        } finally {
          setRestoring(false);
          void refreshAdapters({ silent: true });
        }
      },
    });
  }, [backup, fillFrom, message, modal, refreshAdapters]);

  const handleRefreshState = useCallback(async () => {
    if (selectedAdapter) {
      const fresh = await refreshAdapter(selectedAdapter.id);
      if (fresh) fillFrom(fresh);
    }
    await refreshAdapters();
    message.success("已重新读取网卡状态");
  }, [fillFrom, message, refreshAdapter, refreshAdapters, selectedAdapter]);

  const header = (
    <header className="page-head">
      <div>
        <h1 className="page-head__title">网卡配置</h1>
        <p className="page-head__desc">
          查看并修改当前网卡的 IP 地址、子网掩码、默认网关与 DNS
        </p>
      </div>
      <div className="page-head__actions">
        <Tag color={PHASE_COLOR[phase]} role="status">
          状态：{PHASE_LABEL[phase]}
        </Tag>
      </div>
    </header>
  );

  if (phase === "loading") {
    return (
      <div>
        {header}
        <SectionCard title="网卡列表" hint="正在读取系统网卡…">
          <Skeleton active paragraph={{ rows: 6 }} />
        </SectionCard>
      </div>
    );
  }

  if (adapters.length === 0) {
    return (
      <div>
        {header}
        {adaptersError ? (
          <StatusBanner
            level="error"
            title="无法读取网卡列表"
            message="请确认程序具有读取网络配置的权限，或稍后重试。"
            error={adaptersError}
            actions={[{ label: "重试", onClick: handleRefreshList, primary: true }]}
          />
        ) : null}
        <SectionCard title="网卡列表">
          <Empty description="未检测到可用网卡">
            <Space direction="vertical" size={8}>
              <Typography.Text type="secondary">
                可能原因：所有网卡都被禁用、驱动尚未安装，或当前系统没有可见的网络适配器。
              </Typography.Text>
              <Button icon={<ReloadOutlined />} disabled={busy} onClick={handleRefreshList}>
                重新检测
              </Button>
            </Space>
          </Empty>
        </SectionCard>
      </div>
    );
  }

  return (
    <div>
      {header}

      {adaptersError ? (
        <StatusBanner
          level="warning"
          title="最近一次刷新网卡列表失败"
          message="当前显示的是上一次成功读取的数据。"
          error={adaptersError}
          actions={[{ label: "重试", onClick: handleRefreshList }]}
        />
      ) : null}

      <ApplyResultPanel
        result={result}
        error={applyError}
        onRetry={handleApply}
        onRefresh={handleRefreshState}
      />

      <AdapterList
        adapters={adapters}
        selectedAdapterId={selectedAdapterId}
        loading={adaptersState === "loading"}
        disabled={busy}
        lastRefreshedAt={lastRefreshedAt}
        onSelect={selectAdapter}
        onRefresh={handleRefreshList}
      />

      {selectedAdapter ? (
        <AdapterDetailCard adapter={selectedAdapter} disabled={busy} />
      ) : (
        <SectionCard title="选中网卡详情">
          <Empty description="尚未选择网卡">
            <Button disabled={busy} onClick={() => selectAdapter(adapters[0].id)}>
              选择第一张网卡
            </Button>
          </Empty>
        </SectionCard>
      )}
      {selectedAdapter ? (
        <ConfigFormCard
          adapter={selectedAdapter}
          form={form}
          errors={displayedErrors}
          disabled={busy}
          onPatch={patchForm}
          onAddressPatch={patchAddress}
          onAddressAdd={addAddress}
          onAddressRemove={removeAddress}
          onFieldBlur={handleFieldBlur}
          onDefaultMask={(key) => {
            void handleDefaultMask(key);
          }}
          onDeriveGateway={() => {
            void handleDeriveGateway();
          }}
          onReadCurrent={() => {
            void handleReadCurrent();
          }}
          onApply={() => {
            void handleApply();
          }}
          onToggleEnabled={handleToggleEnabled}
        />
      ) : null}

      {/* MAC 属于低频、影响较大的操作，放在主要配置之后 */}
      {selectedAdapter ? <MacCard adapter={selectedAdapter} disabled={busy} /> : null}

      <BackupCard
        backup={backup}
        backupAt={backupAt}
        backupError={backupError}
        disabled={busy}
        onRestore={handleRestore}
      />

      {selectedAdapter ? <TechDetailsCard adapter={selectedAdapter} /> : null}

      <ConfirmApplyDialog
        open={planOpen}
        plan={plan}
        loadingPlan={planning}
        applying={applying}
        onCancel={handlePlanCancel}
        onConfirm={() => {
          void confirmApply();
        }}
      />
    </div>
  );
}
