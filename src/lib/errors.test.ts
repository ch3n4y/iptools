import { describe, expect, it } from "vitest";
import { AppError, errorSummary, toAppError } from "./errors";

describe("error normalization", () => {
  it("keeps the stable code and flags elevation problems", () => {
    const error = new AppError({ code: "NOT_ELEVATED", message: "需要管理员权限" });
    expect(error.isElevationProblem).toBe(true);
    expect(error.code).toBe("NOT_ELEVATED");
    expect(new AppError({ code: "IO_ERROR", message: "x" }).isElevationProblem).toBe(false);
  });

  it("wraps a serialized backend error payload", () => {
    const error = toAppError({
      code: "ADAPTER_NOT_FOUND",
      message: "未找到指定的网卡",
      detail: "{GUID}",
      hint: "请刷新",
    });
    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe("ADAPTER_NOT_FOUND");
    expect(error.detail).toBe("{GUID}");
    expect(error.hint).toBe("请刷新");
  });

  it("copes with Error instances, strings and junk", () => {
    expect(toAppError(new Error("boom")).code).toBe("UNKNOWN");
    expect(toAppError(new Error("boom")).message).toBe("boom");
    expect(toAppError("oops").message).toBe("oops");
    expect(toAppError(null).code).toBe("UNKNOWN");
    expect(toAppError({ weird: true }).code).toBe("UNKNOWN");
  });

  it("passes an AppError through unchanged", () => {
    const original = new AppError({ code: "BUSY", message: "任务运行中" });
    expect(toAppError(original)).toBe(original);
  });

  it("builds a one-line summary without duplicating the title", () => {
    expect(errorSummary(new AppError({ code: "BUSY", message: "已有任务正在执行" }))).toBe(
      "已有任务正在执行",
    );
    const detailed = errorSummary(
      new AppError({ code: "COMMAND_FAILED", message: "netsh 返回 1" }),
    );
    expect(detailed).toContain("系统命令执行失败");
    expect(detailed).toContain("netsh 返回 1");
  });
});
