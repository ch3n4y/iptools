import { call, desktopOnly, isNative } from "./native";
import { mockAdapters } from "./mock";
import type {
  AdapterBackup,
  AdapterInfo,
  ApplyPlan,
  ApplyRequest,
  ApplyResult,
  ValidationIssue,
} from "../types";

export async function listAdapters(): Promise<AdapterInfo[]> {
  if (!isNative()) return mockAdapters;
  return call<AdapterInfo[]>("list_adapters");
}

export async function getAdapter(adapterId: string): Promise<AdapterInfo> {
  if (!isNative()) {
    const found = mockAdapters.find((adapter) => adapter.id === adapterId);
    if (!found) throw desktopOnly("读取网卡信息");
    return found;
  }
  return call<AdapterInfo>("get_adapter", { adapterId });
}

export async function setAdapterEnabled(adapterId: string, enabled: boolean): Promise<AdapterInfo> {
  if (!isNative()) throw desktopOnly(enabled ? "启用网卡" : "禁用网卡");
  return call<AdapterInfo>("set_adapter_enabled", { adapterId, enabled });
}

export async function randomMacAddress(): Promise<string> {
  if (!isNative()) {
    const bytes = Array.from({ length: 6 }, () => Math.floor(Math.random() * 256));
    bytes[0] = (bytes[0] & 0xfc) | 0x02;
    return bytes.map((byte) => byte.toString(16).padStart(2, "0").toUpperCase()).join("-");
  }
  return call<string>("random_mac_address");
}

export async function changeMac(adapterId: string, mac: string | null): Promise<AdapterInfo> {
  if (!isNative()) throw desktopOnly("修改 MAC 地址");
  return call<AdapterInfo>("change_mac", { adapterId, mac });
}

export async function planApply(request: ApplyRequest): Promise<ApplyPlan> {
  if (!isNative()) {
    return {
      adapterId: request.adapterId,
      adapterName:
        mockAdapters.find((adapter) => adapter.id === request.adapterId)?.name ?? "（预览）",
      dhcp: request.dhcp,
      changes: [],
      warnings: ["浏览器预览不会写入系统配置"],
      errors: [],
      isElevated: false,
    };
  }
  return call<ApplyPlan>("plan_apply", { request });
}

export async function applyConfig(request: ApplyRequest): Promise<ApplyResult> {
  if (!isNative()) throw desktopOnly("应用网卡配置");
  return call<ApplyResult>("apply_config", { request });
}

export async function captureBackup(adapterId: string): Promise<AdapterBackup> {
  if (!isNative()) throw desktopOnly("备份网卡配置");
  return call<AdapterBackup>("capture_backup", { adapterId });
}

export async function restoreBackup(backup: AdapterBackup): Promise<ApplyResult> {
  if (!isNative()) throw desktopOnly("恢复网卡配置");
  return call<ApplyResult>("restore_backup", { backup });
}

export async function deriveGateway(ip: string, mask: string): Promise<string | null> {
  if (!isNative()) {
    const octets = ip.split(".").map((value) => Number.parseInt(value, 10));
    if (octets.length !== 4 || octets.some(Number.isNaN)) return null;
    return `${octets[0]}.${octets[1]}.${octets[2]}.1`;
  }
  return call<string | null>("derive_gateway", { ip, mask });
}

export async function defaultMaskFor(ip: string): Promise<string> {
  if (!isNative()) {
    const first = Number.parseInt(ip.split(".")[0] ?? "0", 10);
    if (first < 128) return "255.0.0.0";
    if (first < 192) return "255.255.0.0";
    return "255.255.255.0";
  }
  return call<string>("default_mask_for", { ip });
}

export type { ValidationIssue };
