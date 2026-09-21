/**
 * Shared address helpers for the scheme manager and the advanced page.
 * Kept free of React so both views can reuse the exact same parsing rules as the
 * Rust backend (`subnet::parse_mask_or_prefix`).
 */
import type { AddressSpec, Scheme } from "../../lib/types";

export interface MaskParse {
  prefix: number;
  mask: string;
}

/** Dotted mask text for a prefix length, e.g. `24` -> `255.255.255.0`. */
export function maskFromPrefix(prefix: number): string {
  const clamped = Math.min(32, Math.max(0, Math.trunc(prefix)));
  const value = clamped === 0 ? 0 : (0xffffffff << (32 - clamped)) >>> 0;
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff].join(
    ".",
  );
}

export function ipv4ToNumber(text: string): number | null {
  const parts = text.trim().split(".");
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

export function isValidIpv4(text: string): boolean {
  return ipv4ToNumber(text) !== null;
}

/** Accepts `24`, `/24` or a dotted mask. Returns null for anything unusable. */
export function parseMaskInput(text: string): MaskParse | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const digits = trimmed.startsWith("/") ? trimmed.slice(1) : trimmed;
  if (/^\d{1,2}$/.test(digits)) {
    const prefix = Number.parseInt(digits, 10);
    if (prefix < 1 || prefix > 32) return null;
    return { prefix, mask: maskFromPrefix(prefix) };
  }
  const value = ipv4ToNumber(trimmed);
  if (value === null) return null;
  const inverted = ~value >>> 0;
  // A valid mask has a contiguous run of ones: inverted must be 2^n - 1.
  if (((inverted & (inverted + 1)) >>> 0) !== 0) return null;
  const prefix = value === 0 ? 0 : value.toString(2).split("").filter((bit) => bit === "1").length;
  if (prefix < 1 || prefix > 32) return null;
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
