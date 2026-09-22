import { describe, expect, it } from "vitest";
import {
  formatIpv4,
  formatMaskFromPrefix,
  isPrivateIpv4,
  maskValueFromPrefix,
  networkAddress,
  parseIpv4,
  parseMaskPrefix,
  prefixFromMaskValue,
} from "./ipv4";

describe("IPv4 基础换算", () => {
  it("解析并格式化地址", () => {
    expect(parseIpv4("10.0.0.1")).toBe(167772161);
    expect(parseIpv4(" 0.0.0.0 ")).toBe(0);
    expect(parseIpv4("255.255.255.255")).toBe(4294967295);
    expect(formatIpv4(167772161)).toBe("10.0.0.1");
    expect(formatIpv4(0)).toBe("0.0.0.0");
  });

  it("拒绝残缺、越界与非数字输入", () => {
    expect(parseIpv4("10.0.0")).toBeNull();
    expect(parseIpv4("10.0.0.256")).toBeNull();
    expect(parseIpv4("10.0.0.a")).toBeNull();
    expect(parseIpv4("")).toBeNull();
  });

  it("前缀与掩码互相换算", () => {
    expect(maskValueFromPrefix(24)).toBe(4294967040);
    expect(formatMaskFromPrefix(22)).toBe("255.255.252.0");
    expect(formatMaskFromPrefix(0)).toBe("0.0.0.0");
    // 渲染用的换算按 0..32 裁剪（解析另有规则，见下）
    expect(formatMaskFromPrefix(40)).toBe("255.255.255.255");
    expect(formatMaskFromPrefix(-3)).toBe("0.0.0.0");
  });

  it("只接受连续掩码", () => {
    expect(prefixFromMaskValue(parseIpv4("255.255.255.0") ?? 0)).toBe(24);
    expect(prefixFromMaskValue(parseIpv4("255.255.255.255") ?? 0)).toBe(32);
    expect(prefixFromMaskValue(0)).toBe(0);
    expect(prefixFromMaskValue(parseIpv4("255.0.255.0") ?? 0)).toBeNull();
    expect(prefixFromMaskValue(parseIpv4("0.0.0.1") ?? 0)).toBeNull();
  });

  it("按前缀计算网络地址", () => {
    expect(networkAddress(parseIpv4("10.30.1.237") ?? 0, 22)).toBe(parseIpv4("10.30.0.0"));
    expect(networkAddress(parseIpv4("192.168.1.10") ?? 0, 24)).toBe(parseIpv4("192.168.1.0"));
  });

  it("判定私有地址", () => {
    expect(isPrivateIpv4(parseIpv4("10.1.2.3") ?? 0)).toBe(true);
    expect(isPrivateIpv4(parseIpv4("172.16.5.5") ?? 0)).toBe(true);
    expect(isPrivateIpv4(parseIpv4("172.32.5.5") ?? 0)).toBe(false);
    expect(isPrivateIpv4(parseIpv4("192.168.0.1") ?? 0)).toBe(true);
    expect(isPrivateIpv4(parseIpv4("8.8.8.8") ?? 0)).toBe(false);
  });
});

describe("掩码解析：全局唯一策略（1-32，必须连续）", () => {
  it("接受三种写法的 1-32 前缀", () => {
    expect(parseMaskPrefix("24")).toBe(24);
    expect(parseMaskPrefix("/24")).toBe(24);
    expect(parseMaskPrefix("255.255.255.0")).toBe(24);
    expect(parseMaskPrefix("1")).toBe(1);
    expect(parseMaskPrefix("/32")).toBe(32);
    expect(parseMaskPrefix("255.255.252.0")).toBe(22);
  });

  it("拒绝 0 与所有等价的零掩码写法", () => {
    expect(parseMaskPrefix("0")).toBeNull();
    expect(parseMaskPrefix("/0")).toBeNull();
    expect(parseMaskPrefix("00")).toBeNull();
    expect(parseMaskPrefix("0.0.0.0")).toBeNull();
  });

  it("拒绝越界、不连续与格式错误", () => {
    expect(parseMaskPrefix("33")).toBeNull();
    expect(parseMaskPrefix("/33")).toBeNull();
    expect(parseMaskPrefix("255.0.255.0")).toBeNull();
    expect(parseMaskPrefix("0.0.0.1")).toBeNull();
    expect(parseMaskPrefix("255.255.255.255.0")).toBeNull();
    expect(parseMaskPrefix("abc")).toBeNull();
    expect(parseMaskPrefix("")).toBeNull();
    expect(parseMaskPrefix("  ")).toBeNull();
  });
});
