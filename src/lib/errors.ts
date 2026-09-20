import type { AppErrorPayload, ErrorCode } from "./types";

/** Normalized error crossing the native boundary. UI branches on `code`. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly detail?: string | null;
  readonly hint?: string | null;

  constructor(payload: AppErrorPayload) {
    super(payload.message);
    this.name = "AppError";
    this.code = payload.code;
    this.detail = payload.detail ?? null;
    this.hint = payload.hint ?? null;
  }

  get isElevationProblem(): boolean {
    return this.code === "NOT_ELEVATED";
  }
}

const CODE_FALLBACK: Record<string, string> = {
  NOT_ELEVATED: "需要管理员权限",
  ADAPTER_NOT_FOUND: "找不到指定的网卡",
  INVALID_INPUT: "输入不合法",
  NOT_FOUND: "目标不存在",
  IO_ERROR: "文件读写失败",
  COMMAND_FAILED: "系统命令执行失败",
  VERIFY_FAILED: "写入后校验不通过",
  NOT_SUPPORTED: "当前环境不支持该操作",
  BUSY: "已有任务正在执行",
  UNKNOWN: "未知错误",
};

/** Turns anything thrown by `invoke` into an AppError. */
export function toAppError(value: unknown): AppError {
  if (value instanceof AppError) {
    return value;
  }
  if (value && typeof value === "object") {
    const candidate = value as Partial<AppErrorPayload>;
    if (typeof candidate.code === "string" && typeof candidate.message === "string") {
      return new AppError({
        code: candidate.code as ErrorCode,
        message: candidate.message,
        detail: candidate.detail ?? null,
        hint: candidate.hint ?? null,
      });
    }
    if (typeof (value as Error).message === "string") {
      return new AppError({ code: "UNKNOWN", message: (value as Error).message });
    }
  }
  return new AppError({
    code: "UNKNOWN",
    message: typeof value === "string" ? value : "未知错误",
  });
}

export function errorTitle(error: AppError): string {
  return CODE_FALLBACK[error.code] ?? CODE_FALLBACK.UNKNOWN;
}

/** One-line summary for banners and notifications. */
export function errorSummary(error: AppError): string {
  const title = errorTitle(error);
  return error.message && error.message !== title ? `${title}：${error.message}` : title;
}
