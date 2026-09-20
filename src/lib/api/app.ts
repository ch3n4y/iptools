import { call, desktopOnly, isNative, subscribe } from "./native";
import { mockStatus } from "./mock";
import type { AppStatus, UpdateInfo, UpdateProgress } from "../types";

export const UPDATE_PROGRESS_EVENT = "update://progress";

export async function appStatus(): Promise<AppStatus> {
  if (!isNative()) return mockStatus;
  return call<AppStatus>("app_status");
}

export async function checkUpdate(): Promise<UpdateInfo> {
  if (!isNative()) {
    return {
      currentVersion: mockStatus.version,
      available: false,
      version: null,
      notes: null,
      date: null,
      error: "浏览器预览无法访问更新服务",
      unsupported: true,
    };
  }
  return call<UpdateInfo>("check_update");
}

export async function installUpdate(): Promise<string> {
  if (!isNative()) throw desktopOnly("安装更新");
  return call<string>("install_update");
}

export function subscribeUpdateProgress(handler: (progress: UpdateProgress) => void) {
  return subscribe<UpdateProgress>(UPDATE_PROGRESS_EVENT, handler);
}
