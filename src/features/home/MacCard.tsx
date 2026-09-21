import { useEffect, useState } from "react";
import { App as AntApp, Button, Input, Space, Tag, Typography } from "antd";
import { WarningOutlined } from "@ant-design/icons";
import SectionCard from "../../components/SectionCard";
import StatusBanner from "../../components/StatusBanner";
import { adapters as adaptersApi } from "../../lib/api";
import { toAppError, type AppError } from "../../lib/errors";
import type { AdapterInfo } from "../../lib/types";
import { useAppStore } from "../../state/store";
import {
  normalizeMacAddress,
  validateMacAddress,
  type MacCheck,
} from "../identity/validation";

type FeedbackLevel = "success" | "info" | "warning" | "error";

interface Feedback {
  level: FeedbackLevel;
  title: string;
  message?: string | null;
  error?: AppError | null;
}

interface Props {
  adapter: AdapterInfo;
  /** True while another write (apply / toggle / restore) is running. */
  disabled: boolean;
}

const PREVIEW_HINT = "浏览器预览只提供只读数据，请在桌面程序中执行该操作。";

/** MAC 覆盖值管理：读取当前 / 永久地址，写入或清除注册表 NetworkAddress。 */
export default function MacCard({ adapter, disabled }: Props) {
  const { modal } = AntApp.useApp();
  const refreshAdapter = useAppStore((state) => state.refreshAdapter);
  const refreshAdapters = useAppStore((state) => state.refreshAdapters);
  const elevated = useAppStore((state) => state.status?.isElevated ?? null);

  const [macInput, setMacInput] = useState("");
  const [macError, setMacError] = useState<string | null>(null);
  const [macWarning, setMacWarning] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [randomBusy, setRandomBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  // A new target adapter invalidates whatever the user was typing.
  useEffect(() => {
    setMacInput("");
    setMacError(null);
    setMacWarning(null);
    setFeedback(null);
  }, [adapter.id]);

  const locked = disabled || busy;
  const hasOverride = adapter.macOverride !== null;

  const fillRandomMac = async () => {
    setRandomBusy(true);
    setMacError(null);
    setFeedback(null);
    try {
      const generated = await adaptersApi.randomMacAddress();
      setMacInput(normalizeMacAddress(generated));
      setMacWarning(validateMacAddress(generated).warning);
    } catch (caught) {
      const appError = toAppError(caught);
      setFeedback({
        level: "error",
        title: "生成随机 MAC 失败",
        message: appError.code === "NOT_SUPPORTED" ? PREVIEW_HINT : null,
        error: appError,
      });
    } finally {
      setRandomBusy(false);
    }
  };

  /** Local validation before the confirmation step. */
  const checkedInput = (): MacCheck | null => {
    const check = validateMacAddress(macInput);
    setMacError(check.error);
    setMacWarning(check.warning);
    if (check.error) {
      setFeedback({ level: "error", title: "MAC 地址不合法", message: check.error });
      return null;
    }
    return check;
  };

  /** The actual write; `null` clears the override. */
  const commitMac = async (mac: string | null) => {
    setBusy(true);
    setFeedback(null);
    try {
      const updated = await adaptersApi.changeMac(adapter.id, mac);
      const refreshed = await refreshAdapter(adapter.id);
      const current = refreshed ?? updated;
      await refreshAdapters({ silent: true });
      if (mac === null) {
        setMacInput("");
        setMacError(null);
        setMacWarning(null);
        setFeedback({
          level: "success",
          title: "已清除 MAC 覆盖",
          message: `网卡已恢复使用硬件地址，当前 MAC：${current.mac || "读取中"}`,
        });
      } else {
        setMacInput(normalizeMacAddress(current.mac));
        setFeedback({
          level: "success",
          title: "MAC 修改已提交",
          message: `网卡已重启以应用新地址，当前 MAC：${current.mac || "读取中"}`,
        });
      }
    } catch (caught) {
      const appError = toAppError(caught);
      setFeedback({
        level: "error",
        title:
          appError.code === "NOT_SUPPORTED"
            ? "当前环境不支持修改 MAC 地址"
            : mac === null
              ? "清除 MAC 覆盖失败"
              : "修改 MAC 地址失败",
        message: appError.code === "NOT_SUPPORTED" ? PREVIEW_HINT : null,
        error: appError,
      });
    } finally {
      setBusy(false);
    }
  };

  const elevationNote =
    elevated === false ? "（当前进程不是管理员权限，写入会被系统拒绝）" : "";

  const requestApply = () => {
    const check = checkedInput();
    if (!check) return;
    const target = check.normalized;
    modal.confirm({
      title: "确认应用新的 MAC 地址",
      content: (
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <ul className="plan-list">
            <li className="plan-row">
              <span className="plan-row__label">目标网卡</span>
              <span className="plan-row__change">{adapter.name}</span>
            </li>
            <li className="plan-row">
              <span className="plan-row__label">MAC 地址</span>
              <span className="plan-row__change">
                <span className="plan-row__from">{adapter.mac || "—"}</span>
                <span aria-hidden="true">→</span>
                <span className="plan-row__to">{target}</span>
              </span>
            </li>
          </ul>
          <div className="danger-note">
            <span>
              程序会写入注册表 NetworkAddress 覆盖值并禁用 / 启用网卡，该网卡上的网络连接会短暂中断（约
              2-3 秒），正在使用它的远程连接会断开；该操作需要管理员权限{elevationNote}。
            </span>
          </div>
        </Space>
      ),
      okText: "应用并重启网卡",
      cancelText: "取消",
      okButtonProps: { danger: true },
      centered: true,
      onOk: () => commitMac(target),
    });
  };

  const requestClear = () => {
    modal.confirm({
      title: "确认清除 MAC 覆盖",
      content: (
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <ul className="plan-list">
            <li className="plan-row">
              <span className="plan-row__label">目标网卡</span>
              <span className="plan-row__change">{adapter.name}</span>
            </li>
            <li className="plan-row">
              <span className="plan-row__label">MAC 地址</span>
              <span className="plan-row__change">
                <span className="plan-row__from">{adapter.macOverride ?? "—"}</span>
                <span aria-hidden="true">→</span>
                <span className="plan-row__to">
                  {adapter.permanentMac ?? "硬件地址（由驱动上报）"}
                </span>
              </span>
            </li>
          </ul>
          <div className="danger-note">
            <span>
              程序会删除注册表中的 NetworkAddress 覆盖值并禁用 / 启用网卡，网卡将恢复使用硬件地址，
              该网卡上的网络连接同样会短暂中断（约 2-3 秒）；该操作需要管理员权限{elevationNote}。
            </span>
          </div>
        </Space>
      ),
      okText: "清除并重启网卡",
      cancelText: "取消",
      okButtonProps: { danger: true },
      centered: true,
      onOk: () => commitMac(null),
    });
  };

  return (
    <SectionCard
      title="网卡 MAC 地址"
      hint="写入注册表 NetworkAddress 覆盖值并重启网卡，使其立即生效"
      extra={hasOverride ? <Tag color="blue">已覆盖</Tag> : <Tag>硬件地址</Tag>}
    >
      {feedback ? (
        <StatusBanner
          level={feedback.level}
          title={feedback.title}
          message={feedback.message}
          error={feedback.error}
          onDismiss={() => setFeedback(null)}
        />
      ) : null}

      <div className="kv-grid" style={{ marginBottom: 16 }}>
        <div className="kv">
          <span className="kv__label">当前 MAC（生效中）</span>
          <span className="kv__value kv__value--mono">{adapter.mac || "—"}</span>
        </div>
        <div className="kv">
          <span className="kv__label">MAC 覆盖值</span>
          <span className="kv__value kv__value--mono">
            {adapter.macOverride ?? "未设置（使用硬件地址）"}
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
            disabled={locked}
            placeholder="AA-BB-CC-DD-EE-FF"
            aria-label="新的 MAC 地址"
            status={macError ? "error" : undefined}
            onChange={(event) => {
              setMacInput(event.target.value);
              setMacError(null);
              setMacWarning(null);
            }}
            onPressEnter={requestApply}
          />
          <Button disabled={locked || randomBusy} loading={randomBusy} onClick={() => void fillRandomMac()}>
            随机生成
          </Button>
          <Button type="primary" disabled={locked || !macInput.trim()} onClick={requestApply}>
            应用新 MAC
          </Button>
          <Button
            danger
            disabled={locked || randomBusy || !hasOverride}
            onClick={requestClear}
          >
            清除覆盖（恢复硬件地址）
          </Button>
        </Space>

        {macError ? (
          <Typography.Text type="danger" role="alert" style={{ fontSize: 12 }}>
            {macError}
          </Typography.Text>
        ) : macWarning ? (
          <Typography.Text type="warning" style={{ fontSize: 12 }}>
            {macWarning}
          </Typography.Text>
        ) : (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            支持 AA-BB-CC-DD-EE-FF、AA:BB:CC:DD:EE:FF 或 12 位连续十六进制；第一字节必须是偶数（单播地址）。
            {hasOverride ? "" : " 当前没有覆盖值，「清除覆盖」不可用。"}
          </Typography.Text>
        )}

        <div className="danger-note">
          <WarningOutlined style={{ marginTop: 3 }} />
          <span>
            写入或清除 MAC 会重启网卡，该网卡上的网络连接会短暂中断（约 2-3 秒），并且需要管理员权限。
            {elevated === false ? " 当前进程不是管理员权限，写入会被系统拒绝。" : ""}
          </span>
        </div>
      </Space>
    </SectionCard>
  );
}
