/**
 * The single place that talks to the native runtime.
 *
 * Everything else (features, components) calls the typed modules in this folder,
 * which in turn call `call()`/`subscribe()` here. Browser previews get explicit
 * read-only fallbacks instead of a broken UI (see `mock.ts`).
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { AppError, toAppError } from "../errors";

/** True when running inside the Tauri webview. */
export function isNative(): boolean {
  if (typeof window === "undefined") return false;
  const candidate = window as unknown as Record<string, unknown>;
  return "__TAURI_INTERNALS__" in candidate || "__TAURI__" in candidate;
}

export async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return (await invoke<T>(command, args)) as T;
  } catch (error) {
    // Rust returns a serialized AppError; normalize whatever arrives.
    throw toAppError(error);
  }
}

/** Rejects with a typed error when a desktop-only action is attempted. */
export function desktopOnly(action: string): AppError {
  return new AppError({
    code: "NOT_SUPPORTED",
    message: `${action}需要在桌面应用中使用`,
    hint: "浏览器预览仅提供只读数据，请运行桌面程序执行该操作",
  });
}

export async function subscribe<T>(
  event: string,
  handler: (payload: T) => void,
): Promise<UnlistenFn> {
  if (!isNative()) {
    return () => {};
  }
  return listen<T>(event, (message) => handler(message.payload));
}
