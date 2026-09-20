# IP 地址修改器

Windows 网络配置工具，用 **Tauri 2 + Rust** 与 **React 19 + TypeScript + Ant Design 5** 重写。
功能对标 [kn007 的《IP 地址修改器》](https://kn007.net/topics/ip-address-modifier-5-0-remastered/)（原版为 AutoIt 编写，本项目为全新实现，不含原版代码或资源）。

> 本程序会**修改系统网络配置**（IP / 掩码 / 网关 / DNS / 跃点数 / 网卡启停 / MAC / 计算机名 / 工作组），
> 写入后会自动读回校验，校验失败时自动回滚。请确认目标网卡后再写入。

## 功能

| 模块 | 说明 |
| --- | --- |
| 主界面 | 网卡列表（名称 / 状态 / MAC / 序号 / IP 摘要）、详情、静态与 DHCP 切换、多 IP、网关、DNS、接口跃点数、启用禁用、MAC 修改；应用前弹出变更预览并二次确认 |
| 方案管理 | 保存 / 编辑 / 重命名 / 排序 / 复制 / 删除方案；CSV、TSV、Excel(.xlsx) 与 JSON 导入导出；按 MAC 或计算机名匹配当前网卡的方案优先显示；F6 一键应用 |
| 高级选项 | 单网卡多 IP（最多 6 个地址）、按子网自动生成网关、A/B/C 类掩码快捷切换、配置校验、保存为方案、恢复备份、恢复为自动获取 |
| 工具箱 | C 网群 Ping 器（ARP / ICMP / 系统 ping，并发、超时、多连发、慢速模式、延时着色、本机地址高亮、进度与取消、导出 CSV）与子网掩码计算器（掩码 / 反掩码 / 网络地址 / 广播地址 / 主机范围，双击复制反掩码，可直接转入扫描） |
| 设置 | 主题（跟随系统 / 浅色 / 深色）、自动刷新、应用前确认、群 Ping 默认参数、配置位置与便携模式、自动更新 |
| 帮助 | 内置快捷键表、使用流程、功能说明与常见问题 |

## 构建与运行

前置：Node 20+、pnpm 11+、Rust stable（MSVC 工具链）、Windows 10/11、WebView2 运行时。

```powershell
pnpm install          # 安装前端依赖
pnpm tauri dev        # 开发运行（会弹出 UAC：程序声明 requireAdministrator）
pnpm build            # 仅前端：tsc + vite build，产物在 dist/
pnpm test             # 前端单元测试（Vitest）
cargo test --manifest-path src-tauri/Cargo.toml   # Rust 单元测试
pnpm tauri build      # 打包：NSIS 安装包 + 自动更新产物（.exe / .sig / latest.json）
```

打包产物位置：`src-tauri/target/release/bundle/nsis/` 与 `src-tauri/target/release/bundle/`。

### 命令行模式（诊断与自动化验收）

安装了程序或直接使用 `target/release/` 下的可执行文件均可：

```powershell
# 读取真实网卡（JSON 输出；--out 同时写文件）
"IP地址修改器.exe" --dump-adapters --out adapters.json
# 配置与身份信息
"IP地址修改器.exe" --dump-config --out config.json
# 内置自检（不修改系统）
"IP地址修改器.exe" --selftest --out selftest.json
# 检查更新
"IP地址修改器.exe" --check-update --out update.json

# 变更预览（dry-run，不写入）
"IP地址修改器.exe" --apply-config --input request.json --dry-run --out plan.json
# 备份当前配置 → 写入 → 需要时恢复
"IP地址修改器.exe" --capture-backup --adapter "{网卡GUID}" --out backup.json
"IP地址修改器.exe" --apply-config --input request.json --out result.json
"IP地址修改器.exe" --restore-backup --input backup.json --out restore.json
```

`--apply-config` 与 GUI 使用**同一条写入路径**（计划 → netsh 写入 → 读回校验 → 失败回滚）。请求 JSON 结构见 `docs/CONTRACT.md`。

## 配置与数据

- 默认位置：`%APPDATA%\IP地址修改器\`（`settings.json`、`schemes.json`）
- 便携模式：程序目录存在 `portable.txt` 时，配置改存程序目录（设置页可切换）
- 不读取原版 `ip.dat`（如有个性化需求，可用 CSV/JSON 导入方案）

## 发版与自动更新

1. 更新 `src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、`package.json` 中的版本号。
2. 提交并打标签：`git tag v1.0.1 && git push origin v1.0.1`。
3. GitHub Actions（`.github/workflows/release.yml`）在 `windows-latest` 上构建 NSIS 安装包与更新产物并**发布 Release**。
4. 客户端「设置 → 自动更新」读取 `https://github.com/ch3n4y/iptools/releases/latest/download/latest.json`。

### 更新签名密钥（务必妥善保管）

```powershell
# 生成（已生成一次，请勿覆盖；私钥不入库）
pnpm tauri signer generate -w $env:USERPROFILE\.tauri\iptools.key
# 公钥写入 src-tauri/tauri.conf.json → plugins.updater.pubkey
```

CI 需要的仓库密钥：

| Secret | 内容 |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | 私钥文件内容（`%USERPROFILE%\.tauri\iptools.key`） |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 私钥口令（`%USERPROFILE%\.tauri\iptools.key.password.txt`） |

私钥与口令丢失将无法再发布可被自动更新接受的版本。

## 目录结构

```
src/                     前端（React + TS + antd）
  lib/api/               类型化 API 边界（Tauri 调用 + 浏览器降级）
  lib/types.ts           与 Rust DTO 一一对应的类型
  state/store.ts         zustand 应用状态
  components/            标题栏、状态栏、确认对话框、结果横幅等共享件
  features/              各页面：主界面 / 方案 / 高级选项 / 工具箱 / 主机与 MAC / 设置 / 帮助
  styles/tokens.css      语义化设计令牌（浅色与深色成对设计）
src-tauri/src/
  net/                   Win32 与注册表：网卡枚举、设备启停、写入与校验
  ping.rs                群 Ping 引擎（ARP / ICMP / 系统 ping）
  subnet.rs              子网计算与配置校验（含单元测试）
  config.rs              设置与方案持久化、CSV/Excel 导入导出
  commands.rs            Tauri 命令层
docs/                    功能对照与接口契约
```
