/**
 * Front-end mirrors of the Rust-side validation in
 * `src-tauri/src/net/identity.rs`. The UI rejects bad input before it ever
 * reaches the backend, with the same wording the backend would use.
 */

const NAME_PATTERN = /^[A-Za-z0-9-]+$/;

/** 1-15 characters, ASCII letters/digits/hyphen, never all digits. */
export function validateComputerName(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "请输入计算机名";
  if (trimmed.length > 15) {
    return `计算机名长度必须在 1-15 个字符之间（NetBIOS 限制），当前 ${trimmed.length} 个字符`;
  }
  if (!NAME_PATTERN.test(trimmed)) {
    const bad = Array.from(new Set(Array.from(trimmed).filter((ch) => !/^[A-Za-z0-9-]$/.test(ch))));
    return `计算机名只能包含字母、数字和连字符，请去掉：${bad.join(" ")}`;
  }
  if (/^[0-9]+$/.test(trimmed)) return "计算机名不能全部由数字组成";
  return null;
}

/** Same NetBIOS limits as the computer name, minus the "not all digits" rule. */
export function validateWorkgroupName(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "请输入工作组名称";
  if (trimmed.length > 15) {
    return `工作组名称长度必须在 1-15 个字符之间（NetBIOS 限制），当前 ${trimmed.length} 个字符`;
  }
  if (!NAME_PATTERN.test(trimmed)) return "工作组名称只能包含字母、数字和连字符";
  return null;
}

export interface MacCheck {
  /** Blocking problem, or `null` when the address may be written. */
  error: string | null;
  /** `AA-BB-CC-DD-EE-FF` form, ready to hand to the backend. */
  normalized: string;
  /** Non-blocking note (e.g. the locally-administered bit is clear). */
  warning: string | null;
}

export function compactMac(value: string): string {
  return value.replace(/[\s:.-]/g, "").toUpperCase();
}

/** `AABBCCDDEEFF` -> `AA-BB-CC-DD-EE-FF` (safe on partial input). */
export function normalizeMacAddress(value: string): string {
  return compactMac(value).replace(/(.{2})(?=.)/g, "$1-");
}

/**
 * 12 hex digits, first byte's least-significant bit clear (unicast), and not
 * all-zero / all-FF. Matches `identity::validate_mac`.
 */
export function validateMacAddress(value: string): MacCheck {
  const compact = compactMac(value);
  if (!compact) {
    return { error: "请输入 MAC 地址，例如 AA-BB-CC-DD-EE-FF", normalized: "", warning: null };
  }
  if (!/^[0-9A-F]{12}$/.test(compact)) {
    return {
      error: `MAC 地址必须是 12 位十六进制字符（当前 ${compact.length} 位，可用 - 或 : 分隔），例如 AA-BB-CC-DD-EE-FF`,
      normalized: normalizeMacAddress(compact),
      warning: null,
    };
  }

  const bytes = [0, 2, 4, 6, 8, 10].map((offset) =>
    Number.parseInt(compact.slice(offset, offset + 2), 16),
  );
  const normalized = normalizeMacAddress(compact);

  if (bytes.every((byte) => byte === 0)) {
    return { error: "MAC 地址不能全为 0（00-00-00-00-00-00）", normalized, warning: null };
  }
  if (bytes.every((byte) => byte === 0xff)) {
    return { error: "MAC 地址不能全为 FF（FF-FF-FF-FF-FF-FF）", normalized, warning: null };
  }
  if ((bytes[0] & 0x01) === 0x01) {
    return {
      error: `第一字节 ${normalized.slice(0, 2)} 是奇数，最低位为 1 表示组播地址，不能作为网卡单播地址；请改用偶数第一字节`,
      normalized,
      warning: null,
    };
  }

  const locallyAdministered = (bytes[0] & 0x02) === 0x02;
  return {
    error: null,
    normalized,
    warning: locallyAdministered
      ? null
      : `第一字节 ${normalized.slice(0, 2)} 的第二位为 0，属于「全球唯一（OUI）」范围。随机生成会使用本地管理地址（第二位为 1），手动填写时也建议保持第二位为 1。`,
  };
}
