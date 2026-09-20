# 接口契约（Rust ↔ 前端 / CLI）

前端只通过 `src/lib/api/*` 调用后端；每个 API 对应 `src-tauri/src/commands.rs` 中的一个
`#[tauri::command]`。类型定义在 `src-tauri/src/dto.rs`（serde `camelCase`）与 `src/lib/types.ts`（同名同形）。

## 1. 错误码

命令失败时返回结构体（不是字符串）：

```json
{ "code": "NOT_ELEVATED", "message": "当前进程没有管理员权限，无法执行该操作",
  "detail": "被拒绝的操作：修改网卡配置", "hint": "请使用界面右上角的“以管理员身份重启”后再试" }
```

| code | 含义 | 前端处理 |
| --- | --- | --- |
| `NOT_ELEVATED` | 需要管理员权限 | 提示提权重启（`ElevationBanner`） |
| `ADAPTER_NOT_FOUND` | 网卡不存在或已移除 | 提示刷新网卡列表 |
| `INVALID_INPUT` | 参数校验失败 | 行内错误 + 提示修正 |
| `NOT_FOUND` | 目标资源不存在（方案、文件、任务） | 提示刷新 |
| `IO_ERROR` | 配置文件读写失败 | 展示路径与原因 |
| `COMMAND_FAILED` | 系统命令或 API 失败 | 可重试 + 技术详情 |
| `VERIFY_FAILED` | 写入后读回校验不通过 | 展示差异与回滚结果 |
| `NOT_SUPPORTED` | 当前环境不支持（如浏览器预览中的写操作） | 明确禁用而非静默失败 |
| `BUSY` | 已有同类任务在运行 | 禁用入口 |
| `UNKNOWN` | 其他 | 展示详情 |

## 2. 命令一览

网卡：`list_adapters`、`get_adapter`、`set_adapter_enabled`、`random_mac_address`、`change_mac`
配置：`plan_apply`、`apply_config`、`capture_backup`、`restore_backup`、`derive_gateway`、`default_mask_for`
方案：`list_schemes`、`save_scheme`、`delete_scheme`、`reorder_schemes`、`capture_current_scheme`、`plan_scheme`、`apply_scheme`、`import_schemes`、`import_schemes_text`、`merge_schemes`、`export_schemes`、`schemes_location`
设置：`get_settings`、`save_settings`、`set_portable_mode`
身份：`get_identity`、`set_computer_name`、`set_workgroup`
工具箱：`calculate_subnet`、`expand_ping_targets`、`default_scan_spec`、`start_ping`、`cancel_ping`、`running_ping_jobs`、`export_ping_csv`
应用：`app_status`、`is_elevated`、`relaunch_as_admin`、`open_network_connections`、`open_app_location`、`check_update`、`install_update`

事件：`ping://progress`（`PingProgress`）、`update://progress`（`UpdateProgress`）。

## 3. 写入契约（`ApplyRequest`）

```json
{
  "adapterId": "{B434D128-D33E-4808-B068-B151CC1C87B6}",
  "dhcp": false,
  "addresses": [
    { "address": "192.168.77.10", "prefix": 24, "mask": "255.255.255.0" },
    { "address": "10.10.10.10", "prefix": 24, "mask": "255.255.255.0" }
  ],
  "gateway": "192.168.77.1",
  "gatewayMetric": null,
  "dnsMode": "static",
  "dns": ["1.1.1.1", "8.8.8.8"],
  "metric": 20,
  "noRollback": false
}
```

执行顺序：清理将被替换的旧地址 → 设置地址（DHCP 或静态主地址 + 附加地址）→ DNS → 接口跃点数。
之后轮询读回（≤6 秒）：比对获取方式、地址集合、网关、DNS 集合与来源、跃点数；
不一致时按 `noRollback=false` 自动回滚为修改前的配置，并在 `ApplyResult` 中报告
`mismatches` / `rollbackPerformed` / `rollbackMessage` / 每步 `steps[]`。

`dhcp: true` 时 `addresses` 会被忽略（并产生告警）；`dnsMode: "dhcp"` 时清空静态 DNS。

