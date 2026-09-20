import { Alert, Button, Modal, Space, Spin, Tag, Typography } from "antd";
import { WarningOutlined } from "@ant-design/icons";
import { useCallback, useEffect, useRef } from "react";
import type { ApplyPlan } from "../lib/types";

interface Props {
  open: boolean;
  plan: ApplyPlan | null;
  loadingPlan?: boolean;
  applying?: boolean;
  title?: string;
  confirmText?: string;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Consequential-action review: what changes (from to), plus warnings, stay in
 * front of the user. Confirmation is impossible while the backend reported a
 * blocking error.
 */
export default function ConfirmApplyDialog({
  open,
  plan,
  loadingPlan,
  applying,
  title = "确认应用网络配置",
  confirmText = "确认写入",
  onCancel,
  onConfirm,
}: Props) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  /**
   * Remember what was focused before the dialog opened so focus can be handed
   * back on close (the built-in restore is unreliable when the trigger
   * re-renders while the dialog is open).
   */
  useEffect(() => {
    if (open) return undefined;
    const remember = () => {
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== document.body) {
        triggerRef.current = active;
      }
    };
    document.addEventListener("focusin", remember);
    document.addEventListener("pointerdown", remember, true);
    return () => {
      document.removeEventListener("focusin", remember);
      document.removeEventListener("pointerdown", remember, true);
    };
  }, [open]);

  /**
   * Initial focus must land inside the dialog: otherwise Escape never reaches
   * the modal and keyboard users stay on the page behind it. When there is
   * nothing to confirm the primary button is disabled, so focus falls back to
   * the cancel button instead.
   */
  const focusInitial = useCallback(() => {
    const confirm = confirmRef.current;
    if (confirm && !confirm.disabled) {
      confirm.focus();
      return;
    }
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    if (open && plan && !loadingPlan) {
      const timer = window.setTimeout(focusInitial, 60);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [open, plan, loadingPlan, focusInitial]);

  const blocked = !!plan && plan.errors.length > 0;
  const nothingToDo = !!plan && plan.changes.length === 0 && plan.errors.length === 0;

  return (
    <Modal
      open={open}
      title={title}
      onCancel={applying ? undefined : onCancel}
      maskClosable={!applying}
      keyboard={!applying}
      destroyOnHidden={false}
      afterOpenChange={(isOpen) => {
        if (isOpen) {
          focusInitial();
          return;
        }
        const trigger = triggerRef.current;
        triggerRef.current = null;
        if (trigger && document.contains(trigger)) {
          trigger.focus();
        }
      }}
      footer={
        <Space>
          <Button ref={cancelRef} onClick={onCancel} disabled={applying}>
            取消
          </Button>
          <Button
            ref={confirmRef}
            type="primary"
            danger
            loading={applying}
            disabled={loadingPlan || blocked || nothingToDo}
            onClick={onConfirm}
          >
            {confirmText}
          </Button>
        </Space>
      }
    >
      {loadingPlan ? (
        <Space>
          <Spin size="small" />
          <Typography.Text type="secondary">正在生成变更预览…</Typography.Text>
        </Space>
      ) : plan ? (
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Typography.Text>
            目标网卡：<Typography.Text strong>{plan.adapterName}</Typography.Text>
            {plan.dhcp ? <Tag style={{ marginLeft: 8 }}>自动获取</Tag> : null}
          </Typography.Text>

          {plan.errors.length > 0 ? (
            <Alert
              type="error"
              showIcon
              message="配置存在错误，无法应用"
              description={
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {plan.errors.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              }
            />
          ) : null}

          {plan.warnings.length > 0 ? (
            <Alert
              type="warning"
              showIcon
              message="请注意"
              description={
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {plan.warnings.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              }
            />
          ) : null}

          {plan.changes.length > 0 ? (
            <ul className="plan-list">
              {plan.changes.map((change) => (
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
              当前填写的内容与网卡现状一致，无需写入。
            </Typography.Text>
          )}

          <div className="danger-note">
            <WarningOutlined style={{ marginTop: 3 }} />
            <span>
              写入会立即修改系统网络配置，可能导致当前连接短暂中断。写入后程序会自动读回校验，
              若校验不通过会尝试恢复修改前的配置。
              {!plan.isElevated ? " 当前不是管理员权限，写入会失败。" : ""}
            </span>
          </div>
        </Space>
      ) : (
        <Typography.Text type="secondary">无法生成变更预览。</Typography.Text>
      )}
    </Modal>
  );
}
