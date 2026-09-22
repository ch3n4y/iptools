/**
 * 浏览器预览用的子网计算（没有后端时让工具页仍可演示）。
 *
 * IPv4/掩码换算统一取自 `lib/ipv4.ts`，掩码规则与原生模式完全一致：
 * 无法解析的掩码**抛出错误**，不再像以前那样静默按 `/24` 计算——
 * 那个兜底让预览结果与原生结果悄悄不同。
 */
import {
  MASK_HINT,
  formatIpv4,
  isPrivateIpv4,
  maskValueFromPrefix,
  networkAddress,
  parseIpv4,
  parseMaskPrefix,
} from "../ipv4";
import type { SubnetCalc } from "../types";

export function previewSubnet(ip: string | null, maskText: string): SubnetCalc {
  const prefix = parseMaskPrefix(maskText);
  if (prefix === null) {
    throw new Error(`掩码格式不支持：${MASK_HINT}`);
  }
  const mask = maskValueFromPrefix(prefix);
  const address = ip ? parseIpv4(ip) : null;
  const reference = address ?? 0;
  const network = networkAddress(reference, prefix);
  const broadcast = (reference | (~mask >>> 0)) >>> 0;
  const hostCount = prefix >= 31 ? 2 ** (32 - prefix) : 2 ** (32 - prefix) - 2;
  const first = prefix >= 31 ? network : network + 1;
  const last = prefix >= 31 ? broadcast : broadcast - 1;
  return {
    ip: address === null ? null : formatIpv4(address),
    mask: formatIpv4(mask),
    prefix,
    wildcard: formatIpv4(~mask >>> 0),
    network: formatIpv4(network),
    broadcast: formatIpv4(broadcast),
    firstHost: formatIpv4(first),
    lastHost: formatIpv4(last),
    totalAddresses: 2 ** (32 - prefix),
    usableHostCount: hostCount,
    ipClass:
      (reference >>> 24) < 128 ? "A" : (reference >>> 24) < 192 ? "B" : (reference >>> 24) < 224 ? "C" : "D",
    isPrivate: isPrivateIpv4(reference),
    notes: ["浏览器预览使用内置计算，仅供界面预览"],
  };
}
