/** Minimal subnet math for browser previews so the calculator stays usable. */
import type { SubnetCalc } from "../types";

function parseIpv4(input: string): number | null {
  const parts = input.trim().split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number.parseInt(part, 10);
    if (octet > 255) return null;
    value = (value << 8) | octet;
  }
  return value >>> 0;
}

function formatIpv4(value: number): string {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff].join(".");
}

function maskFromPrefix(prefix: number): number {
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
}

function prefixFromMask(mask: number): number | null {
  const inverted = ~mask >>> 0;
  if (((inverted & (inverted + 1)) >>> 0) !== 0) return null;
  const prefix = mask.toString(2).split("").filter((bit) => bit === "1").length;
  return prefix === 0 ? null : prefix;
}

function isPrivateAddress(value: number): boolean {
  const first = (value >>> 24) & 0xff;
  const second = (value >>> 16) & 0xff;
  return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
}

/** Accepts `255.255.255.0`, `/24` and `24` like the native calculator. */
function parseMaskText(maskText: string): number | null {
  const text = maskText.trim();
  const short = /^\/?(\d{1,2})$/.exec(text);
  if (short) {
    const prefix = Number.parseInt(short[1], 10);
    return prefix <= 32 ? prefix : null;
  }
  const mask = parseIpv4(text);
  return mask === null ? null : prefixFromMask(mask);
}

export function previewSubnet(ip: string | null, maskText: string): SubnetCalc {
  const prefix = parseMaskText(maskText);
  const effectivePrefix = prefix ?? 24;
  const mask = prefix === null ? maskFromPrefix(24) : maskFromPrefix(prefix);
  const address = ip ? parseIpv4(ip) : null;
  const reference = address ?? 0;
  const network = (reference & mask) >>> 0;
  const broadcast = (reference | (~mask >>> 0)) >>> 0;
  const hostCount = effectivePrefix >= 31 ? 2 ** (32 - effectivePrefix) : 2 ** (32 - effectivePrefix) - 2;
  const first = effectivePrefix >= 31 ? network : network + 1;
  const last = effectivePrefix >= 31 ? broadcast : broadcast - 1;
  return {
    ip: address === null ? null : formatIpv4(address),
    mask: formatIpv4(mask),
    prefix: effectivePrefix,
    wildcard: formatIpv4(~mask >>> 0),
    network: formatIpv4(network),
    broadcast: formatIpv4(broadcast),
    firstHost: formatIpv4(first),
    lastHost: formatIpv4(last),
    totalAddresses: 2 ** (32 - effectivePrefix),
    usableHostCount: hostCount,
    ipClass:
      (reference >>> 24) < 128 ? "A" : (reference >>> 24) < 192 ? "B" : (reference >>> 24) < 224 ? "C" : "D",
    isPrivate: isPrivateAddress(reference),
    notes: ["浏览器预览使用内置计算，仅供界面预览"],
  };
}
