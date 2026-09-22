import { describe, expect, it } from "vitest";
import { classifyApplyResult } from "./applyOutcome";
import type { ApplyResult, StepResult } from "./types";

function step(label: string, ok: boolean): StepResult {
  return { step: label, label, ok, message: ok ? "已完成" : "命令执行失败" };
}

function result(patch: Partial<ApplyResult>): ApplyResult {
  return {
    success: true,
    verified: true,
    message: "配置已应用",
    steps: [step("设置主 IP", true)],
    adapter: null,
    backup: null,
    rollbackPerformed: false,
    rollbackMessage: null,
    mismatches: [],
    ...patch,
  };
}

describe("写入结局定级（两个页面共用的唯一规则）", () => {
  it("全部通过时是 success", () => {
    expect(classifyApplyResult(result({})).level).toBe("success");
  });

  it("写入失败一律 error，无论是否回滚过", () => {
    expect(classifyApplyResult(result({ success: false })).level).toBe("error");
    expect(
      classifyApplyResult(result({ success: false, rollbackPerformed: true })).level,
    ).toBe("error");
  });

  it("回滚过但最终成功算 warning（原来是网卡页成功、方案页警告）", () => {
    const outcome = classifyApplyResult(
      result({ rollbackPerformed: true, rollbackMessage: "已恢复修改前的配置" }),
    );
    expect(outcome.level).toBe("warning");
    expect(outcome.rolledBack).toBe(true);
  });

  it("读回不一致、未通过校验或有失败步骤都算 warning", () => {
    expect(classifyApplyResult(result({ mismatches: ["IP 地址不一致"] })).level).toBe("warning");
    expect(classifyApplyResult(result({ verified: false })).level).toBe("warning");
    const withFailure = classifyApplyResult(
      result({ steps: [step("设置主 IP", true), step("设置 DNS", false)] }),
    );
    expect(withFailure.level).toBe("warning");
    expect(withFailure.failedSteps.map((entry) => entry.label)).toEqual(["设置 DNS"]);
  });
});
