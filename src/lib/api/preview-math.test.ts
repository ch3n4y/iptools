import { describe, expect, it } from "vitest";
import { previewSubnet } from "./preview-math";

describe("browser-preview subnet math", () => {
  it("computes a /25 from a dotted mask", () => {
    const calc = previewSubnet("192.168.1.130", "255.255.255.128");
    expect(calc.prefix).toBe(25);
    expect(calc.network).toBe("192.168.1.128");
    expect(calc.broadcast).toBe("192.168.1.255");
    expect(calc.firstHost).toBe("192.168.1.129");
    expect(calc.lastHost).toBe("192.168.1.254");
    expect(calc.usableHostCount).toBe(126);
    expect(calc.wildcard).toBe("0.0.0.127");
    expect(calc.isPrivate).toBe(true);
  });

  it("accepts prefix notation like the native calculator", () => {
    expect(previewSubnet("10.0.0.5", "24").prefix).toBe(24);
    expect(previewSubnet("10.0.0.5", "/24").prefix).toBe(24);
    expect(previewSubnet("10.0.0.5", "22").mask).toBe("255.255.252.0");
  });

  it("treats /31 as point-to-point", () => {
    const calc = previewSubnet("10.0.0.0", "/31");
    expect(calc.prefix).toBe(31);
    expect(calc.firstHost).toBe("10.0.0.0");
    expect(calc.lastHost).toBe("10.0.0.1");
    expect(calc.usableHostCount).toBe(2);
  });

  it("works without an address", () => {
    const calc = previewSubnet(null, "24");
    expect(calc.ip).toBeNull();
    expect(calc.prefix).toBe(24);
    expect(calc.network).toBe("0.0.0.0");
  });

  it("rejects unusable masks instead of silently assuming /24", () => {
    expect(() => previewSubnet("10.0.0.1", "255.0.255.0")).toThrow(/掩码格式不支持/);
    expect(() => previewSubnet("10.0.0.1", "0")).toThrow(/掩码格式不支持/);
    expect(() => previewSubnet("10.0.0.1", "0.0.0.0")).toThrow(/掩码格式不支持/);
    expect(() => previewSubnet("10.0.0.1", "")).toThrow(/掩码格式不支持/);
  });
});
