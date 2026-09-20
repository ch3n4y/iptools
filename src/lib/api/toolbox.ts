import { call, desktopOnly, isNative, subscribe } from "./native";
import type { PingProgress, PingRequest, PingResult, SubnetCalc, TargetList } from "../types";

export const PING_PROGRESS_EVENT = "ping://progress";

export async function calculateSubnet(ip: string | null, mask: string): Promise<SubnetCalc> {
  if (!isNative()) {
    const { previewSubnet } = await import("./preview-math");
    return previewSubnet(ip, mask);
  }
  return call<SubnetCalc>("calculate_subnet", { ip, mask });
}

export async function expandPingTargets(spec: string): Promise<TargetList> {
  if (!isNative()) {
    const targets = spec
      .split(/[\s,;，；]+/)
      .map((entry) => entry.trim())
      .filter(Boolean);
    return { targets, errors: [] };
  }
  return call<TargetList>("expand_ping_targets", { spec });
}

export async function defaultScanSpec(): Promise<string> {
  if (!isNative()) return "192.168.1.0/24";
  return call<string>("default_scan_spec");
}

export async function startPing(request: PingRequest): Promise<void> {
  if (!isNative()) throw desktopOnly("网络扫描");
  await call<void>("start_ping", { request });
}

export async function cancelPing(jobId: string): Promise<void> {
  if (!isNative()) return;
  await call<void>("cancel_ping", { jobId });
}

export async function runningPingJobs(): Promise<string[]> {
  if (!isNative()) return [];
  return call<string[]>("running_ping_jobs");
}

export async function exportPingCsv(path: string, results: PingResult[]): Promise<string> {
  if (!isNative()) throw desktopOnly("导出扫描结果");
  return call<string>("export_ping_csv", { path, results });
}

export function subscribePingProgress(handler: (progress: PingProgress) => void) {
  return subscribe<PingProgress>(PING_PROGRESS_EVENT, handler);
}
