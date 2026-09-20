/**
 * Renderer-side mirror of the Rust DTOs in `src-tauri/src/dto.rs`.
 * `camelCase` on both sides; keep this file and the Rust structs in step.
 */

export type AdapterStatus = "connected" | "disconnected" | "disabled" | "faulty" | "unknown";
export type DnsMode = "dhcp" | "static";
export type PingMode = "arp" | "icmp" | "system";
export type ThemeMode = "system" | "light" | "dark";

export interface AddressSpec {
  address: string;
  prefix: number;
  mask: string;
}

export interface AddressEntry {
  address: string;
  prefix: number;
  mask: string;
  origin: "dhcp" | "manual" | "other" | string;
}

export interface Ipv4View {
  addresses: AddressEntry[];
  gateway: string | null;
  gatewayMetric: number | null;
}

export interface DnsView {
  servers: string[];
  source: "dhcp" | "static" | string;
}

export interface AdapterInfo {
  id: string;
  name: string;
  description: string;
  mac: string;
  permanentMac: string | null;
  macOverride: string | null;
  index: number;
  metric: number | null;
  mtu: number;
  isWireless: boolean;
  isVirtual: boolean;
  mediaType: string;
  status: AdapterStatus;
  linkSpeedBps: number;
  enabled: boolean;
  dhcpEnabled: boolean;
  ipv4: Ipv4View;
  dns: DnsView;
  deviceInstanceId: string | null;
}

export interface ApplyRequest {
  adapterId: string;
  dhcp: boolean;
  addresses: AddressSpec[];
  gateway: string | null;
  gatewayMetric: number | null;
  dnsMode: DnsMode;
  dns: string[];
  metric: number | null;
  noRollback?: boolean;
}

export interface ChangeItem {
  field: string;
  label: string;
  from: string;
  to: string;
}

export interface ApplyPlan {
  adapterId: string;
  adapterName: string;
  dhcp: boolean;
  changes: ChangeItem[];
  warnings: string[];
  errors: string[];
  isElevated: boolean;
}

export interface StepResult {
  step: string;
  label: string;
  ok: boolean;
  message: string;
}

export interface AdapterBackup {
  adapterId: string;
  adapterName: string;
  dhcp: boolean;
  addresses: AddressSpec[];
  gateway: string | null;
  gatewayMetric: number | null;
  dnsMode: DnsMode;
  dns: string[];
  metric: number | null;
}

export interface ApplyResult {
  success: boolean;
  verified: boolean;
  message: string;
  steps: StepResult[];
  adapter: AdapterInfo | null;
  backup: AdapterBackup | null;
  rollbackPerformed: boolean;
  rollbackMessage: string | null;
  mismatches: string[];
}

export interface Scheme {
  id: string;
  name: string;
  tags: string[];
  matchMac: string | null;
  matchHostname: string | null;
  matchAdapterName: string | null;
  dhcp: boolean;
  addresses: AddressSpec[];
  gateway: string | null;
  gatewayMetric: number | null;
  dnsMode: DnsMode;
  dns: string[];
  metric: number | null;
  note: string;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface ImportReport {
  schemes: Scheme[];
  errors: string[];
  skipped: number;
}

export interface PingDefaults {
  mode: PingMode;
  concurrency: number;
  timeoutMs: number;
  retries: number;
  slow: boolean;
  prefix: number;
  multipass: boolean;
  multipassRounds: number;
}

export interface AppSettings {
  version: number;
  theme: ThemeMode;
  confirmBeforeApply: boolean;
  autoRefreshAdapters: boolean;
  refreshIntervalMs: number;
  lastAdapterId: string | null;
  portable: boolean;
  ping: PingDefaults;
  checkUpdateOnStart: boolean;
}

export interface IdentityInfo {
  computerName: string;
  pendingComputerName: string | null;
  workgroup: string | null;
  domain: string | null;
  partOfDomain: boolean;
  rebootRequired: boolean;
}

export interface SubnetCalc {
  ip: string | null;
  mask: string;
  prefix: number;
  wildcard: string;
  network: string;
  broadcast: string;
  firstHost: string;
  lastHost: string;
  totalAddresses: number;
  usableHostCount: number;
  ipClass: string;
  isPrivate: boolean;
  notes: string[];
}

export interface ValidationIssue {
  level: "error" | "warning" | string;
  field: string;
  message: string;
}

export interface TargetList {
  targets: string[];
  errors: string[];
}

export interface PingRequest {
  jobId: string;
  targets: string[];
  mode: PingMode;
  concurrency: number;
  timeoutMs: number;
  retries: number;
  slow: boolean;
  localIp: string | null;
  multipass: boolean;
  multipassRounds: number;
}

export interface PingResult {
  target: string;
  alive: boolean;
  rttMs: number | null;
  rttMaxMs: number | null;
  mac: string | null;
  isLocal: boolean;
  sent: number;
  received: number;
  error: string | null;
}

export interface PingProgress {
  jobId: string;
  total: number;
  done: number;
  alive: number;
  results: PingResult[];
  finished: boolean;
}

export interface AppStatus {
  version: string;
  isElevated: boolean;
  configDir: string;
  schemesPath: string;
  settingsPath: string;
  portable: boolean;
  osDescription: string;
}

export interface UpdateInfo {
  currentVersion: string;
  available: boolean;
  version: string | null;
  notes: string | null;
  date: string | null;
  error: string | null;
  unsupported: boolean;
}

export interface UpdateProgress {
  downloaded: number;
  total: number | null;
  finished: boolean;
}

export type ErrorCode =
  | "NOT_ELEVATED"
  | "ADAPTER_NOT_FOUND"
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "IO_ERROR"
  | "COMMAND_FAILED"
  | "VERIFY_FAILED"
  | "NOT_SUPPORTED"
  | "BUSY"
  | "UNKNOWN";

export interface AppErrorPayload {
  code: ErrorCode;
  message: string;
  detail?: string | null;
  hint?: string | null;
}
