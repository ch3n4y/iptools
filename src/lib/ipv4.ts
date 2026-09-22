/**
 * IPv4 数学与掩码解析的唯一实现。
 *
 * 以前这段计算在 `features/home/netmask.ts`、`features/schemes/address.ts`、
 * `lib/api/preview-math.ts`、`features/toolbox/SubnetCalculatorView.tsx` 与
 * `lib/format.ts` 里各写了一遍，而且边界策略分叉：`0` / `/0` / `0.0.0.0` 在
 * 网卡页被接受、在方案页报错、在浏览器预览里被静默当成 `/24`。
 *
 * 现在实现只有这一份，规则也只有一条（与 Rust 后端 `subnet::parse_mask_or_prefix`
 * 一致）：
 * - 只接受 1-32 的前缀，`/0`、`0`、`0.0.0.0` 都不是可用掩码；
 * - 点分掩码必须是连续的 1（`255.0.255.0` 无效）；
 * - 无法解析一律返回 `null`，**调用方不得再自行兜底成某个默认掩码**。
 */

const SHORT_PREFIX = /^\/?(\d{1,2})$/;
const OCTET = /^\d{1,3}$/;

/** `10.0.0.1` -> `167772161`；非法输入返回 `null`。 */
export function parseIpv4(text: string): number | null {
  const parts = text.trim().split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!OCTET.test(part)) return null;
    const octet = Number.parseInt(part, 10);
    if (octet > 255) return null;
    value = ((value << 8) | octet) >>> 0;
  }
  return value;
}

/** `167772161` -> `10.0.0.1`。 */
export function formatIpv4(value: number): string {
  const safe = value >>> 0;
  return [
    (safe >>> 24) & 0xff,
    (safe >>> 16) & 0xff,
    (safe >>> 8) & 0xff,
    safe & 0xff,
  ].join(".");
}

/** 前缀长度对应的掩码数值（前缀被裁剪到 0..32；仅用于渲染，不用于解析）。 */
export function maskValueFromPrefix(prefix: number): number {
  const safe = Math.min(32, Math.max(0, Math.trunc(prefix)));
  return safe === 0 ? 0 : (0xffffffff << (32 - safe)) >>> 0;
}

/** 前缀长度对应的点分掩码，例如 `22` -> `255.255.252.0`。 */
export function formatMaskFromPrefix(prefix: number): string {
  return formatIpv4(maskValueFromPrefix(prefix));
}

/**
 * 点分掩码数值 -> 前缀长度。掩码必须是连续的 1（`255.0.255.0` 返回 `null`）。
 * 全 0 掩码返回 `0`：调用方若需要"可用掩码"的语义，请用 {@link parseMaskPrefix}。
 */
export function prefixFromMaskValue(mask: number): number | null {
  const safe = mask >>> 0;
  let ones = 0;
  let seenZero = false;
  for (let bit = 31; bit >= 0; bit -= 1) {
    if (((safe >>> bit) & 1) === 1) {
      if (seenZero) return null; // 不连续，例如 255.0.255.0
      ones += 1;
    } else {
      seenZero = true;
    }
  }
  return ones;
}

/** 掩码非法时的统一提示（各输入框与预览直接复用，避免措辞再次分叉）。 */
export const MASK_HINT = "应为 1-32 的前缀（如 /24）或连续的掩码（如 255.255.255.0）";

/**
 * 解析掩码文本：接受 `24`、`/24`、`255.255.255.0`。
 * 不在 1-32 范围、不连续、或无法解析时一律返回 `null`。
 */
export function parseMaskPrefix(text: string): number | null {
  const value = text.trim();
  if (!value) return null;

  const shortForm = SHORT_PREFIX.exec(value);
  if (shortForm) {
    const prefix = Number(shortForm[1]);
    return prefix >= 1 && prefix <= 32 ? prefix : null;
  }

  const mask = parseIpv4(value);
  if (mask === null) return null;
  const prefix = prefixFromMaskValue(mask);
  if (prefix === null || prefix < 1) return null;
  return prefix;
}

/** 地址所在子网的网络地址。 */
export function networkAddress(value: number, prefix: number): number {
  return (value & maskValueFromPrefix(prefix)) >>> 0;
}

/** RFC1918 私有地址判定（仅看地址数值）。 */
export function isPrivateIpv4(value: number): boolean {
  const first = (value >>> 24) & 0xff;
  const second = (value >>> 16) & 0xff;
  return (
    first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168)
  );
}
