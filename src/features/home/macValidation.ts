/**
 * 前端侧的 MAC 地址校验，与后端 `src-tauri/src/net/identity.rs` 的
 * `validate_mac` 保持一致（同样的措辞）：合法输入才允许发往后端。
 */

export interface MacCheck {
  /** 阻塞性问题；为 `null` 时表示可以写入。 */
  error: string | null;
  /** `AA-BB-CC-DD-EE-FF` 形式，可直接交给后端。 */
  normalized: string;
  /** 非阻塞提示（例如本地管理位为 0）。 */
  warning: string | null;
}

export function compactMac(value: string): string {
  return value.replace(/[\s:.-]/g, "").toUpperCase();
}

/** `AABBCCDDEEFF` -> `AA-BB-CC-DD-EE-FF`（输入不完整时也安全）。 */
export function normalizeMacAddress(value: string): string {
  return compactMac(value).replace(/(.{2})(?=.)/g, "$1-");
}

/**
 * 12 位十六进制、第一字节最低位为 0（单播），且不能全 0 / 全 FF。
 * 与后端 `identity::validate_mac` 对应。
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
