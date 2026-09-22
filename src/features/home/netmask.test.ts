import { describe, expect, it } from "vitest";
import { isValidIpv4, maskFromPrefix, parseMaskText } from "./netmask";

describe("netmask helpers", () => {
  it("validates dotted quads", () => {
    expect(isValidIpv4("192.168.1.10")).toBe(true);
    expect(isValidIpv4(" 10.0.0.1 ")).toBe(true);
    expect(isValidIpv4("256.1.1.1")).toBe(false);
    expect(isValidIpv4("1.2.3")).toBe(false);
    expect(isValidIpv4("1.2.3.4.5")).toBe(false);
    expect(isValidIpv4("a.b.c.d")).toBe(false);
    expect(isValidIpv4("")).toBe(false);
  });

  it("expands prefixes to dotted masks", () => {
    expect(maskFromPrefix(24)).toBe("255.255.255.0");
    expect(maskFromPrefix(22)).toBe("255.255.252.0");
    expect(maskFromPrefix(32)).toBe("255.255.255.255");
    expect(maskFromPrefix(0)).toBe("0.0.0.0");
    // Out-of-range input is clamped rather than producing nonsense.
    expect(maskFromPrefix(33)).toBe("255.255.255.255");
  });

  it("parses dotted masks, /nn and bare prefixes", () => {
    expect(parseMaskText("255.255.255.0")).toBe(24);
    expect(parseMaskText("255.255.252.0")).toBe(22);
    expect(parseMaskText("/22")).toBe(22);
    expect(parseMaskText("22")).toBe(22);
    expect(parseMaskText("32")).toBe(32);
  });

  it("rejects non-contiguous, zero and malformed masks", () => {
    expect(parseMaskText("255.0.255.0")).toBeNull();
    // 零掩码以前在本页是合法的（算 /0），现已统一为"一律不可用"
    expect(parseMaskText("0.0.0.0")).toBeNull();
    expect(parseMaskText("/0")).toBeNull();
    expect(parseMaskText("0")).toBeNull();
    expect(parseMaskText("33")).toBeNull();
    expect(parseMaskText("abc")).toBeNull();
    expect(parseMaskText("")).toBeNull();
  });
});
