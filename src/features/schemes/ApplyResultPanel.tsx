import { Tag, Typography } from "antd";
import type { ApplyResult } from "../../lib/types";
import { classifyApplyResult } from "../../lib/applyOutcome";

export interface ResultSummary {
  level: "success" | "warning" | "error";
  title: string;
  message: string;
}

/** Banner summary: success / mismatches / steps / rollback in one line of text. */
export function describeApplyResult(result: ApplyResult, action: string): ResultSummary {
  const outcome = classifyApplyResult(result);
  const parts: string[] = [result.message];
  if (result.steps.length > 0) {
    parts.push(
      `步骤 ${result.steps.length - outcome.failedSteps.length}/${result.steps.length} 成功`,
    );
  }
  if (outcome.failedSteps.length > 0) {
    parts.push(
      `失败步骤：${outcome.failedSteps.map((step) => `${step.label}（${step.message}）`).join("、")}`,
    );
  }
  if (result.mismatches.length > 0) {
    parts.push(`读回不一致：${result.mismatches.join("、")}`);
  }
  if (outcome.rolledBack) {
    parts.push(`已自动回滚${result.rollbackMessage ? `：${result.rollbackMessage}` : ""}`);
  }
  return {
    level: outcome.level,
    title: `${action}${result.success ? "成功" : "失败"}`,
    message: parts.join("；"),
  };
}

/** Read-only detail view of the last write: steps, verification and rollback. */
export default function ApplyResultPanel({ result, action }: { result: ApplyResult; action: string }) {
  return (
    <div>
      <div className="kv-grid">
        <div className="kv">
          <span className="kv__label">操作</span>
          <span className="kv__value">{action}</span>
        </div>
        <div className="kv">
          <span className="kv__label">写入结果</span>
          <span className="kv__value">{result.success ? "成功" : "失败"}</span>
        </div>
        <div className="kv">
          <span className="kv__label">读回校验</span>
          <span className="kv__value">{result.verified ? "通过" : "不通过"}</span>
        </div>
        <div className="kv">
          <span className="kv__label">自动回滚</span>
          <span className="kv__value">{result.rollbackPerformed ? "已回滚" : "未触发"}</span>
        </div>
        <div className="kv">
          <span className="kv__label">目标网卡</span>
          <span className="kv__value">{result.adapter ? result.adapter.name : "—"}</span>
        </div>
      </div>

      <Typography.Paragraph style={{ marginTop: 12, marginBottom: result.steps.length ? 8 : 0 }}>
        {result.message}
      </Typography.Paragraph>

      {result.steps.length > 0 ? (
        <ul className="plan-list">
          {result.steps.map((step) => (
            <li className="plan-row" key={step.step}>
              <span className="plan-row__label">{step.label}</span>
              <span className="plan-row__change">
                <Tag color={step.ok ? "green" : "red"} style={{ marginInlineEnd: 0 }}>
                  {step.ok ? "成功" : "失败"}
                </Tag>
                <span className="cell-mono">{step.message || "—"}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {result.mismatches.length > 0 ? (
        <div style={{ marginTop: 12 }}>
          <Typography.Text type="secondary">写入后读回，与目标配置不一致：</Typography.Text>
          <ul className="plan-list" style={{ marginTop: 8 }}>
            {result.mismatches.map((item) => (
              <li className="plan-row" key={item}>
                <span className="plan-row__label">不一致</span>
                <span className="plan-row__change cell-mono">{item}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {result.rollbackPerformed ? (
        <div className="danger-note" style={{ marginTop: 12 }}>
          <span>
            写入未通过校验，已尝试恢复修改前的配置。
            {result.rollbackMessage ? ` ${result.rollbackMessage}` : ""}
          </span>
        </div>
      ) : null}
    </div>
  );
}
