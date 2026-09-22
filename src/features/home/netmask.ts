/**
 * 网卡配置页的 IPv4 / 掩码助手。
 *
 * 计算与规则都来自 `lib/ipv4.ts`（本模块只是本页的命名入口）：
 * 1-32 的前缀、连续的掩码，`/0`、`0`、`0.0.0.0` 一律视为不可用——
 * 与方案页、工具箱、浏览器预览以及 Rust 后端 `subnet::parse_mask_or_prefix` 一致。
 *
 * 后端以 `prefix` 为准并重新派生点分掩码，所以表单同时接受
 * `255.255.252.0` 与 `/22` 两种写法，提交前归一化。
 */
import { formatMaskFromPrefix, parseIpv4, parseMaskPrefix } from "../../lib/ipv4";

export function isValidIpv4(text: string): boolean {
  return parseIpv4(text) !== null;
}

export function maskFromPrefix(prefix: number): string {
  return formatMaskFromPrefix(prefix);
}

/**
 * 接受 `255.255.255.0`、`/22` 与 `22`。返回 `null` 表示这不是可用掩码
 * （不连续、越界或零掩码）。
 */
export function parseMaskText(text: string): number | null {
  return parseMaskPrefix(text);
}
