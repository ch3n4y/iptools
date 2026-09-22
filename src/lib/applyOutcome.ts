import type { ApplyResult, StepResult } from "./types";

export type ApplyOutcomeLevel = "success" | "warning" | "error";

export interface ApplyOutcome {
  level: ApplyOutcomeLevel;
  /** 结果为失败的步骤（用于"失败步骤"文案）。 */
  failedSteps: StepResult[];
  /** 是否执行过自动回滚。 */
  rolledBack: boolean;
}

/**
 * 写入结局的唯一定级规则。
 *
 * 以前「网卡配置」页与「方案管理」页各自判定：一次"回滚过但最终成功"的写入，
 * 前者显示绿色"配置已生效"、后者显示黄色警告。现在两处都用这里的规则：
 *
 * - 写入失败 → `error`；
 * - 写入成功，但有失败步骤 / 读回不一致 / 未通过读回校验 / 执行过自动回滚 → `warning`；
 * - 其余 → `success`。
 */
export function classifyApplyResult(result: ApplyResult): ApplyOutcome {
  const failedSteps = result.steps.filter((step) => !step.ok);
  const suspicious =
    failedSteps.length > 0 ||
    result.mismatches.length > 0 ||
    !result.verified ||
    result.rollbackPerformed;
  const level: ApplyOutcomeLevel = !result.success ? "error" : suspicious ? "warning" : "success";
  return { level, failedSteps, rolledBack: result.rollbackPerformed };
}
