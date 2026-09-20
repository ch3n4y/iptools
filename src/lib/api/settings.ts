import { call, isNative } from "./native";
import { mockSettings } from "./mock";
import type { AppSettings } from "../types";

export async function getSettings(): Promise<AppSettings> {
  if (!isNative()) return mockSettings;
  return call<AppSettings>("get_settings");
}

export async function saveSettings(settings: AppSettings): Promise<AppSettings> {
  if (!isNative()) return settings;
  return call<AppSettings>("save_settings", { settings });
}

export async function setPortableMode(enabled: boolean): Promise<AppSettings> {
  if (!isNative()) {
    return { ...mockSettings, portable: enabled };
  }
  return call<AppSettings>("set_portable_mode", { enabled });
}
