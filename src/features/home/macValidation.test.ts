import { describe, expect, it } from "vitest";
import { compactMac, normalizeMacAddress, validateMacAddress } from "./macValidation";

describe("MAC 地址校验", () => {
  it("格式化 MAC 文本", () => {
    expect(compactMac("aa:bb:cc:dd:ee:ff")).toBe("AABBCCDDEEFF");
    expect(normalizeMacAddress("aabbccddeeff")).toBe("AA-BB-CC-DD-EE-FF");
    expect(normalizeMacAddress("aa:bb:cc:dd:ee:ff")).toBe("AA-BB-CC-DD-EE-FF");
    expect(normalizeMacAddress("AABB")).toBe("AA-BB");
  });

  it("接受本地管理的单播地址", () => {
    const check = validateMacAddress("02-1a-2b-3c-4d-5e");
    expect(check.error).toBeNull();
    expect(check.warning).toBeNull();
    expect(check.normalized).toBe("02-1A-2B-3C-4D-5E");
  });

  it("本地管理位为 0 时给出提示", () => {
    // 0xE8 第二位为 0：属于全球唯一（OUI）地址。
    const check = validateMacAddress("E8-80-88-85-62-11");
    expect(check.error).toBeNull();
    expect(check.warning).toContain("全球唯一");
  });

  it("0xAA 视为本地管理地址", () => {
    const check = validateMacAddress("AA-BB-CC-DD-EE-FF");
    expect(check.error).toBeNull();
    expect(check.warning).toBeNull();
  });

  it("拒绝组播、全 0、全 FF 与格式错误", () => {
    expect(validateMacAddress("01-1a-2b-3c-4d-5e").error).toContain("组播");
    expect(validateMacAddress("00-00-00-00-00-00").error).toContain("全为 0");
    expect(validateMacAddress("FF-FF-FF-FF-FF-FF").error).toContain("全为 FF");
    expect(validateMacAddress("AABB").error).toContain("12 位");
    expect(validateMacAddress("").error).toContain("请输入");
  });
});
