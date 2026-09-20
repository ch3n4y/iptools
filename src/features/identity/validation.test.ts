import { describe, expect, it } from "vitest";
import {
  compactMac,
  normalizeMacAddress,
  validateComputerName,
  validateMacAddress,
  validateWorkgroupName,
} from "./validation";

describe("identity validation", () => {
  it("validates computer names against the NetBIOS rules", () => {
    expect(validateComputerName("")).not.toBeNull();
    expect(validateComputerName("DESKTOP-1")).toBeNull();
    expect(validateComputerName("1234567890123456")).toContain("1-15");
    expect(validateComputerName("123456789012345")).not.toBeNull();
    expect(validateComputerName("我的电脑")).toContain("只能包含字母、数字和连字符");
    expect(validateComputerName("12345")).toContain("不能全部由数字组成");
  });

  it("validates workgroup names", () => {
    expect(validateWorkgroupName("WORKGROUP")).toBeNull();
    expect(validateWorkgroupName("12345")).toBeNull();
    expect(validateWorkgroupName("BAD NAME")).toContain("只能包含字母、数字和连字符");
    expect(validateWorkgroupName("")).not.toBeNull();
  });

  it("normalizes MAC text", () => {
    expect(compactMac("aa:bb:cc:dd:ee:ff")).toBe("AABBCCDDEEFF");
    expect(normalizeMacAddress("aabbccddeeff")).toBe("AA-BB-CC-DD-EE-FF");
    expect(normalizeMacAddress("aa:bb:cc:dd:ee:ff")).toBe("AA-BB-CC-DD-EE-FF");
    expect(normalizeMacAddress("AABB")).toBe("AA-BB");
  });

  it("accepts a unicast locally-administered address", () => {
    const check = validateMacAddress("02-1a-2b-3c-4d-5e");
    expect(check.error).toBeNull();
    expect(check.warning).toBeNull();
    expect(check.normalized).toBe("02-1A-2B-3C-4D-5E");
  });

  it("warns when the locally-administered bit is clear", () => {
    // 0xE8 has bit 1 clear: a globally unique (OUI) address.
    const check = validateMacAddress("E8-80-88-85-62-11");
    expect(check.error).toBeNull();
    expect(check.warning).toContain("全球唯一");
  });

  it("treats 0xAA as locally administered", () => {
    const check = validateMacAddress("AA-BB-CC-DD-EE-FF");
    expect(check.error).toBeNull();
    expect(check.warning).toBeNull();
  });

  it("rejects multicast, all-zero, all-FF and malformed input", () => {
    expect(validateMacAddress("01-1a-2b-3c-4d-5e").error).toContain("组播");
    expect(validateMacAddress("00-00-00-00-00-00").error).toContain("全为 0");
    expect(validateMacAddress("FF-FF-FF-FF-FF-FF").error).toContain("全为 FF");
    expect(validateMacAddress("AABB").error).toContain("12 位");
    expect(validateMacAddress("").error).toContain("请输入");
  });
});
