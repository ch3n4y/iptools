import type { AdapterStatus, PingResult } from "./types";

export const STATUS_LABEL: Record<AdapterStatus, string> = {
  connected: "已连接",
  disconnected: "未连接",
  disabled: "已禁用",
  faulty: "设备异常",
  unknown: "未知",
};

export const STATUS_ORDER: AdapterStatus[] = [
  "connected",
  "disconnected",
  "disabled",
  "faulty",
  "unknown",
];

export function formatSpeed(bps: number): string {
  if (!Number.isFinite(bps) || bps <= 0) return "—";
  const units = ["bps", "Kbps", "Mbps", "Gbps", "Tbps"];
  let value = bps;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${Number.isInteger(value) ? value : value.toFixed(1)} ${units[unit]}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${Number.isInteger(value) ? value : value.toFixed(1)} ${units[unit]}`;
}

export function formatTimestamp(ms: number): string {
  if (!ms) return "—";
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export function formatRelative(ms: number): string {
  if (!ms) return "—";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return formatTimestamp(ms);
}

/** Colour band for a round-trip time, mirroring the original tool's shading. */
export function rttClass(rttMs: number | null, alive: boolean): string {
  if (!alive) return "rtt--dead";
  if (rttMs === null) return "rtt--fast";
  if (rttMs <= 10) return "rtt--fast";
  if (rttMs <= 60) return "rtt--mid";
  return "rtt--slow";
}

export function pingSummary(results: PingResult[]): {
  total: number;
  alive: number;
  dead: number;
  withMac: number;
} {
  const alive = results.filter((item) => item.alive).length;
  return {
    total: results.length,
    alive,
    dead: results.length - alive,
    withMac: results.filter((item) => !!item.mac).length,
  };
}

export function pingResultsToCsv(results: PingResult[]): string {
  const header = ["地址", "状态", "最小延时(ms)", "最大延时(ms)", "发送", "接收", "MAC", "本机", "说明"];
  const rows = results.map((item) => [
    item.target,
    item.alive ? "在线" : "无响应",
    item.rttMs ?? "",
    item.rttMaxMs ?? "",
    item.sent,
    item.received,
    item.mac ?? "",
    item.isLocal ? "是" : "",
    item.error ?? "",
  ]);
  return [header, ...rows]
    .map((row) =>
      row
        .map((cell) => {
          const text = String(cell ?? "");
          return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
        })
        .join(","),
    )
    .join("\r\n");
}

export function hostOfAdapter(address: string, prefix: number): string {
  const octets = address.split(".").map((value) => Number.parseInt(value, 10) || 0);
  const value =
    ((octets[0] << 24) >>> 0) + (octets[1] << 16) + (octets[2] << 8) + octets[3];
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = (value & mask) >>> 0;
  return [
    (network >>> 24) & 0xff,
    (network >>> 16) & 0xff,
    (network >>> 8) & 0xff,
    network & 0xff,
  ].join(".");
}

export function isPrivateIp(address: string): boolean {
  const parts = address.split(".").map((value) => Number.parseInt(value, 10));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return false;
  const [a, b] = parts;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}
