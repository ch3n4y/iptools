/**
 * IPv4 mask / prefix helpers for the home view form.
 *
 * The backend treats `prefix` as the source of truth and re-derives the dotted
 * mask, so the form accepts both notations (`255.255.252.0` and `/22`) and
 * normalises them before submitting.
 */

const OCTET = /^\d{1,3}$/;

export function isValidIpv4(text: string): boolean {
  const parts = text.trim().split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => OCTET.test(part) && Number(part) <= 255);
}

export function maskFromPrefix(prefix: number): string {
  const safe = Math.min(32, Math.max(0, Math.trunc(prefix)));
  const value = safe === 0 ? 0 : (0xffffffff << (32 - safe)) >>> 0;
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ].join(".");
}

/**
 * Accepts `255.255.255.0`, `/22` and `22`. Returns `null` for anything that is
 * not a usable netmask (non-contiguous masks included).
 */
export function parseMaskText(text: string): number | null {
  const value = text.trim();
  if (!value) return null;

  const shortForm = /^\/?(\d{1,2})$/.exec(value);
  if (shortForm) {
    const prefix = Number(shortForm[1]);
    return prefix <= 32 ? prefix : null;
  }

  if (!isValidIpv4(value)) return null;

  let prefix = 0;
  let seenZero = false;
  for (const part of value.split(".")) {
    const octet = Number(part);
    for (let bit = 7; bit >= 0; bit -= 1) {
      if ((octet >> bit) & 1) {
        if (seenZero) return null; // e.g. 255.0.255.0 — not a valid mask
        prefix += 1;
      } else {
        seenZero = true;
      }
    }
  }
  return prefix;
}
