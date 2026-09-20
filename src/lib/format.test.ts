import { describe, expect, it } from "vitest";
import {
  formatBytes,
  formatSpeed,
  formatTimestamp,
  hostOfAdapter,
  isPrivateIp,
  pingResultsToCsv,
  pingSummary,
  rttClass,
} from "./format";
import type { PingResult } from "./types";

function ping(partial: Partial<PingResult> & { target: string }): PingResult {
  return {
    alive: false,
    rttMs: null,
    rttMaxMs: null,
    mac: null,
    isLocal: false,
    sent: 1,
    received: 0,
    error: null,
    ...partial,
  };
}

describe("format helpers", () => {
  it("formats link speeds with sensible precision", () => {
    expect(formatSpeed(1_000_000_000)).toBe("1 Gbps");
    expect(formatSpeed(100_000_000)).toBe("100 Mbps");
    expect(formatSpeed(866_700_000)).toBe("866.7 Mbps");
    expect(formatSpeed(0)).toBe("—");
    expect(formatSpeed(Number.NaN)).toBe("—");
  });

  it("formats byte sizes", () => {
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(0)).toBe("0 B");
  });

  it("renders timestamps and never invents a date for zero", () => {
    expect(formatTimestamp(0)).toBe("—");
    expect(formatTimestamp(Date.UTC(2026, 0, 2, 3, 4))).toMatch(/^2026-01-0[23] \d{2}:04$/);
  });

  it("maps round-trip times to colour bands", () => {
    expect(rttClass(null, false)).toBe("rtt--dead");
    expect(rttClass(null, true)).toBe("rtt--fast");
    expect(rttClass(5, true)).toBe("rtt--fast");
    expect(rttClass(30, true)).toBe("rtt--mid");
    expect(rttClass(120, true)).toBe("rtt--slow");
  });

  it("summarises scan results", () => {
    const summary = pingSummary([
      ping({ target: "10.0.0.1", alive: true, rttMs: 3, mac: "AA-BB-CC-DD-EE-FF" }),
      ping({ target: "10.0.0.2", alive: true, rttMs: 12 }),
      ping({ target: "10.0.0.3", error: "ARP 无应答" }),
    ]);
    expect(summary).toEqual({ total: 3, alive: 2, dead: 1, withMac: 1 });
  });

  it("exports CSV with quoting for embedded separators", () => {
    const csv = pingResultsToCsv([
      ping({ target: "10.0.0.1", alive: true, rttMs: 2, received: 1, isLocal: true }),
      ping({ target: "10.0.0.2", error: "超时, 未响应" }),
    ]);
    const [header, first, second] = csv.split("\r\n");
    expect(header.startsWith("地址,")).toBe(true);
    expect(first).toContain("10.0.0.1");
    expect(first).toContain("在线");
    expect(second).toContain('"超时, 未响应"');
    expect(csv.split("\r\n")).toHaveLength(3);
  });

  it("derives subnet network addresses", () => {
    expect(hostOfAdapter("10.30.1.237", 22)).toBe("10.30.0.0");
    expect(hostOfAdapter("192.168.1.10", 24)).toBe("192.168.1.0");
  });

  it("detects private address ranges", () => {
    expect(isPrivateIp("10.0.0.1")).toBe(true);
    expect(isPrivateIp("172.16.0.1")).toBe(true);
    expect(isPrivateIp("172.31.255.254")).toBe(true);
    expect(isPrivateIp("172.32.0.1")).toBe(false);
    expect(isPrivateIp("192.168.1.1")).toBe(true);
    expect(isPrivateIp("8.8.8.8")).toBe(false);
    expect(isPrivateIp("not-an-ip")).toBe(false);
  });
});
