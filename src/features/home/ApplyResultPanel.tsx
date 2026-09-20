import { Space, Tag, Typography } from "antd";
import { CheckCircleFilled, CloseCircleFilled, WarningOutlined } from "@ant-design/icons";
import SectionCard from "../../components/SectionCard";
import StatusBanner from "../../components/StatusBanner";
import type { AppError } from "../../lib/errors";
import { errorSummary } from "../../lib/errors";
import type { ApplyResult } from "../../lib/types";
import type { CSSProperties } from "react";

interface Props {
  result: ApplyResult | null;
  error: AppError | null;
  onRetry: () => void;
  onRefresh: () => void;
}

const stepRow: CSSProperties = { alignItems: "center" };
/** Outcome of the last write: banner + step-by-step diagnostics. */
export default function ApplyResultPanel({ result, error, onRetry, onRefresh }: Props) {
  if (!result && !error) return null;

  const actions = [
    { label: "重试", onClick: onRetry, primary: true },
    { label: "重新读取网卡状态", onClick: onRefresh },
  ];

  const banner = error ? (
    <StatusBanner
      level="error"
      title="写入过程未完成"
      message="系统配置可能仍是修改前的状态，请重新读取网卡状态确认后再重试。"
      error={error}
      actions={actions}
    />
  ) : result && result.success && result.verified ? (
    <StatusBanner
      level="success"
      title="配置已生效并通过读回校验"
      message={result.message}
      actions={[{ label: "重新读取网卡状态", onClick: onRefresh }]}
    />
  ) : result && !result.success ? (
    <StatusBanner
      level="error"
      title={
        result.rollbackPerformed
          ? "写入失败，已回滚到修改前的配置"
          : "写入失败"
      }
      message={result.message}
      actions={actions}
    />
  ) : result ? (
    <StatusBanner
      level="warning"
      title="配置已写入，但读回校验存在差异"
      message={result.message}
      actions={actions}
    />
  ) : null;

  const hasDiagnostics =
    !!result &&
    (result.steps.length > 0 ||
      result.mismatches.length > 0 ||
      result.rollbackPerformed ||
      !!result.rollbackMessage);

  return (
    <div>
      {banner}
      {hasDiagnostics && result ? (
        <SectionCard
          title="写入过程与诊断"
          hint={result.verified ? "读回校验已通过" : "读回校验未完全通过"}
        >
          {result.steps.length > 0 ? (
            <Space direction="vertical" size={8} style={{ width: "100%" }}>
              <Typography.Text style={{ fontSize: "var(--fs-xs)", color: "var(--text-faint)" }}>
                执行步骤（{result.steps.length} 步）
              </Typography.Text>
              <ul className="plan-list">
                {result.steps.map((step) => (
                  <li className="plan-row" key={step.step} style={stepRow}>
                    <span className="plan-row__label">{step.label}</span>
                    <span className="plan-row__change">
                      {step.ok ? (
                        <CheckCircleFilled
                          style={{ color: "var(--success)" }}
                          aria-hidden="true"
                        />
                      ) : (
                        <CloseCircleFilled style={{ color: "var(--danger)" }} aria-hidden="true" />
                      )}
                      <Tag color={step.ok ? "green" : "red"}>{step.ok ? "成功" : "失败"}</Tag>
                      <span style={{ color: "var(--text-soft)" }}>{step.message}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Space>
          ) : null}

          {result.mismatches.length > 0 ? (
            <Space
              direction="vertical"
              size={8}
              style={{ width: "100%", marginTop: result.steps.length > 0 ? 16 : 0 }}
            >
              <Typography.Text style={{ fontSize: "var(--fs-xs)", color: "var(--text-faint)" }}>
                读回校验不一致项（{result.mismatches.length}）
              </Typography.Text>
              <ul className="plan-list">
                {result.mismatches.map((mismatch) => (
                  <li className="plan-row" key={mismatch}>
                    <span className="plan-row__label">不一致</span>
                    <span className="plan-row__change">
                      <WarningOutlined
                        style={{ color: "var(--amber)" }}
                        aria-hidden="true"
                      />
                      <span>{mismatch}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Space>
          ) : null}

          {result.rollbackPerformed || result.rollbackMessage ? (
            <div
              className="danger-note"
              style={result.rollbackPerformed ? undefined : { marginTop: 16 }}
            >
              <WarningOutlined style={{ marginTop: 3 }} />
              <span>
                {result.rollbackPerformed ? "已执行回滚：" : "回滚说明："}
                {result.rollbackMessage ?? "已恢复到修改前的配置"}
              </span>
            </div>
          ) : null}

          {error ? (
            <Typography.Text type="secondary" style={{ display: "block", marginTop: 12 }}>
              错误摘要：{errorSummary(error)}
            </Typography.Text>
          ) : null}
        </SectionCard>
      ) : null}
    </div>
  );
}
