/**
 * 方案管理页的地址与掩码助手。
 *
 * 掩码/地址计算统一在 `lib/ipv4.ts`（以前这里有一份独立实现）。本模块只声明
 * **本页的掩码策略**：前缀必须 ≥ 1，即 `0`、`/0`、`0.0.0.0` 都视为不可用。
 * 与 Rust 后端 `subnet::parse_mask_or_prefix` 的规则保持一致。
 */
import { formatMaskFromPrefix, parseIpv4, parseMaskPrefix } from "../../lib/ipv4";
import type { AddressSpec, Scheme } from "../../lib/types";

export interface MaskParse {
  prefix: number;
  mask: string;
}


/** 掩码文本 -> `{prefix, mask}`；不可用时返回 `null`（规则见 lib/ipv4.ts）。 */

/** Dotted mask text for a prefix length, e.g. `24` -> `255.255.255.0`. */
export function maskFromPrefix(prefix: number): string {
  return formatMaskFromPrefix(prefix);
}

export function ipv4ToNumber(text: string): number | null {
  return parseIpv4(text);
}

export function isValidIpv4(text: string): boolean {
  return parseIpv4(text) !== null;
}

/** Accepts `24`, `/24` or a dotted mask. Returns null for anything unusable. */
export function parseMaskInput(text: string): MaskParse | null {
  const prefix = parseMaskPrefix(text);
  if (prefix === null) return null;
  return { prefix, mask: maskFromPrefix(prefix) };
}

export function addressSpecOf(address: string, maskText: string): AddressSpec | null {
  const trimmed = address.trim();
  if (!isValidIpv4(trimmed)) return null;
  const parsed = parseMaskInput(maskText || "24");
  if (!parsed) return null;
  return { address: trimmed, prefix: parsed.prefix, mask: parsed.mask };
}

/** MAC comparison key: hex digits only, upper case (ignores `-`, `:`, spaces). */
export function normalizeMacKey(text: string | null | undefined): string {
  if (!text) return "";
  return text.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
}

/** `null` for empty input, `undefined` when the text is not a plain number. */
export function parseOptionalNumber(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (!/^\d{1,5}$/.test(trimmed)) return undefined;
  return Number.parseInt(trimmed, 10);
}

export function blankScheme(): Scheme {
  return {
    id: "",
    name: "",
    tags: [],
    matchMac: null,
    matchHostname: null,
    matchAdapterName: null,
    dhcp: true,
    addresses: [],
    gateway: null,
    dnsMode: "dhcp",
    dns: [],
    metric: null,
    note: "",
    createdAtMs: 0,
    updatedAtMs: 0,
  };
}

/** Fresh, unsaved copy of an existing scheme (`id` is assigned by the backend). */
export function duplicateScheme(scheme: Scheme): Scheme {
  return {
    ...scheme,
    id: "",
    name: `${scheme.name} 副本`,
    tags: [...scheme.tags],
    addresses: scheme.addresses.map((spec) => ({ ...spec })),
    dns: [...scheme.dns],
    createdAtMs: 0,
    updatedAtMs: 0,
  };
}
