//! DTOs for the renderer boundary. Every struct here is mirrored in
//! `src/lib/types.ts`; keep both sides in step (docs/CONTRACT.md).

use serde::{Deserialize, Serialize};

fn default_true() -> bool {
    true
}
fn default_version() -> u32 {
    1
}
fn default_theme() -> String {
    "system".to_string()
}
fn default_refresh_ms() -> u32 {
    8000
}
fn default_concurrency() -> u32 {
    64
}
fn default_timeout_ms() -> u32 {
    1000
}

// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AddressSpec {
    pub address: String,
    pub prefix: u32,
    pub mask: String,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AdapterStatus {
    Connected,
    Disconnected,
    Disabled,
    Faulty,
    Unknown,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AddressEntry {
    pub address: String,
    pub prefix: u32,
    pub mask: String,
    /// `dhcp` | `manual` | `other`
    pub origin: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Ipv4View {
    pub addresses: Vec<AddressEntry>,
    pub gateway: Option<String>,
    pub gateway_metric: Option<u32>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DnsView {
    pub servers: Vec<String>,
    /// `dhcp` | `static`
    pub source: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AdapterInfo {
    /// NetCfgInstanceId, e.g. `{0C1D2E3F-...}`; stable across reboots.
    pub id: String,
    /// Connection alias shown in Windows ("以太网", "WLAN").
    pub name: String,
    pub description: String,
    /// Currently effective MAC address (`AA-BB-CC-DD-EE-FF`).
    pub mac: String,
    /// MAC burned into the hardware, when the driver reports one.
    pub permanent_mac: Option<String>,
    /// `NetworkAddress` registry override, when the user set one.
    pub mac_override: Option<String>,
    pub index: u32,
    pub metric: Option<u32>,
    pub mtu: u32,
    pub is_wireless: bool,
    pub is_virtual: bool,
    pub media_type: String,
    pub status: AdapterStatus,
    pub link_speed_bps: u64,
    pub enabled: bool,
    pub dhcp_enabled: bool,
    pub ipv4: Ipv4View,
    pub dns: DnsView,
    pub device_instance_id: Option<String>,
}

// ---------------------------------------------------------------------------
// Apply plan / result
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum DnsMode {
    #[default]
    Dhcp,
    Static,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ApplyRequest {
    pub adapter_id: String,
    pub dhcp: bool,
    #[serde(default)]
    pub addresses: Vec<AddressSpec>,
    #[serde(default)]
    pub gateway: Option<String>,
    #[serde(default)]
    pub gateway_metric: Option<u32>,
    #[serde(default)]
    pub dns_mode: DnsMode,
    #[serde(default)]
    pub dns: Vec<String>,
    #[serde(default)]
    pub metric: Option<u32>,
    /// Skip the automatic rollback when verification fails.
    #[serde(default)]
    pub no_rollback: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ChangeItem {
    pub field: String,
    pub label: String,
    pub from: String,
    pub to: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ApplyPlan {
    pub adapter_id: String,
    pub adapter_name: String,
    pub dhcp: bool,
    pub changes: Vec<ChangeItem>,
    pub warnings: Vec<String>,
    pub errors: Vec<String>,
    pub is_elevated: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StepResult {
    pub step: String,
    pub label: String,
    pub ok: bool,
    pub message: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AdapterBackup {
    pub adapter_id: String,
    pub adapter_name: String,
    pub dhcp: bool,
    pub addresses: Vec<AddressSpec>,
    pub gateway: Option<String>,
    pub gateway_metric: Option<u32>,
    pub dns_mode: DnsMode,
    pub dns: Vec<String>,
    pub metric: Option<u32>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ApplyResult {
    pub success: bool,
    pub verified: bool,
    pub message: String,
    pub steps: Vec<StepResult>,
    pub adapter: Option<AdapterInfo>,
    pub backup: Option<AdapterBackup>,
    pub rollback_performed: bool,
    pub rollback_message: Option<String>,
    pub mismatches: Vec<String>,
}

// ---------------------------------------------------------------------------
// Schemes
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Scheme {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub match_mac: Option<String>,
    #[serde(default)]
    pub match_hostname: Option<String>,
    #[serde(default)]
    pub match_adapter_name: Option<String>,
    pub dhcp: bool,
    #[serde(default)]
    pub addresses: Vec<AddressSpec>,
    #[serde(default)]
    pub gateway: Option<String>,
    #[serde(default)]
    pub gateway_metric: Option<u32>,
    #[serde(default)]
    pub dns_mode: DnsMode,
    #[serde(default)]
    pub dns: Vec<String>,
    #[serde(default)]
    pub metric: Option<u32>,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub created_at_ms: u64,
    #[serde(default)]
    pub updated_at_ms: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SchemesFile {
    pub version: u32,
    #[serde(default)]
    pub schemes: Vec<Scheme>,
}

impl Default for SchemesFile {
    fn default() -> Self {
        Self {
            version: CURRENT_SCHEMES_VERSION,
            schemes: Vec::new(),
        }
    }
}

pub const CURRENT_SCHEMES_VERSION: u32 = 1;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub schemes: Vec<Scheme>,
    pub errors: Vec<String>,
    pub skipped: usize,
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum PingMode {
    #[default]
    Arp,
    Icmp,
    /// Uses the system `ping.exe` (kept for parity with the original tool).
    System,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PingDefaults {
    #[serde(default)]
    pub mode: PingMode,
    #[serde(default = "default_concurrency")]
    pub concurrency: u32,
    #[serde(default = "default_timeout_ms")]
    pub timeout_ms: u32,
    #[serde(default)]
    pub retries: u32,
    #[serde(default)]
    pub slow: bool,
    /// Default subnet prefix for the scanner, `/24` by default.
    #[serde(default = "default_prefix")]
    pub prefix: u32,
    #[serde(default = "default_true")]
    pub multipass: bool,
    #[serde(default)]
    pub multipass_rounds: u32,
}

fn default_prefix() -> u32 {
    24
}

impl Default for PingDefaults {
    fn default() -> Self {
        Self {
            mode: PingMode::Arp,
            concurrency: default_concurrency(),
            timeout_ms: default_timeout_ms(),
            retries: 1,
            slow: false,
            prefix: 24,
            multipass: true,
            multipass_rounds: 3,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default = "default_version")]
    pub version: u32,
    /// `system` | `light` | `dark`
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_true")]
    pub confirm_before_apply: bool,
    #[serde(default = "default_true")]
    pub auto_refresh_adapters: bool,
    #[serde(default = "default_refresh_ms")]
    pub refresh_interval_ms: u32,
    #[serde(default)]
    pub last_adapter_id: Option<String>,
    #[serde(default)]
    pub portable: bool,
    #[serde(default)]
    pub ping: PingDefaults,
    #[serde(default = "default_true")]
    pub check_update_on_start: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            version: 1,
            theme: default_theme(),
            confirm_before_apply: true,
            auto_refresh_adapters: true,
            refresh_interval_ms: default_refresh_ms(),
            last_adapter_id: None,
            portable: false,
            ping: PingDefaults::default(),
            check_update_on_start: true,
        }
    }
}

// ---------------------------------------------------------------------------
// Machine identity
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct IdentityInfo {
    pub computer_name: String,
    pub pending_computer_name: Option<String>,
    pub workgroup: Option<String>,
    pub domain: Option<String>,
    pub part_of_domain: bool,
    pub reboot_required: bool,
}

// ---------------------------------------------------------------------------
// Subnet calculator / validation
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SubnetCalc {
    pub ip: Option<String>,
    pub mask: String,
    pub prefix: u32,
    pub wildcard: String,
    pub network: String,
    pub broadcast: String,
    pub first_host: String,
    pub last_host: String,
    pub total_addresses: u64,
    pub usable_host_count: u64,
    pub ip_class: String,
    pub is_private: bool,
    pub notes: Vec<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ValidationIssue {
    /// `error` | `warning`
    pub level: String,
    pub field: String,
    pub message: String,
}

// ---------------------------------------------------------------------------
// Toolbox: ping jobs
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PingRequest {
    pub job_id: String,
    pub targets: Vec<String>,
    #[serde(default)]
    pub mode: PingMode,
    #[serde(default = "default_concurrency")]
    pub concurrency: u32,
    #[serde(default = "default_timeout_ms")]
    pub timeout_ms: u32,
    #[serde(default)]
    pub retries: u32,
    #[serde(default)]
    pub slow: bool,
    #[serde(default)]
    pub local_ip: Option<String>,
    #[serde(default = "default_true")]
    pub multipass: bool,
    #[serde(default = "default_multipass_rounds")]
    pub multipass_rounds: u32,
}

fn default_multipass_rounds() -> u32 {
    3
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PingResult {
    pub target: String,
    pub alive: bool,
    pub rtt_ms: Option<u32>,
    pub rtt_max_ms: Option<u32>,
    pub mac: Option<String>,
    pub is_local: bool,
    pub sent: u32,
    pub received: u32,
    pub error: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PingProgress {
    pub job_id: String,
    pub total: u32,
    pub done: u32,
    pub alive: u32,
    pub results: Vec<PingResult>,
    pub finished: bool,
}

// ---------------------------------------------------------------------------
// Application status / updates
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AppStatus {
    pub version: String,
    pub is_elevated: bool,
    pub config_dir: String,
    pub schemes_path: String,
    pub settings_path: String,
    pub portable: bool,
    pub os_description: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current_version: String,
    pub available: bool,
    pub version: Option<String>,
    pub notes: Option<String>,
    pub date: Option<String>,
    pub error: Option<String>,
    /// True when the check ran in a non-Tauri context and could not reach the updater.
    pub unsupported: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProgress {
    pub downloaded: u64,
    pub total: Option<u64>,
    pub finished: bool,
}

/// Result of expanding a scan spec into concrete targets (toolbox input helper).
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TargetList {
    pub targets: Vec<String>,
    pub errors: Vec<String>,
}
