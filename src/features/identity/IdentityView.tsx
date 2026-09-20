import { useEffect, useState } from "react";
import { Button, Input, Modal, Select, Space, Spin, Tag, Typography } from "antd";
import AdapterStatusTag from "../../components/AdapterStatusTag";
import SectionCard from "../../components/SectionCard";
import StatusBanner from "../../components/StatusBanner";
import { adapters as adaptersApi, system as systemApi } from "../../lib/api";
import { toAppError, type AppError } from "../../lib/errors";
import { currentAdapter, useAppStore } from "../../state/store";
import {
  normalizeMacAddress,
  validateComputerName,
  validateMacAddress,
  validateWorkgroupName,
} from "./validation";

type FeedbackLevel = "success" | "info" | "warning" | "error";

interface Feedback {
  level: FeedbackLevel;
  title: string;
  message?: string | null;
  error?: AppError | null;
}

const PREVIEW_HINT = "浏览器预览只提供只读数据，请在桌面程序中执行该操作。";

export default function IdentityView() {
  const identity = useAppStore((state) => state.identity);
  const identityError = useAppStore((state) => state.identityError);
  const refreshIdentity = useAppStore((state) => state.refreshIdentity);
  const adapters = useAppStore((state) => state.adapters);
  const selectedAdapterId = useAppStore((state) => state.selectedAdapterId);
  const selectAdapter = useAppStore((state) => state.selectAdapter);
  const refreshAdapter = useAppStore((state) => state.refreshAdapter);
  const refreshAdapters = useAppStore((state) => state.refreshAdapters);
  const adapter = useAppStore(currentAdapter);
  const elevated = useAppStore((state) => state.status?.isElevated ?? null);

  const [nameInput, setNameInput] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameConfirmOpen, setNameConfirmOpen] = useState(false);
  const [nameBusy, setNameBusy] = useState(false);

  const [groupInput, setGroupInput] = useState("");
  const [groupError, setGroupError] = useState<string | null>(null);
  const [groupConfirmOpen, setGroupConfirmOpen] = useState(false);
  const [groupBusy, setGroupBusy] = useState(false);

  const [macInput, setMacInput] = useState("");
  const [macError, setMacError] = useState<string | null>(null);
  const [macWarning, setMacWarning] = useState<string | null>(null);
  const [macBusy, setMacBusy] = useState(false);
  const [macConfirm, setMacConfirm] = useState<"apply" | "clear" | null>(null);
  const [randomBusy, setRandomBusy] = useState(false);

  const [identityFeedback, setIdentityFeedback] = useState<Feedback | null>(null);
  const [macFeedback, setMacFeedback] = useState<Feedback | null>(null);

  // Prefill once per loaded identity; afterwards the user's typing wins.
  useEffect(() => {
    if (!identity) return;
    const preferredName = identity.pendingComputerName ?? identity.computerName;
    setNameInput((current) => (current.trim().length > 0 ? current : preferredName));
    const group = identity.partOfDomain ? identity.domain ?? "" : identity.workgroup ?? "";
    setGroupInput((current) => (current.trim().length > 0 ? current : group));
  }, [identity]);

  useEffect(() => {
    setMacInput("");
    setMacError(null);
    setMacWarning(null);
    setMacFeedback(null);
    setMacConfirm(null);
  }, [adapter?.id]);

  const reloadIdentity = async () => {
    setIdentityFeedback(null);
    await refreshIdentity();
  };

  const reloadAdapter = async () => {
    setMacFeedback(null);
    if (!adapter) return;
    await refreshAdapter(adapter.id);
    void refreshAdapters({ silent: true });
  };

  const openNameConfirm = () => {
    const problem = validateComputerName(nameInput);
    setNameError(problem);
    if (problem) {
      setIdentityFeedback({ level: "error", title: "计算机名不合法", message: problem });
      return;
    }
    setNameConfirmOpen(true);
  };

  const applyComputerName = async () => {
    const problem = validateComputerName(nameInput);
    if (problem) {
      setNameError(problem);
      setNameConfirmOpen(false);
      return;
    }
    setNameBusy(true);
    setIdentityFeedback(null);
    try {
      await systemApi.setComputerName(nameInput.trim());
      await refreshIdentity();
      setIdentityFeedback({
        level: "success",
        title: "计算机名修改已提交",
        message: "新的计算机名与 NetBIOS 名已写入，重启系统后生效。",
      });
    } catch (caught) {
      const appError = toAppError(caught);
      setIdentityFeedback({
        level: "error",
        title: appError.code === "NOT_SUPPORTED" ? "当前环境不支持修改计算机名" : "修改计算机名失败",
        message: appError.code === "NOT_SUPPORTED" ? PREVIEW_HINT : null,
        error: appError,
      });
    } finally {
      setNameBusy(false);
      setNameConfirmOpen(false);
    }
  };

  const openGroupConfirm = () => {
    const problem = validateWorkgroupName(groupInput);
    setGroupError(problem);
    if (problem) {
      setIdentityFeedback({ level: "error", title: "工作组名称不合法", message: problem });
      return;
    }
    setGroupConfirmOpen(true);
  };

  const applyWorkgroup = async () => {
    const problem = validateWorkgroupName(groupInput);
    if (problem) {
      setGroupError(problem);
      setGroupConfirmOpen(false);
      return;
    }
    setGroupBusy(true);
    setIdentityFeedback(null);
    try {
      await systemApi.setWorkgroup(groupInput.trim());
      await refreshIdentity();
      setIdentityFeedback({
        level: "success",
        title: "工作组修改已提交",
        message: "系统已加入新的工作组，重启后生效。",
      });
    } catch (caught) {
      const appError = toAppError(caught);
      setIdentityFeedback({
        level: "error",
        title: appError.code === "NOT_SUPPORTED" ? "当前环境不支持修改工作组" : "修改工作组失败",
        message: appError.code === "NOT_SUPPORTED" ? PREVIEW_HINT : null,
        error: appError,
      });
    } finally {
      setGroupBusy(false);
      setGroupConfirmOpen(false);
    }
  };

  const fillRandomMac = async () => {
    setRandomBusy(true);
    setMacError(null);
    setMacFeedback(null);
    try {
      const generated = await adaptersApi.randomMacAddress();
      setMacInput(normalizeMacAddress(generated));
      setMacWarning(validateMacAddress(generated).warning);
    } catch (caught) {
      const appError = toAppError(caught);
      setMacFeedback({
        level: "error",
        title: "生成随机 MAC 失败",
        message: appError.code === "NOT_SUPPORTED" ? PREVIEW_HINT : null,
        error: appError,
      });
    } finally {
      setRandomBusy(false);
    }
  };

  const openMacConfirm = () => {
    const check = validateMacAddress(macInput);
    setMacError(check.error);
    setMacWarning(check.warning);
    if (check.error) {
      setMacFeedback({ level: "error", title: "MAC 地址不合法", message: check.error });
      return;
    }
    setMacConfirm("apply");
  };

  const applyMac = async () => {
    if (!adapter) return;
    const check = validateMacAddress(macInput);
    if (check.error) {
      setMacError(check.error);
      setMacConfirm(null);
      return;
    }
    setMacBusy(true);
    setMacFeedback(null);
    try {
      const updated = await adaptersApi.changeMac(adapter.id, check.normalized);
      const refreshed = await refreshAdapter(updated.id);
      const current = refreshed ?? updated;
      void refreshAdapters({ silent: true });
      setMacInput(normalizeMacAddress(current.mac));
      setMacFeedback({
        level: "success",
        title: "MAC 修改已提交",
        message: `网卡已重启以应用新地址，当前 MAC：${current.mac || "读取中"}`,
      });
    } catch (caught) {
      const appError = toAppError(caught);
      setMacFeedback({
        level: "error",
        title: appError.code === "NOT_SUPPORTED" ? "当前环境不支持修改 MAC 地址" : "修改 MAC 地址失败",
        message: appError.code === "NOT_SUPPORTED" ? PREVIEW_HINT : null,
        error: appError,
      });
    } finally {
      setMacBusy(false);
      setMacConfirm(null);
    }
  };

  const clearMacOverride = async () => {
    if (!adapter) return;
    setMacBusy(true);
    setMacFeedback(null);
    try {
      const updated = await adaptersApi.changeMac(adapter.id, null);
      const refreshed = await refreshAdapter(updated.id);
      const current = refreshed ?? updated;
      void refreshAdapters({ silent: true });
      setMacInput("");
      setMacError(null);
      setMacWarning(null);
      setMacFeedback({
        level: "success",
        title: "已清除 MAC 覆盖",
        message: `网卡已恢复使用硬件地址，当前 MAC：${current.mac || "读取中"}`,
      });
    } catch (caught) {
      const appError = toAppError(caught);
      setMacFeedback({
        level: "error",
        title: appError.code === "NOT_SUPPORTED" ? "当前环境不支持修改 MAC 地址" : "清除 MAC 覆盖失败",
        message: appError.code === "NOT_SUPPORTED" ? PREVIEW_HINT : null,
        error: appError,
      });
    } finally {
      setMacBusy(false);
      setMacConfirm(null);
    }
  };

  const pendingName =
    identity?.pendingComputerName && identity.pendingComputerName !== identity.computerName
      ? identity.pendingComputerName
      : null;
  const groupText = identity
    ? identity.partOfDomain
      ? identity.domain ?? "（域信息不可用）"
      : identity.workgroup ?? "（工作组信息不可用）"
    : "—";
  const prefilledName = nameInput.trim();
  const prefilledGroup = groupInput.trim();

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-head__title">主机设置</h1>
          <p className="page-head__desc">
            查看并修改计算机名 / 工作组，以及当前选中网卡的 MAC 地址。写操作需要管理员权限，计算机名与工作组重启后生效。
          </p>
        </div>
        <div className="page-head__actions">
          <Button
            onClick={() => {
              void reloadIdentity();
              void reloadAdapter();
            }}
            disabled={nameBusy || groupBusy || macBusy}
          >
            重新读取
          </Button>
        </div>
      </div>

      <SectionCard
        title="机器标识"
        hint="计算机名限制 1-15 个字符，仅字母、数字与连字符，且不能全部为数字"
        extra={
          identity?.rebootRequired ? (
            <Tag color="orange">需重启生效</Tag>
          ) : identity ? (
            <Tag color="green">已生效</Tag>
          ) : null
        }
      >
        {identityError ? (
          <StatusBanner
            level="error"
            title="读取机器标识失败"
            error={identityError}
            actions={[
              { label: "重试", onClick: () => void reloadIdentity(), primary: true },
            ]}
          />
        ) : null}

        {identityFeedback ? (
          <StatusBanner
            level={identityFeedback.level}
            title={identityFeedback.title}
            message={identityFeedback.message}
            error={identityFeedback.error}
            onDismiss={() => setIdentityFeedback(null)}
          />
        ) : null}

        {!identity && !identityError ? (
          <Space>
            <Spin size="small" />
            <Typography.Text type="secondary">正在读取计算机名与工作组…</Typography.Text>
          </Space>
        ) : null}

        {identity ? (
          <>
            <div className="kv-grid" style={{ marginBottom: 16 }}>
              <div className="kv">
                <span className="kv__label">当前计算机名</span>
                <span className="kv__value kv__value--mono">{identity.computerName || "—"}</span>
              </div>
              <div className="kv">
                <span className="kv__label">待生效计算机名</span>
                <span className="kv__value kv__value--mono">
                  {pendingName ?? "无（重启后仍为当前名称）"}
                </span>
              </div>
              <div className="kv">
                <span className="kv__label">{identity.partOfDomain ? "所属域" : "工作组"}</span>
                <span className="kv__value kv__value--mono">{groupText}</span>
              </div>
              <div className="kv">
                <span className="kv__label">重启状态</span>
                <span className="kv__value">
                  {identity.rebootRequired ? "已修改，需重启生效" : "当前无需重启"}
                </span>
              </div>
            </div>

            {identity.rebootRequired ? (
              <StatusBanner
                level="warning"
                title="需重启生效"
                message="计算机名 / 工作组的修改会在系统重启后才会完全生效；重启前网络邻居、共享与资源管理器仍可能显示旧名称。"
              />
            ) : null}

            <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
              <div>
                <Typography.Text strong>修改计算机名</Typography.Text>
                <Space direction="vertical" size={8} style={{ width: "100%", marginTop: 8 }}>
                  <Input
                    className="mono"
                    value={nameInput}
                    maxLength={15}
                    showCount
                    disabled={nameBusy}
                    placeholder="例如 DESKTOP-8H2K3L"
                    status={nameError ? "error" : undefined}
                    onChange={(event) => {
                      setNameInput(event.target.value);
                      setNameError(null);
                    }}
                    onPressEnter={openNameConfirm}
                  />
                  {nameError ? (
                    <Typography.Text type="danger" style={{ fontSize: 12 }}>
                      {nameError}
                    </Typography.Text>
                  ) : (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      作用对象为主机名（DNS 主机名）与 NetBIOS 名，重启后生效。
                    </Typography.Text>
                  )}
                  <Space>
                    <Button
                      type="primary"
                      disabled={nameBusy || !prefilledName}
                      onClick={openNameConfirm}
                    >
                      修改计算机名
                    </Button>
                    <Button
                      size="small"
                      type="link"
                      disabled={nameBusy}
                      onClick={() => {
                        setNameInput(identity.pendingComputerName ?? identity.computerName);
                        setNameError(null);
                      }}
                    >
                      填入当前名称
                    </Button>
                  </Space>
                </Space>
              </div>

              <div>
                <Typography.Text strong>修改工作组</Typography.Text>
                <Space direction="vertical" size={8} style={{ width: "100%", marginTop: 8 }}>
                  <Input
                    className="mono"
                    value={groupInput}
                    maxLength={15}
                    showCount
                    disabled={groupBusy}
                    placeholder="例如 WORKGROUP"
                    status={groupError ? "error" : undefined}
                    onChange={(event) => {
                      setGroupInput(event.target.value);
                      setGroupError(null);
                    }}
                    onPressEnter={openGroupConfirm}
                  />
                  {groupError ? (
                    <Typography.Text type="danger" style={{ fontSize: 12 }}>
                      {groupError}
                    </Typography.Text>
                  ) : (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      工作组名称 1-15 个字符，仅字母、数字与连字符；修改后需要重启系统才会生效。
                    </Typography.Text>
                  )}
                  {identity.partOfDomain ? (
                    <Typography.Text type="warning" style={{ fontSize: 12 }}>
                      当前计算机已加入域 {identity.domain ?? ""}，改为工作组会使其退出该域。
                    </Typography.Text>
                  ) : null}
                  <Space>
                    <Button
                      type="primary"
                      disabled={groupBusy || !prefilledGroup}
                      onClick={openGroupConfirm}
                    >
                      修改工作组
                    </Button>
                    <Button
                      size="small"
                      type="link"
                      disabled={groupBusy}
                      onClick={() => {
                        setGroupInput(identity.workgroup ?? "");
                        setGroupError(null);
                      }}
                    >
                      填入当前工作组
                    </Button>
                  </Space>
                </Space>
              </div>
            </div>
          </>
        ) : null}
      </SectionCard>

      <SectionCard
        title="MAC 地址"
        hint="写入注册表 NetworkAddress 覆盖值并重启网卡，使其立即生效"
        extra={adapter ? <AdapterStatusTag adapter={adapter} /> : null}
      >
        {adapters.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state__title">没有可用的网卡</div>
            请回到主界面点击「刷新网卡」，或检查系统网络连接是否正常。
          </div>
        ) : (
          <>
            <div style={{ maxWidth: 460, marginBottom: 16 }}>
              <Typography.Text className="kv__label">目标网卡</Typography.Text>
              <Select
                style={{ width: "100%", marginTop: 4 }}
                value={selectedAdapterId ?? undefined}
                disabled={macBusy}
                showSearch
                optionFilterProp="label"
                placeholder="选择要修改 MAC 的网卡"
                onChange={(value: string) => selectAdapter(value)}
                options={adapters.map((item) => ({
                  value: item.id,
                  label: `${item.name} · ${item.description}`,
                }))}
              />
            </div>

            {macFeedback ? (
              <StatusBanner
                level={macFeedback.level}
                title={macFeedback.title}
                message={macFeedback.message}
                error={macFeedback.error}
                onDismiss={() => setMacFeedback(null)}
              />
            ) : null}

            {!adapter ? (
              <div className="empty-state">
                <div className="empty-state__title">未选择网卡</div>
                请在上方下拉框中选择一块网卡后再修改 MAC 地址。
              </div>
            ) : (
              <>
                <div className="kv-grid" style={{ marginBottom: 16 }}>
                  <div className="kv">
                    <span className="kv__label">当前 MAC（生效中）</span>
                    <span className="kv__value kv__value--mono">{adapter.mac || "—"}</span>
                  </div>
                  <div className="kv">
                    <span className="kv__label">永久 MAC（硬件地址）</span>
                    <span className="kv__value kv__value--mono">
                      {adapter.permanentMac ?? "驱动未报告"}
                    </span>
                  </div>
                  <div className="kv">
                    <span className="kv__label">MAC 覆盖值</span>
                    <span className="kv__value kv__value--mono">
                      {adapter.macOverride ?? "未设置（使用硬件地址）"}
                    </span>
                  </div>
                  <div className="kv">
                    <span className="kv__label">设备实例 ID</span>
                    <span className="kv__value kv__value--mono">
                      {adapter.deviceInstanceId ?? "驱动未报告"}
                    </span>
                  </div>
                </div>

                <Space direction="vertical" size={10} style={{ width: "100%" }}>
                  <Space wrap>
                    <Input
                      className="mono"
                      style={{ width: 240 }}
                      value={macInput}
                      allowClear
                      disabled={macBusy}
                      placeholder="AA-BB-CC-DD-EE-FF"
                      status={macError ? "error" : undefined}
                      onChange={(event) => {
                        setMacInput(event.target.value);
                        setMacError(null);
                        setMacWarning(null);
                      }}
                      onPressEnter={openMacConfirm}
                    />
                    <Button disabled={macBusy || randomBusy} loading={randomBusy} onClick={() => void fillRandomMac()}>
                      随机生成
                    </Button>
                    <Button type="primary" disabled={macBusy || !macInput.trim()} onClick={openMacConfirm}>
                      应用新 MAC
                    </Button>
                    <Button
                      danger
                      disabled={macBusy || adapter.macOverride === null}
                      onClick={() => setMacConfirm("clear")}
                    >
                      清除覆盖（恢复硬件地址）
                    </Button>
                  </Space>

                  {macError ? (
                    <Typography.Text type="danger" style={{ fontSize: 12 }}>
                      {macError}
                    </Typography.Text>
                  ) : macWarning ? (
                    <Typography.Text type="warning" style={{ fontSize: 12 }}>
                      {macWarning}
                    </Typography.Text>
                  ) : (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      支持 AA-BB-CC-DD-EE-FF、AA:BB:CC:DD:EE:FF 或 12 位连续十六进制；第一字节必须是偶数（单播地址）。
                      {adapter.macOverride === null ? " 当前没有覆盖值，「清除覆盖」不可用。" : ""}
                    </Typography.Text>
                  )}

                  <div className="danger-note">
                    <span>
                      写入 MAC 会重启网卡，当前连接会短暂中断（约 2-3 秒），并且需要管理员权限。
                      {elevated === false ? " 当前进程不是管理员权限，写入会被系统拒绝。" : ""}
                    </span>
                  </div>
                </Space>
              </>
            )}
          </>
        )}
      </SectionCard>

      <Modal
        open={nameConfirmOpen}
        title="确认修改计算机名"
        okText="修改并重启后生效"
        cancelText="取消"
        okButtonProps={{ danger: true }}
        confirmLoading={nameBusy}
        onCancel={() => (nameBusy ? undefined : setNameConfirmOpen(false))}
        onOk={() => void applyComputerName()}
      >
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <ul className="plan-list">
            <li className="plan-row">
              <span className="plan-row__label">计算机名</span>
              <span className="plan-row__change">
                <span className="plan-row__from">{identity?.computerName ?? "—"}</span>
                <span aria-hidden="true">→</span>
                <span className="plan-row__to">{prefilledName}</span>
              </span>
            </li>
          </ul>
          <Typography.Text type="secondary">
            修改会同时更新主机名与 NetBIOS 名，需要管理员权限，并且必须重启系统后才会生效。
          </Typography.Text>
          <div className="danger-note">
            <span>
              重启前部分依赖主机名的服务（文件共享、域登录脚本、远程连接）仍会使用旧名称，可能出现短暂异常。
            </span>
          </div>
        </Space>
      </Modal>

      <Modal
        open={groupConfirmOpen}
        title="确认修改工作组"
        okText="修改并重启后生效"
        cancelText="取消"
        okButtonProps={{ danger: true }}
        confirmLoading={groupBusy}
        onCancel={() => (groupBusy ? undefined : setGroupConfirmOpen(false))}
        onOk={() => void applyWorkgroup()}
      >
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <ul className="plan-list">
            <li className="plan-row">
              <span className="plan-row__label">{identity?.partOfDomain ? "域 → 工作组" : "工作组"}</span>
              <span className="plan-row__change">
                <span className="plan-row__from">{groupText}</span>
                <span aria-hidden="true">→</span>
                <span className="plan-row__to">{prefilledGroup}</span>
              </span>
            </li>
          </ul>
          <Typography.Text type="secondary">
            修改工作组需要管理员权限，并且必须重启系统后才会生效。
          </Typography.Text>
          {identity?.partOfDomain ? (
            <div className="danger-note">
              <span>
                当前计算机已加入域 {identity.domain ?? ""}，改为工作组会使其退出域，域账户策略与共享权限都会失效。
              </span>
            </div>
          ) : null}
        </Space>
      </Modal>

      <Modal
        open={macConfirm === "apply"}
        title="确认应用新的 MAC 地址"
        okText="应用并重启网卡"
        cancelText="取消"
        okButtonProps={{ danger: true }}
        confirmLoading={macBusy}
        onCancel={() => (macBusy ? undefined : setMacConfirm(null))}
        onOk={() => void applyMac()}
      >
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <ul className="plan-list">
            <li className="plan-row">
              <span className="plan-row__label">目标网卡</span>
              <span className="plan-row__change">{adapter?.name ?? "—"}</span>
            </li>
            <li className="plan-row">
              <span className="plan-row__label">MAC 地址</span>
              <span className="plan-row__change">
                <span className="plan-row__from">{adapter?.mac ?? "—"}</span>
                <span aria-hidden="true">→</span>
                <span className="plan-row__to">{normalizeMacAddress(macInput)}</span>
              </span>
            </li>
          </ul>
          <div className="danger-note">
            <span>
              程序会写入注册表 NetworkAddress 覆盖值并禁用 / 启用网卡，当前连接会短暂中断（约 2-3 秒）；
              该操作需要管理员权限
              {elevated === false ? "（当前进程不是管理员权限，写入会被拒绝）" : ""}。
            </span>
          </div>
        </Space>
      </Modal>

      <Modal
        open={macConfirm === "clear"}
        title="确认清除 MAC 覆盖"
        okText="清除并重启网卡"
        cancelText="取消"
        okButtonProps={{ danger: true }}
        confirmLoading={macBusy}
        onCancel={() => (macBusy ? undefined : setMacConfirm(null))}
        onOk={() => void clearMacOverride()}
      >
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <ul className="plan-list">
            <li className="plan-row">
              <span className="plan-row__label">目标网卡</span>
              <span className="plan-row__change">{adapter?.name ?? "—"}</span>
            </li>
            <li className="plan-row">
              <span className="plan-row__label">MAC 地址</span>
              <span className="plan-row__change">
                <span className="plan-row__from">{adapter?.macOverride ?? "—"}</span>
                <span aria-hidden="true">→</span>
                <span className="plan-row__to">
                  {adapter?.permanentMac ?? "硬件地址（由驱动上报）"}
                </span>
              </span>
            </li>
          </ul>
          <div className="danger-note">
            <span>
              清除后程序会删除注册表中的 NetworkAddress 覆盖值并重启网卡，网卡将恢复使用硬件地址，
              当前连接同样会短暂中断；该操作需要管理员权限
              {elevated === false ? "（当前进程不是管理员权限，写入会被拒绝）" : ""}。
            </span>
          </div>
        </Space>
      </Modal>
    </>
  );
}
