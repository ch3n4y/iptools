import { describe, expect, it } from "vitest";
import type { AdapterInfo } from "../../lib/types";
import {
  MAX_ADDRESS_ROWS,
  MAX_DNS_SERVERS,
  blankForm,
  blankRow,
  buildRequest,
  formFromAdapter,
  validateForm,
  type HomeForm,
} from "./homeForm";

const adapter: AdapterInfo = {
  id: "{GUID}",
  name: "以太网",
  description: "Intel Ethernet",
  mac: "E8-80-88-85-62-11",
  permanentMac: null,
  macOverride: null,
  index: 14,
  metric: null,
  mtu: 1500,
  isWireless: false,
  isVirtual: false,
  mediaType: "Ethernet",
  status: "connected",
  linkSpeedBps: 1_000_000_000,
  enabled: true,
  dhcpEnabled: false,
  ipv4: {
    addresses: [
      { address: "10.30.1.237", prefix: 22, mask: "255.255.252.0", origin: "manual" },
      { address: "10.30.1.238", prefix: 22, mask: "255.255.252.0", origin: "manual" },
    ],
    gateway: "10.30.0.11",
  },
  dns: { servers: ["119.29.29.29", "223.5.5.5"], source: "static" },
  deviceInstanceId: null,
};

function staticForm(overrides: Partial<HomeForm> = {}): HomeForm {
  return {
    ...blankForm(),
    mode: "static",
    dnsMode: "static",
    addresses: [{ ...blankRow(), address: "192.168.1.10", mask: "255.255.255.0" }],
    gateway: "192.168.1.1",
    dns: ["8.8.8.8", "", ""],
    ...overrides,
  };
}

describe("home form model", () => {
  it("starts blank in DHCP mode with padded DNS rows", () => {
    const form = blankForm();
    expect(form.mode).toBe("dhcp");
    expect(form.addresses).toHaveLength(1);
    expect(form.dns).toHaveLength(MAX_DNS_SERVERS);
  });

  it("reads an adapter back into the form", () => {
    const form = formFromAdapter(adapter);
    expect(form.mode).toBe("static");
    expect(form.dnsMode).toBe("static");
    expect(form.addresses).toHaveLength(2);
    expect(form.addresses[0].address).toBe("10.30.1.237");
    expect(form.addresses[0].mask).toBe("255.255.252.0");
    expect(form.gateway).toBe("10.30.0.11");
    expect(form.dns.filter(Boolean)).toEqual(["119.29.29.29", "223.5.5.5"]);
  });

  it("accepts a clean static configuration", () => {
    expect(validateForm(staticForm())).toEqual({});
  });

  it("reports per-field problems for a static configuration", () => {
    const issues = validateForm(
      staticForm({
        addresses: [
          { ...blankRow(), address: "192.168.1.10", mask: "255.255.255.0" },
          { ...blankRow(), address: "192.168.1.10", mask: "255.0.255.0" },
        ],
        gateway: "999.1.1.1",
      }),
    );
    const messages = Object.values(issues);
    expect(messages.some((text) => text.includes("重复"))).toBe(true);
    expect(messages.some((text) => text.includes("掩码应为"))).toBe(true);
    expect(messages.some((text) => text.includes("默认网关格式不正确"))).toBe(true);
  });

  it("requires at least one DNS server when DNS is manual", () => {
    const issues = validateForm(staticForm({ dns: ["", "", ""] }));
    expect(issues["dns:0"]).toContain("至少填写一个");
  });

  it("ignores address rows entirely in DHCP mode", () => {
    const issues = validateForm({
      ...blankForm(),
      addresses: [{ ...blankRow(), address: "not-an-ip", mask: "nonsense" }],
    });
    expect(issues).toEqual({});
  });

  it("builds a request with re-derived masks", () => {
    const request = buildRequest("{GUID}", staticForm({
      addresses: [
        { ...blankRow(), address: " 192.168.1.10 ", mask: "/24" },
        { ...blankRow(), address: "10.9.9.9", mask: "16" },
      ],
      dns: ["8.8.8.8", "1.1.1.1", ""],
      metric: 20,
    }));
    expect(request.adapterId).toBe("{GUID}");
    expect(request.dhcp).toBe(false);
    expect(request.addresses).toEqual([
      { address: "192.168.1.10", prefix: 24, mask: "255.255.255.0" },
      { address: "10.9.9.9", prefix: 16, mask: "255.255.0.0" },
    ]);
    expect(request.gateway).toBe("192.168.1.1");
    expect(request.dns).toEqual(["8.8.8.8", "1.1.1.1"]);
    expect(request.metric).toBe(20);
  });

  it("drops addresses, gateway and DNS in DHCP mode", () => {
    const request = buildRequest("{GUID}", {
      ...staticForm(),
      mode: "dhcp",
      dnsMode: "dhcp",
    });
    expect(request.dhcp).toBe(true);
    expect(request.addresses).toEqual([]);
    expect(request.gateway).toBeNull();
    expect(request.dns).toEqual([]);
  });

  it("exposes the row limit the UI relies on", () => {
    expect(MAX_ADDRESS_ROWS).toBeGreaterThanOrEqual(4);
  });
});
