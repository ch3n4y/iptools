import { call, desktopOnly, isNative } from "./native";
import { mockSchemes } from "./mock";
import type { ApplyPlan, ApplyResult, ImportReport, Scheme } from "../types";

export async function listSchemes(adapterId?: string | null): Promise<Scheme[]> {
  if (!isNative()) return mockSchemes;
  return call<Scheme[]>("list_schemes", { adapterId: adapterId ?? null });
}

export async function saveScheme(scheme: Scheme): Promise<Scheme> {
  if (!isNative()) throw desktopOnly("保存方案");
  return call<Scheme>("save_scheme", { scheme });
}

export async function deleteScheme(schemeId: string): Promise<Scheme[]> {
  if (!isNative()) throw desktopOnly("删除方案");
  return call<Scheme[]>("delete_scheme", { schemeId });
}

export async function reorderSchemes(schemeIds: string[]): Promise<Scheme[]> {
  if (!isNative()) throw desktopOnly("调整方案顺序");
  return call<Scheme[]>("reorder_schemes", { schemeIds });
}

export async function captureCurrentScheme(adapterId: string, name: string): Promise<Scheme> {
  if (!isNative()) throw desktopOnly("读取当前配置为新方案");
  return call<Scheme>("capture_current_scheme", { adapterId, name });
}

export async function planScheme(schemeId: string, adapterId: string): Promise<ApplyPlan> {
  if (!isNative()) {
    return {
      adapterId,
      adapterName: mockSchemes.find((scheme) => scheme.id === schemeId)?.name ?? "（预览）",
      dhcp: false,
      changes: [],
      warnings: ["浏览器预览不会写入系统配置"],
      errors: [],
      isElevated: false,
    };
  }
  return call<ApplyPlan>("plan_scheme", { schemeId, adapterId });
}

export async function applyScheme(schemeId: string, adapterId: string): Promise<ApplyResult> {
  if (!isNative()) throw desktopOnly("应用方案");
  return call<ApplyResult>("apply_scheme", { schemeId, adapterId });
}

export async function importSchemes(path: string): Promise<ImportReport> {
  if (!isNative()) throw desktopOnly("导入方案文件");
  return call<ImportReport>("import_schemes", { path });
}

export async function importSchemesText(text: string, format: string): Promise<ImportReport> {
  if (!isNative()) throw desktopOnly("导入方案文本");
  return call<ImportReport>("import_schemes_text", { text, format });
}

export async function mergeSchemes(schemes: Scheme[], overwrite: boolean): Promise<Scheme[]> {
  if (!isNative()) throw desktopOnly("写入方案");
  return call<Scheme[]>("merge_schemes", { schemes, overwrite });
}

export async function exportSchemes(path: string, format: "json" | "csv"): Promise<string> {
  if (!isNative()) throw desktopOnly("导出方案");
  return call<string>("export_schemes", { path, format });
}

export async function schemesLocation(): Promise<string> {
  if (!isNative()) return "%APPDATA%\\iptools\\schemes.json";
  return call<string>("schemes_location");
}