## 4. 方案文件与导入格式

`schemes.json`：

```json
{ "version": 1, "schemes": [ { "id": "...", "name": "办公室", "tags": ["常用"],
  "matchMac": "AA-BB-CC-DD-EE-FF", "matchHostname": "DESKTOP", "matchAdapterName": "以太网",
  "dhcp": false, "addresses": [{ "address": "10.0.0.9", "prefix": 24, "mask": "255.255.255.0" }],
  "gateway": "10.0.0.1", "gatewayMetric": null, "dnsMode": "static", "dns": ["1.1.1.1"],
  "metric": null, "note": "", "createdAtMs": 0, "updatedAtMs": 0 } ] }
```

迁移：接受 `{ "version": …, "schemes": [...] }`、纯数组 `[ ... ]`、以及旧的
`{ "方案名": { ... } }` 映射（键作为名称）。缺失字段使用默认值；名称、掩码、MAC 会被规范化。

CSV / TSV / Excel 表头（大小写不敏感，支持中英文别名）：

| 列 | 中文别名 | 说明 |
| --- | --- | --- |
| `name` | 名称、方案名 | 必填，否则该行报错并跳过 |
| `tags` | 标签 | `|` 或逗号分隔 |
| `matchMac` | 匹配MAC | 任意分隔符的 12 位十六进制 |
| `matchHostname` | 匹配主机名、主机名 | |
| `matchAdapterName` | 匹配网卡、网卡 | |
| `dhcp` | 自动获取 | `true/1/是/自动获取` 视为真；留空且无地址视为真 |
| `addresses` | 地址、IP地址、ip | 多个地址用 `|` 或空格分隔 |
| `masks` | 掩码、子网掩码、mask、prefix | 支持 `24`、`/24`、`255.255.255.0`，与 addresses 一一对应 |
| `ip2`/`mask2`、`ip3`/`mask3` | 地址2/掩码2、地址3/掩码3 | 手工表格的便捷列（导出时不写） |
| `gateway` | 网关、默认网关 | |
| `gatewayMetric` | 网关跃点 | 数字 |
| `dnsMode` | DNS模式 | `static` / `dhcp`；留空时按是否有 DNS 判断 |
| `dns` | DNS服务器 | 多个用分隔符 |
| `metric` | 跃点、接口跃点数 | 数字 |
| `note` | 备注、说明 | |

导出使用同一套列名，保证「导出 → 导入」往返一致。

## 5. 群 Ping 契约

`PingRequest.jobId` 由前端生成（`scan-<时间戳>`），用于关联 `ping://progress` 事件与取消。
目标表达式支持：单地址、逗号/空格/换行分隔、`a.b.c.0/24`（/8–/32，单次上限 4096 个）、
`a.b.c.10-20`、`a.b.c.10-a.b.c.20`。`mode`：`arp`（默认，可发现不回 ICMP 的主机）、
`icmp`（跨网段）、`system`（调用 `ping.exe`）。

## 6. 命令行（与 GUI 同一写路径）

| 参数 | 说明 |
| --- | --- |
| `--dump-adapters [--out f]` | 网卡 JSON（含 `elevated`、`deviceMapSize`） |
| `--dump-config [--out f]` | 设置 / 方案 / 身份 / 默认扫描段 |
| `--dump-devices [--out f]` | SetupAPI 枚举诊断（设备表、实例 ID 样例） |
| `--selftest [--out f]` | 只读自检：提权、网卡枚举、配置目录、方案往返、子网计算、目标展开 |
| `--check-update [--out f]` | 调用 Tauri updater 检查 `latest.json` |
| `--capture-backup --adapter <GUID> [--out f]` | 导出当前配置备份（`AdapterBackup`） |
| `--apply-config --input r.json [--dry-run] [--out f]` | 生成计划（dry-run）或执行写入并返回 `ApplyResult` |
| `--restore-backup --input b.json [--out f]` | 用备份文件恢复配置 |
| `--version` | 版本信息 |

因为程序声明了 `requireAdministrator`，命令行模式同样需要提权（例如 `gsudo` 或管理员终端）。
