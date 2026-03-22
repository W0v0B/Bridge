# Bridge — 设计文档

> **项目名称**：Bridge
> **文档版本**：v2.0
> **作者**：个人项目
> **技术栈**：Tauri 2 + Rust + React + TypeScript
> **最后更新**：2026-03

---

## 目录

1. [项目概述](#1-项目概述)
2. [需求](#2-需求)
3. [系统架构](#3-系统架构)
4. [模块设计](#4-模块设计)
5. [数据设计](#5-数据设计)
6. [UI 布局设计](#6-ui-布局设计)
7. [技术栈](#7-技术栈)
8. [开发计划](#8-开发计划)
9. [目录结构](#9-目录结构)

---

## 1. 项目概述

### 1.1 背景

在 Android 开发和嵌入式设备调试过程中，开发者经常需要打开终端手动运行 `adb` 命令来进行设备管理、文件传输和日志收集，同时还要使用串口工具与硬件通信。现有工具（如 SSCOM 和 Android Device Monitor）功能分散，缺乏一体化的可视化解决方案。

### 1.2 目标

构建一款 Windows 桌面调试工具，将 ADB 设备管理、OpenHarmony（OHOS）设备管理以及串口/Telnet 调试统一在单一界面中，减少重复操作，提升调试效率，并便于与团队成员共享。

### 1.3 核心价值

- 可视化管理 ADB 连接的 Android 设备，无需手动输入命令
- 可视化管理 HDC 连接的 OHOS 设备（HarmonyOS / OpenHarmony）
- 支持多文件批量传输，实时显示进度
- 一键收集、过滤和导出 logcat / HiLog 日志
- 集成串口终端，支持 Telnet 及快捷命令面板（灵感来源于 SSCOM 的扩展功能）
- 持久化配置，常用设置和命令无需重复输入

---

## 2. 需求

### 2.1 功能需求

#### ADB 模块

| 功能 | 描述 | 优先级 |
|------|------|--------|
| 设备列表 | 实时显示已连接的 ADB 设备（USB + 网络），支持热插拔检测 | P0 |
| ~~设备信息~~ | ~~显示设备型号、Android 版本、序列号、电量等~~ | ~~已删除~~ |
| 文件管理器 | 可视化浏览设备文件系统；支持上传、下载和删除 | P0 |
| 批量传输 | 多文件/文件夹拖放传输，实时进度条 | P0 |
| 日志收集 | 实时 logcat 输出，支持 Tag/Level 过滤及导出 | P0 |
| 应用管理器 | 可视化显示已安装应用列表（用户 + 系统）；安装 APK，按应用卸载/禁用 | P1 |
| 屏幕镜像 | 通过 scrcpy 子进程镜像并控制设备屏幕；每台设备独立窗口；可配置显示/输入/录制选项 | P1 |
| ADB 命令 | 内置常用 ADB 操作快捷方式（截图、重启等） | P1 |
| 网络 ADB | 通过输入 IP:Port 连接网络设备 | P1 |

#### 串口模块

| 功能 | 描述 | 优先级 |
|------|------|--------|
| 端口扫描 | 自动扫描并列出可用 COM 端口；COM 端口按数字排序（COM3 < COM10） | P0 |
| 串口连接 | 通过 ConnectModal 对话框配置波特率并连接；打开对话框和切换标签页时刷新端口列表 | P0 |
| Telnet 连接 | 通过 TCP 连接远程 host:port（用于串口网络适配器）；与 COM 端口共享同一 Shell UI | P1 |
| Shell 输入/输出 | 在统一 Shell 标签页中实时收发（纯文本显示） | P0 |
| 快捷命令面板 | 右侧面板用于保存常用命令；点击即可发送；支持添加/删除；ADB 与串口共用 | P0 |
| 序列执行器 | 快捷命令面板中的逐设备循环执行器；按可配置间隔循环执行命令；每台设备独立；切换设备后仍保持运行 | P1 |
| 日志导出 | 快照导出和持续写入文件的开关；均为逐设备独立 | P1 |
| ~~HEX 显示模式~~ | ~~切换 HEX / ASCII 显示~~ | ~~已延期~~ |
| ~~发送设置~~ | ~~可配置行结束符、定时自动发送~~ | ~~已延期~~ |

> **设计决策**：串口使用与 ADB 相同的 Shell 标签页——不单独设置"串口终端"标签页。Shell 标签页检测所选设备类型并分发到相应后端（ADB shell 与串口写入）。行结束符目前硬编码为 `\r\n`；可配置后缀延期实现。

#### OHOS 模块

| 功能 | 描述 | 优先级 |
|------|------|--------|
| 设备列表 | 实时显示已连接的 OHOS 设备（USB + TCP），支持自动连接；交叉比对 `hdc list targets`（权威来源）与 `hdc list targets -v`（元数据）以过滤幽灵 UART/loopback 条目 | P0 |
| 文件管理器 | 可视化浏览设备文件系统；支持上传、下载、删除；按设备显示挂载状态 | P0 |
| HiLog | 实时 HiLog 流式输出，支持级别/关键词过滤及导出 | P0 |
| Shell | 通过 `hdc shell` 进行交互式 shell；流式输出到统一 Shell 标签页 | P0 |
| 应用管理器 | 列出所有 HAP 包及安装路径和类型分类（用户/产品/厂商/系统）；安装 HAP、卸载用户应用、强制停止、清除数据 | P1 |
| 屏幕镜像 | 通过 `snapshot_display` + `hdc file recv` 进行应用内截屏；以可配置间隔流式传输 JPEG 帧；通过 `input keyevent` 进行方向键/按键远程控制 | P1 |
| 自动挂载 | 设备连接时自动运行 `hdc target mount`；在文件管理器标题栏显示挂载状态 | P1 |
| TCP 连接 | 通过 `hdc tconn` 使用 Host + Port 输入连接 OHOS 设备的 TCP 连接 | P1 |

### 2.2 非功能需求

- **性能**：文件传输不得阻塞 UI；日志渲染必须流畅（虚拟滚动）
- **稳定性**：自动检测并通知串口/ADB 断连，不崩溃；选择依赖项时优先考虑稳定性而非轻量
- **易用性**：无需环境配置；内置捆绑的 `adb.exe` 实现开箱即用；对安装包大小无限制
- **可维护性**：清晰的前后端分离；Rust 后端仅暴露 Tauri Commands；业务逻辑保持简洁可读

---

## 3. 系统架构

### 3.1 整体架构

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          Frontend (WebView)                              │
│            React + TypeScript + Ant Design + Zustand                     │
│                                                                          │
│  ┌────────────────┐  ┌──────────────┐  ┌────────────┐  ┌─────────────┐  │
│  │ Unified Shell  │  │ File Manager │  │   Logcat / │  │ App Manager │  │
│  │ (ADB+Serial+   │  │ (ADB + OHOS) │  │   HiLog    │  │ (ADB+OHOS)  │  │
│  │  Telnet+OHOS)  │  │              │  │            │  │             │  │
│  └────────────────┘  └──────────────┘  └────────────┘  └─────────────┘  │
└──────────────────────────────┬───────────────────────────────────────────┘
                               │ Tauri IPC (invoke / emit)
┌──────────────────────────────▼───────────────────────────────────────────┐
│                           Backend (Rust)                                 │
│                                                                          │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐   │
│  │   ADB Manager    │  │   OHOS Manager   │  │   Serial Manager     │   │
│  │                  │  │                  │  │                      │   │
│  │ - Device watcher │  │ - Device watcher │  │ - COM port scan      │   │
│  │ - Process mgmt   │  │ - Process mgmt   │  │ - COM read thread    │   │
│  │ - Progress parse │  │ - Auto-remount   │  │ - Telnet TCP session │   │
│  │ - root/remount   │  │ - Bundle mgmt    │  │ - IAC negotiation    │   │
│  └────────┬─────────┘  └────────┬─────────┘  └──────────┬───────────┘   │
│           │                     │                        │               │
│  ┌────────▼──────┐  ┌───────────▼──────┐  ┌─────────────▼────────────┐  │
│  │  adb.exe      │  │  hdc.exe         │  │  serialport-rs / TcpStream│  │
│  │  (bundled)    │  │  (DevEco / PATH) │  │                          │  │
│  └───────────────┘  └──────────────────┘  └──────────────────────────┘  │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐     │
│  │               tauri-plugin-store (config persistence)            │     │
│  └─────────────────────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────────────────┘
```

### 3.2 通信模型

前端与后端通过 Tauri IPC 通信：

- **前端 → 后端**：`invoke("command_name", { args })` 调用 Rust 函数并返回异步 Promise
- **后端 → 前端**：`app.emit("event_name", payload)` 推送实时数据（设备变化、日志流、串口数据、传输进度）

### 3.3 后台任务模型

```
tokio Runtime
│
├── Task: adb_device_watcher     # 每 2s 轮询 `adb devices`；变化时触发事件
├── Task: adb_root_remount       # 每次会话每台设备执行一次 root + remount
├── Task: logcat_reader          # 流式读取 adb logcat 标准输出；触发 LogcatBatch { serial, entries }
├── Task: shell_stream_reader    # 流式读取 adb shell 标准输出+错误输出；触发 shell_output/shell_exit
├── Task: file_transfer          # 流式推送/拉取进度；触发 transfer_progress
├── Task: scrcpy_monitor         # 等待 scrcpy 子进程退出；触发 scrcpy_state { serial, running: false }
│
├── Task: hdc_device_watcher     # 每 2s 轮询 `hdc list targets` + `-v`；交叉比对以过滤幽灵条目
├── Task: hdc_remount            # 每次会话每台设备执行一次 `hdc target mount`
├── Task: hilog_reader           # 流式读取 HiLog 输出；触发 HilogBatch { connect_key, entries } + 终止时触发 hilog_exit
├── Task: tlogcat_reader        # 流式读取 tlogcat 输出；触发 HilogBatch + hilog_exit；对错误消息进行回退解析
├── Task: hdc_shell_stream       # 流式读取 hdc shell 输出；触发 hdc_shell_output/hdc_shell_exit
├── Task: hdc_bundle_resolver    # 通过 JoinSet 并行调用 bm dump -n（用于应用管理器）
├── Task: hdc_screen_mirror      # 截图循环：snapshot_display → file recv → base64 → hdc_screen_frame；取消或连续 5 次失败时退出

std::thread (native)
│
├── Thread: serial_reader        # 阻塞式 COM 端口读取循环；AtomicBool 停止标志
└── Thread: telnet_reader        # 阻塞式 TCP 读取循环，含 IAC 剥离；AtomicBool 停止标志
```

---

## 4. 模块设计

### 4.1 ADB 模块

#### 4.1.1 设备管理

```rust
// Tauri Commands
#[tauri::command]
async fn get_devices() -> Result<Vec<AdbDevice>, String>

#[tauri::command]
async fn connect_network_device(host: String, port: u16) -> Result<String, String>

#[tauri::command]
async fn disconnect_device(serial: String) -> Result<(), String>

// Background watcher (registered on app startup)
async fn start_device_watcher(app: AppHandle)
// Runs `adb devices -l` every 2s, diffs the result against the previous state,
// and emits("devices_changed", Vec<AdbDevice>) when a change is detected
```

```typescript
// Frontend data structure
interface AdbDevice {
  serial: string;        // Device serial number
  state: "device" | "offline" | "unauthorized";
  model: string;         // Device model
  product: string;
  transport_id: string;
  is_root: boolean;      // true if adbd is running as root
  is_remounted: boolean; // true if system partition was successfully remounted
}
```

**连接时自动 root/remount**：当设备监控器检测到新上线的设备（`state == "device"`）时，会在后台生成 `attempt_root_and_remount()`（每次会话每个序列号仅执行一次）：
1. 运行 `adb -s {serial} root` 并解析输出：
   - `"already running as root"` → `is_root = true`
   - `"restarting adbd as root"` → 每隔 1 秒轮询 `whoami` 最多 6 秒以确认；确认后 `is_root = true`
   - 其他输出（如 `"cannot run as root in production builds"`）→ `is_root = false`
2. 如果 `is_root`：运行 `adb -s {serial} remount`；`is_remounted = output.status.success()`
3. 将结果存储在进程全局变量 `DEVICE_ROOT_STATUS: HashMap<String, (bool, bool)>` 中
4. 重新触发 `devices_changed` 事件（包含更新后的状态）以更新前端显示

Root/remount 状态在会话期间缓存（如果设备在 `adb root` 重启守护进程后短暂断线，不会对同一序列号重试）。

#### 4.1.2 文件管理器

文件系统浏览通过解析 `adb shell ls -la <path>` 的输出实现。上传和下载使用 `adb push` / `adb pull`。

**多选** — 用户可单击来切换文件/文件夹的选中状态（从选中集合中添加/移除）。双击清除所有选中并打开该项（进入文件夹，对文件打开 View 模态框）。批量下载和删除对所有已选项执行。

**拖放上传** — 从操作系统文件管理器拖入文件表格区域的文件将上传到当前远程目录。拖放时显示视觉覆盖层，该覆盖层定位在最外层不可滚动容器上，确保无论滚动位置如何均可见。Tauri 的 `tauri://drag-drop` 窗口级事件提供原生文件路径。

**上传模态框** — Upload 按钮打开一个模态框，包含拖放区域、文件浏览器按钮、可编辑的目标路径，以及带有移除按钮的文件列表。共用的 `UploadModal` 组件同时被 ADB 和 OHOS 文件管理器使用。它接受可选的 `quickPaths` 属性，用于在目标路径输入框上方显示可点击的快捷访问标签，与文件管理器工具栏中配置的快捷访问路径对应。

```rust
#[tauri::command]
async fn list_files(serial: String, path: String) -> Result<Vec<FileEntry>, String>

#[tauri::command]
async fn push_files(serial: String, local_paths: Vec<String>, remote_path: String, app: AppHandle) -> Result<(), String>
// Streams stdout, regex-matches progress, emits("transfer_progress", TransferProgress)

#[tauri::command]
async fn pull_file(serial: String, remote_path: String, local_path: String, app: AppHandle) -> Result<(), String>

#[tauri::command]
async fn delete_file(serial: String, path: String) -> Result<(), String>
```

**查看（Cat）功能** — `CatModal` 组件（`src/components/adb/CatModal.tsx`）：
- 通过**双击**文件表格中的文件触发
- 通过 `runShellCommand` 读取文件内容（无需新建后端命令）：
  - 文本模式：`head -c {N} "{path}" 2>&1`
  - Hex 模式：`xxd -l {N} "{path}" 2>&1`（需要设备上有 `xxd`；不可用时内联显示错误）
- **大小限制**：用户可配置 1–512 KB，默认 8 KB；输出达到限制的 ≥95% 时显示截断警告
- **自动刷新**：可选开关，配置间隔（1–60 秒）；为实时 proc 节点（如 `/proc/meminfo`）反复更新视图
- `loadingRef` 守卫防止在前一次请求仍在进行时自动刷新触发重叠请求

```typescript
interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  permissions: string;
  modified: string;
}

interface TransferProgress {
  file_name: string;
  transferred: number;  // bytes
  total: number;
  percent: number;
  speed: string;        // e.g. "1.2 MB/s"
}
```

#### 4.1.3 日志收集

```rust
#[tauri::command]
async fn start_logcat(serial: String, filter: LogcatFilter, app: AppHandle) -> Result<(), String>
// Spawns `adb -s {serial} logcat -v threadtime`
// Parses stdout using a lenient regex that handles both `MM-DD` and `YYYY-MM-DD` timestamp prefixes
// Batches parsed entries: emits("logcat_lines", LogcatBatch { serial, entries }) every 50ms or per 64 entries

#[tauri::command]
async fn stop_logcat(serial: String) -> Result<(), String>
// Kills the logcat process via taskkill /F /T /PID (Windows; kills full process tree)

#[tauri::command]
async fn start_tlogcat(serial: String, app: AppHandle) -> Result<(), String>
// Spawns `adb -s {serial} shell tlogcat`
// Same batched-emit model; emits("tlogcat_lines", LogcatBatch { serial, entries })
// Also pipes stderr — stderr lines are emitted as error-level entries (tag: "tlogcat-stderr")

#[tauri::command]
async fn stop_tlogcat(serial: String) -> Result<(), String>

#[tauri::command]
async fn clear_device_log(serial: String) -> Result<(), String>
// Runs `adb -s {serial} logcat -c` to flush the on-device logcat ring buffer
// Only applies to logcat mode; tlogcat has no equivalent clear command

#[tauri::command]
async fn export_logs(logs: Vec<LogEntry>, path: String) -> Result<(), String>
```

```typescript
interface LogEntry {
  timestamp: string;
  pid: string;
  tid: string;
  level: "V" | "D" | "I" | "W" | "E" | "F";
  tag: string;
  message: string;
}

interface LogcatFilter {
  level: string | null;   // null = show all levels
  tags: string[] | null;  // null = no tag filter
  keyword: string | null; // null = no keyword filter
}
```

**批量事件模型**：后端不是每行日志触发一次 IPC 事件，而是累积解析后的条目并批量刷新（最多 64 条，或 50 毫秒无活动后）。这大幅降低了高吞吐量日志记录时的 IPC 开销。

#### 4.1.4 Shell 流式传输

所有 ADB shell 命令使用流式执行模型。后端不等待命令退出，而是生成进程、分块读取标准输出，并发送实时事件。这使得长时间运行的命令（如 `logcat`、`top`、`tcpdump`）能够流式传输输出，并可通过 Stop 按钮取消。

```rust
// Process-global PID map for one active stream per device
static SHELL_PROCESSES: Lazy<Mutex<HashMap<String, u32>>>

#[tauri::command]
async fn start_shell_stream(serial: String, command: String, app: AppHandle) -> Result<(), String>
// 1. If a process already exists for "shell:{serial}", kills it first (auto-stop previous)
// 2. Spawns `adb -s {serial} shell {command}` with stdout+stderr both piped, kill_on_drop
// 3. Stores PID in SHELL_PROCESSES
// 4. Spawns two parallel tokio tasks — one reads stdout in 8KB chunks, one reads stderr in 4KB
//    chunks; both emit("shell_output", ShellOutput) so error text appears in the terminal
// 5. On process exit, emits("shell_exit", ShellExit) and removes PID from map

#[tauri::command]
async fn stop_shell_stream(serial: String) -> Result<(), String>
// Removes PID from SHELL_PROCESSES and kills the process tree via `taskkill /F /T /PID`
```

```typescript
// Event payloads
interface ShellOutput {
  serial: string;
  data: string;     // Raw chunk (may contain multiple lines)
}

interface ShellExit {
  serial: string;
  code: number;
}
```

> **设计决策**：
> - **基于块的读取**而非逐行读取：标准输出通过 `AsyncReadExt::read()` 以 8KB 块读取，自然地将高吞吐量输出（如 logcat）批量合并为更少的 IPC 事件，大幅降低开销。
> - **标准错误转发到终端**：并行的 tokio 任务以 4KB 块读取标准错误，并触发相同的 `shell_output` 事件。这确保错误消息（如 `sh: command: not found`，退出码 127）在终端中可见，而不是被静默丢弃。
> - **进程树终止**：在 Windows 上使用 `taskkill /F /T /PID` 终止整个进程树，而不仅仅是顶层 `adb.exe` 客户端。
> - **`kill_on_drop(true)`**：安全保障，在 tokio 任务 panic 或被中止时自动终止子进程。
> - **每设备一个流**：在同一设备上启动新流时自动停止前一个流，避免孤立进程。

#### 4.1.5 应用管理器

```rust
#[tauri::command]
async fn list_packages(serial: String) -> Result<Vec<PackageInfo>, String>
// 1. Runs `pm list packages -f` → all packages with APK paths
//    Output format: "package:/data/app/com.example-1/base.apk=com.example"
// 2. Runs `pm list packages -3` → third-party (non-system) package names
// 3. Cross-references the two lists: is_system = package NOT in third-party set
// 4. Returns sorted: user apps first, then system apps, both alphabetically

#[tauri::command]
async fn uninstall_package(serial: String, package: String, is_system: bool, is_root: bool) -> Result<String, String>
// Selects the appropriate uninstall method:
// - User app (!is_system):        `adb -s {serial} uninstall {package}`
// - System app + root:            `pm uninstall {package}`            (full permanent removal)
// - System app + no root:         `pm uninstall -k --user 0 {package}` (soft disable for current user)
// Returns combined stdout+stderr; errors on non-zero exit

#[tauri::command]
async fn install_apk(serial: String, apk_path: String) -> Result<(), String>
// Runs `adb -s {serial} install -r {apk_path}`
```

```typescript
interface PackageInfo {
  package_name: string;  // e.g. "com.android.settings"
  apk_path: string;      // e.g. "/system/app/Settings/Settings.apk"
  is_system: boolean;    // false = user-installed (third-party)
}
```

**前端**（`src/components/adb/AppManager.tsx`）：
- 固定工具栏：Install APK 按钮、搜索输入框、全部/用户/系统过滤器、刷新按钮 + 通过分页显示的条目数量
- 分页表格（默认 50 条/页，可选 20/50/100/200）——限制渲染的 DOM 节点数量，消除切换过滤器或输入时的卡顿
- `filteredPackages` 用 `useMemo([packages, filter, searchQuery])` 包裹以实现高效重计算
- 列：包名（等宽字体）、类型标签（橙色 = 系统，蓝色 = 用户）、APK 路径（省略号 + 提示框）、操作按钮
- **卸载/禁用按钮**：标签和 Popconfirm 文案根据应用类型和 root 状态自适应：
  - 用户应用 → "卸载" / "卸载 {pkg}?"
  - 系统应用 + root → "卸载" / "彻底移除系统应用 {pkg}？（root — 永久删除）"
  - 系统应用 + 无 root → "禁用" / "为当前用户禁用 {pkg}？（无 root — 软禁用）"
- **加载反馈**：安装和卸载操作均出现 `message.loading(…, 0)` 提示；完成后切换到成功/错误状态。Install APK 按钮在运行时也显示内联 spinner。

#### 4.1.6 屏幕镜像（scrcpy）

通过将 scrcpy 作为外部子进程启动来镜像和控制设备屏幕。每台设备获得独立的 scrcpy 窗口。scrcpy 通过 PATH 检测（不内置捆绑），以减小安装包大小。

```rust
// Process-global PID map for scrcpy instances, keyed by device serial
static SCRCPY_PROCESSES: Lazy<Mutex<HashMap<String, u32>>>

#[tauri::command]
async fn start_scrcpy(serial: String, config: ScrcpyConfig, app: AppHandle) -> Result<(), String>
// 1. Resolves scrcpy binary via scrcpy_path(): bundled → Scoop/Chocolatey → PATH
// 2. Kills any existing scrcpy for this serial (auto-stop previous)
// 3. Builds args from config: -s {serial}, --window-title, + all enabled flags
// 4. Spawns via tokio::process::Command with CREATE_NO_WINDOW
// 5. Stores PID in SCRCPY_PROCESSES; emits("scrcpy_state", { serial, running: true })
// 6. Background task awaits child.wait() → on exit, removes PID, emits running: false

#[tauri::command]
async fn stop_scrcpy(serial: String, app: AppHandle) -> Result<(), String>
// Removes PID, kills via taskkill /F /T /PID, emits running: false

#[tauri::command]
fn is_scrcpy_running(serial: String) -> bool
```

```typescript
interface ScrcpyConfig {
  maxSize?: number;        // --max-size
  videoBitrate?: string;   // --video-bit-rate (e.g. "8M")
  maxFps?: number;         // --max-fps
  stayAwake?: boolean;     // --stay-awake
  showTouches?: boolean;   // --show-touches
  borderless?: boolean;    // --window-borderless
  alwaysOnTop?: boolean;   // --always-on-top
  turnScreenOff?: boolean; // --turn-screen-off
  powerOffOnClose?: boolean; // --power-off-on-close
  crop?: string;           // --crop (e.g. "1224:1440:0:0")
  lockOrientation?: number; // --lock-video-orientation (0-3)
  recordPath?: string;     // --record <path>
  noAudio?: boolean;       // --no-audio
  keyboardMode?: string;   // --keyboard (uhid/sdk/aoa/disabled)
  mouseMode?: string;      // --mouse (uhid/sdk/aoa/disabled)
}
```

**自动清理**：`device.rs` 中的设备监控器检测到设备从 `adb devices` 中消失时，会自动为该序列号调用 `scrcpy::stop()`。这处理了意外断连（拔线、重启）的情况。

**前端**（`ScreenMirrorPanel.tsx`）：启动/停止按钮、可折叠设置面板（显示、窗口、设备、输入、录制各部分）、配置持久化到 `localStorage` 键 `"scrcpy_config"`。**远程控制面板**（方向键、Home/Back/Menu、音量+/音量-/电源）与设置并排渲染；每个按钮通过 `runShellCommand` 发送 `input keyevent <code>`。远程面板使用共享的 `RemoteControlPanel` 组件（`src/components/shared/RemoteControlPanel.tsx`）。

---

#### 4.1.7 OHOS 屏幕镜像

在应用内（无外部窗口）通过轮询截图循环镜像 OHOS 设备屏幕。

```rust
// Process-global session map keyed by connect_key
static SCREEN_SESSIONS: Lazy<Mutex<HashMap<String, Arc<AtomicBool>>>>

// start(): stops any existing session, inserts cancellation flag, spawns capture task
// Capture loop per iteration:
//   1. hdc -t {ck} shell snapshot_display -f /data/local/tmp/devbridge_screen.jpeg
//   2. hdc -t {ck} file recv <remote_path> <local_temp>
//   3. Read local file → base64-encode → emit("hdc_screen_frame", { connect_key, data })
//   4. Delete local temp file; sleep(intervalMs)
// Loop exits: cancelled flag set, or 5 consecutive snapshot/recv failures
// On exit: removes session entry, deletes temp files, emits hdc_screen_state { running: false }

// stop(): removes entry + sets flag (loop exits at next iteration)
// is_running(): synchronous map lookup
// kill_session(): best-effort stop called by device watcher on disconnect
```

```typescript
interface HdcScreenMirrorConfig { intervalMs: number } // 333–5000 ms, clamped in Rust

// Events
"hdc_screen_frame"  → ScreenFrame { connect_key, data }  // base64 JPEG per frame
"hdc_screen_state"  → HdcScreenMirrorState { connect_key, running }
```

**前端**（`HdcScreenMirrorPanel.tsx`）：启动/停止按钮、帧率计数器、截图间隔滑块（0.2–3 fps，持久化到 `localStorage` 键 `"hdc_screen_config"`）、应用内 JPEG 图像显示区域。**远程控制面板**（共享 `RemoteControlPanel` 组件）与图像并排渲染；按键通过 `runHdcShellCommand(connectKey, "input keyevent <code>")` 发送。

**共享组件**：`src/components/shared/RemoteControlPanel.tsx` — 被 ADB 和 OHOS 屏幕镜像面板复用。接受 `disabled: boolean` 和 `onSendKey: (keyCode: number) => Promise<void>` 属性。

### 4.2 串口模块

#### 4.2.1 串口管理

```rust
#[tauri::command]
fn list_serial_ports() -> Result<Vec<String>, String>
// Calls serialport::available_ports(), returns port names

#[tauri::command]
async fn open_serial_port(port_name: String, baud_rate: u32, app: AppHandle) -> Result<(), String>
// Opens the port, clones it for reading, stores original in OPEN_PORTS for writing
// Spawns a std::thread read loop that emits("serial_data", SerialDataEvent)
// Stores an AtomicBool stop flag in READER_FLAGS for clean shutdown

#[tauri::command]
async fn close_serial_port(port_name: String) -> Result<(), String>
// Sets stop flag, then removes port from OPEN_PORTS

#[tauri::command]
async fn write_serial(port_name: String, data: String) -> Result<(), String>
// Writes string data to the open port
```

```rust
// Internal structures
static OPEN_PORTS: Lazy<Mutex<HashMap<String, Box<dyn SerialPort + Send>>>>
static READER_FLAGS: Lazy<Mutex<HashMap<String, Arc<AtomicBool>>>>

#[derive(Clone, Serialize)]
struct SerialDataEvent {
    port: String,   // Port name (e.g. "COM3")
    data: String,   // Received text (UTF-8 lossy)
}

// Events emitted:
// "serial_data" -> SerialDataEvent    (incoming data from read loop)
// "serial_disconnected" -> String     (port name, on I/O error)
```

> **设计决策**：串口配置简化为仅 `port_name` + `baud_rate`。高级设置（数据位、停止位、奇偶校验、流控）延期实现——默认值（8N1，无流控）覆盖了绝大多数使用场景。串口读取循环使用原生 `std::thread`（而非 tokio `spawn_blocking`），因为 `serialport` 是阻塞 API，这避免了占用 tokio 工作线程。

#### 4.2.2 快捷命令面板与序列执行器

快捷命令完全由前端通过 Zustand store（`commandStore.ts`）管理，在 ADB 和串口设备之间共享。该面板作为可调整大小的右侧面板出现在 Shell 标签页内。

```typescript
interface QuickCommand {
  id: string;            // uuid
  label: string;         // Display label, e.g. "Reset"
  command: string;       // Payload to send, e.g. "AT+RST"
  sequenceOrder?: number; // undefined = excluded from sequence; 1,2,3… = run order
}
```

- **ADB 设备**：快捷命令通过 `startShellStream()` 执行——输出通过 `shell_output` 事件实时流式传输；设置 shell 运行状态以显示 Stop 按钮
- **串口设备**：快捷命令通过 `writeToPort(command + "\r\n")` 发送——响应通过 `serial_data` 事件异步到达

**序列执行器** — 命令列表下方的序列执行器区块允许循环执行设置了 `sequenceOrder` 的命令：
- 每台设备有**独立**的序列状态，存储在 `QuickCommandsPanel` 中逐设备的 ref 映射中
- 序列针对的设备在启动时捕获，因此将 UI 切换到另一台设备不会中断执行器
- 可配置间隔（默认 2 秒，最小 0.5 秒）分隔连续命令
- 序列命令的输出通过 `onOutput(text, deviceId)` 路由到发起设备的缓冲区，而非当前选中的设备
- 运行状态指示器和运行/停止按钮反映**当前选中**设备的序列状态，实现对每台设备执行器的独立控制

#### 4.2.3 Shell 日志工具

Shell 标签页的文件写入通过 Rust 后端命令完成（而非 `tauri-plugin-fs`），以避免前端权限限制：

```rust
#[tauri::command]
async fn write_text_file_to_path(path: String, content: String) -> Result<(), String>
// Creates or truncates a file and writes the given content (used for snapshot export
// and to initialise a new log-to-file session)

#[tauri::command]
async fn append_text_to_file(path: String, content: String) -> Result<(), String>
// Opens the file in append mode and writes content (used for continuous log-to-file)
```

**快照导出**：通过 `save()` 对话框 + `write_text_file_to_path` 将当前输出缓冲区保存到用户选择的文件。

**写入文件**：逐设备开关；激活后，每次调用 `writeToDeviceBuffer` 都会将传入的文本追加到该设备的日志文件——包括在后台运行的设备在选中另一设备时收到的数据。

### 4.3 统一设备模型

ADB 和串口设备均在单个 `deviceStore`（Zustand）中跟踪。侧边栏在一个列表中渲染所有设备，所选设备决定 Shell 标签页使用哪个后端路径。

```typescript
interface ConnectedDevice {
  id: string;
  type: "adb" | "serial";
  name: string;
  serial: string;       // ADB serial or COM port name
  state: string;
  model?: string;
  product?: string;
  isRoot?: boolean;     // ADB only — reflects is_root from AdbDevice
  isRemounted?: boolean;// ADB only — reflects is_remounted from AdbDevice
}
```

- ADB 设备通过 `adb_device_watcher` 后台任务自动同步
- 串口设备通过 ConnectModal 对话框手动添加/移除
- 收到 `serial_disconnected` 事件时，设备自动从 store 中移除

---

## 5. 数据设计

### 5.1 持久化配置

通过 Zustand 的 `persist` 中间件存储在 WebView 的 `localStorage` 中。使用两个键：

**`bridge-config`** — 应用全局设置（`configStore.ts`）：

```jsonc
{
  "theme": "snow",           // ThemeId: snow | dark | rose | arctic | violet | nord
  "adbPath": "",             // Custom adb binary path (empty = use bundled)
  "autoConnect": true,
  "shellMaxLines": 5000,     // Output buffer limit per device (0 = unlimited)
  "logcatMaxLines": 5000,    // Logcat display buffer limit (0 = unlimited)
  // Last-used Connect Device values (pre-filled on next open)
  "adbHost": "192.168.1.100",
  "adbPort": 5555,
  "ohosHost": "192.168.1.100",
  "ohosPort": 5555,
  "telnetHost": "192.168.1.100",
  "telnetPort": 23,
  "baudRate": 115200,
  // Background image
  "bgImagePath": null,       // Absolute path to stored image in app-data dir (null = none)
  "bgOpacity": 0.5           // 0.0–1.0
}
```

**`bridge-devices`** — 设备自定义名称（`deviceStore.ts`；仅持久化 `customNames`）：

```jsonc
{
  "customNames": {
    "192.168.1.50:5555": "My Phone",
    "COM3": "ESP32 Dev Board"
  }
}
```

自定义名称以设备序列号/连接键为键，在启动时检测到设备时自动应用。

---

## 6. UI 布局设计

### 6.1 整体布局

```
┌─────────────────────────────────────────────────────────────────┐
│ [▪] Bridge   ················drag region·····················  [–] [□] [✕]│  TitleBar (36px, frameless)
├──────────────────┬──────────────────────────────────────────────┤
│                  │  (main area — content depends on selection)  │
│  Left Sidebar    │ ──────────────────────────────────────────── │
│  [↺] [+]         │                                              │
│  Unified Device  │   No device selected  →  Welcome Page        │
│  List            │   ADB device selected →  Shell / Logcat /    │
│  ┌────────────┐  │                          File Manager / Apps  │
│  │ 📱 Dev-1   │  │   OHOS device selected →  Shell / HiLog /   │
│  │ 📱 emu-1   │  │                  Screen Mirror / File Manager / Apps  │
│  │ ○ COM3     │  │   Serial device selected → Shell only        │
│  │ ○ COM7     │  │                                              │
│  └────────────┘  │                                              │
│                  │                                              │
│  [⚙ Settings]    │                                              │
├──────────────────┴──────────────────────────────────────────────┤
│  Status Bar: Device Count | Connection Status  Active: <name>   │
└─────────────────────────────────────────────────────────────────┘
```

窗口使用 **`decorations: false`**（无边框）加 `shadow: true`。自定义 `TitleBar` 组件横跨整个窗口宽度，提供：
- 左侧：16 px 应用图标 + "Bridge" 文字
- 中间：`data-tauri-drag-region` 占位元素（完全可拖动——无交互元素）
- 右侧：标准窗口控制按钮（最小化/最大化还原/关闭），Windows 规范悬停颜色

活动设备名称（含型号）显示在**底部 StatusBar** 的右侧而非标题栏，保持拖动区域不受遮挡。

**主区域渲染逻辑**（`App.tsx`）：
- `selectedDevice === null` → 仅渲染 `<WelcomePage />`
- ADB 标签页容器和串口标签页容器在该类型设备连接后**始终挂载**。不活动的容器用 `display: none` 隐藏——永不卸载。
- 每个 `<Tabs>` 上的 `destroyOnHidden={false}` 使各标签页面板（Shell、Logcat、文件、应用）在标签切换时保持存活。

这确保所有 shell 输出缓冲区、logcat 条目和文件列表在设备类型切换时得以保留，无需全局 store。

### 6.1.1 欢迎页面（`WelcomePage.tsx`）

无设备选中时显示。在内容区域内垂直和水平居中（固定 560 px 内列）。

```
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│                        [App Icon 96px]                           │
│                    Device Debugging Toolkit                      │
│                                                                  │
│   ┌─────────────────┐ ┌──────────────────┐ ┌─────────────────┐  │
│   │  ADB Devices    │ │  OHOS Devices    │ │ Serial / Telnet │  │
│   │  • Shell        │ │  • Shell         │ │  • Shell        │  │
│   │  • Logcat       │ │  • HiLog         │ │                 │  │
│   │  • Screen Mirror│ │  • Screen Mirror │ │                 │  │
│   │  • File Manager │ │  • File Manager  │ │                 │  │
│   │  • App Manager  │ │  • App Manager   │ │                 │  │
│   └─────────────────┘ └──────────────────┘ └─────────────────┘  │
│                                                                  │
│           Click + in the sidebar to connect a device.            │
└──────────────────────────────────────────────────────────────────┘
```

### 6.2 Shell 标签页布局（ADB + 串口统一）

```
┌──────────────────────────────────────────┬──────────────────────────────┐
│ ● adb shell — Pixel 7     [⚙] [🗑 Clear]│    Quick Command Panel       │
├──────────────────────────────────────────│                              │
│  Connected to Pixel 7                    │  ┌────────────────────────┐  │
│  Type a command below.                   │  │ Reset     [▶] [✕]      │  │
│                                          │  │ AT+RST                 │  │
│  $ logcat                                │  ├────────────────────────┤  │
│  01-15 10:23:45.123  1234  5678 D Tag:…  │  │ Version   [▶] [✕]      │  │
│  01-15 10:23:45.456  1234  5678 I Tag:…  │  │ AT+GMR                 │  │
│  01-15 10:23:45.789  1234  5678 W Tag:…  │  └────────────────────────┘  │
│  (streaming output...)                   │                              │
│                                          │  ┌────────────────────────┐  │
│  ┌─ Settings (collapsible) ──────────┐   │  │ Label: [____________]  │  │
│  │ Max lines [5000▾]  0=unlimited    │   │  │ Cmd:   [____________]  │  │
│  └───────────────────────────────────┘   │  │ [+ Add Command]        │  │
│──────────────────────────────────────────│  └────────────────────────┘  │
│ $ [______________________________] [Stop]│                              │
└──────────────────────────────────────────┴──────────────────────────────┘
```

**执行模型：**
- **ADB 设备**：前缀 `$`。所有命令通过 `startShellStream()` 执行——输出通过 `shell_output` 事件实时流式传输。命令运行时出现 **Stop** 按钮，调用 `stopShellStream()` 终止命令。
- **串口设备**：前缀 `>`。命令通过 `writeToPort()` 发送，响应通过 `serial_data` 事件异步到达并追加到输出区域。
- 面板通过 `react-resizable-panels` 可调整大小（默认 70/30 分割）。

**逐设备状态：**
- 输出、输入文本和运行状态均通过 ref 映射逐设备跟踪。设备间切换时，每台设备的 shell 会话独立保留。
- 快捷命令也会为 ADB 触发 `startShellStream()`，并正确设置运行状态以显示 Stop 按钮。

**标题栏控制：**
- **导出快照**（下载图标）：将当前设备的完整输出缓冲区保存到用户选择的 `.txt` 文件。
- **写入文件**（文件添加图标，激活时变红）：打开保存对话框，开始持续将所有传入数据追加到所选文件。该开关**逐设备**独立——设备 A 的日志记录在选中设备 B 时不受影响。仅在关闭开关或设备断连时停止。
- **设置开关**（齿轮图标）：显示内联的 `最大行数` 设置（默认 5000，范围 0–100000，0 = 不限制）。输出缓冲区被修剪到此限制，防止无限日志积累导致 DOM 卡顿。
- **清除按钮**（垃圾桶图标）：立即清除当前设备的输出缓冲区。

**逐设备输出管理**（`ShellPanel`）：
- `outputMap`、`inputMap`、`runningMap` 和 `logFileMap` 均为 `useRef<Record<string, …>>` 映射，以设备 ID 为键，同时为**所有**已连接设备累积状态。
- 中央辅助函数 `writeToDeviceBuffer(deviceId, text)` 在一处处理缓冲区累积、`requestAnimationFrame` 刷新调度和日志文件追加。
- 快捷命令序列执行器的输出通过 `onOutput(text, deviceId)` 路由，将数据定向到发起设备的缓冲区，无论当前显示的是哪台设备。

**性能优化：**
- ADB 后端以 8KB 块读取标准输出；串口后端以 1024 字节块读取，超时 100 毫秒。两者自然地将输出批量合并为更少的 IPC 事件。
- 前端使用基于 `requestAnimationFrame` 的渲染批处理（`scheduleFlush`）——单帧内的多个数据事件合并为一次 React 状态更新（最高约 60 fps）。
- 未选中的设备从不触发 React 重渲染；数据静默累积，直到该设备被选中。

### 6.3 Logcat 标签页布局

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [Logcat▾] [All▾] [ Filter (tag or message)  .*  Aa  ab ] [▶Start] [🗑] [⬆]  │
│                                                           Max [5000▾] 1234 ln│
├──────────────────────────────────────────────────────────────────────────────┤
│ 01-15 10:23:45.123 1234 5678 V/Tag: verbose message                          │
│ 01-15 10:23:45.456 1234 5678 D/Tag: debug message                            │
│ 01-15 10:23:45.789 1234 5678 I/Tag: info message                             │
│ 01-15 10:23:45.012 1234 5678 W/Tag: warning message                          │
│ 01-15 10:23:45.345 1234 5678 E/Tag: error message           ▓ (scrollbar)    │
│ (streaming output...)                                                         │
│                                                                               │
│                                                    [↓ Bottom]  (when paused) │
└──────────────────────────────────────────────────────────────────────────────┘
```

**工具栏控制（从左到右）：**
- **模式选择器**：`Logcat` / `tlogcat` — 每种模式**独立**运行；切换模式不会停止另一种模式。该模式正在收集时，标签标签上出现绿色圆点。如果两种模式都已启动，则同时在各自缓冲区中累积。
- **级别下拉菜单**：`All` / `Verbose` / `Debug` / `Info` / `Warn` / `Error` / `Fatal`。`All`（默认）显示所有级别，不过滤。
- **统一过滤输入框**：单个文本框，带三个 VS Code 风格的切换按钮：
  - `.*` — 正则表达式模式
  - `Aa` — 区分大小写匹配
  - `ab` — 全词匹配（`\b` 边界）
  - 同时对 tag 和 message 进行匹配过滤。
- **启动/停止按钮**：仅启动或停止**当前显示**模式的流；另一种模式不受影响。如果后端进程意外退出（如设备上找不到 tlogcat），运行指示器自动重置并显示警告通知。
- **清除按钮**：清除当前模式的应用内显示缓冲区。在 logcat 模式下，还运行 `adb logcat -c` 以清空设备上的环形缓冲区，使下次启动从干净状态开始。在 tlogcat 模式下，仅清除显示。
- **导出按钮**：仅将当前过滤和可见的条目导出到 `.txt` 文件。
- **最大行数输入框**：始终可见的缓冲区限制（默认 5000，0 = 不限制）。旁边显示条目数量。
- **底部按钮**：用户向上滚动查看历史记录时出现；点击恢复自动滚动并刷新缓冲数据。

**渲染模型：**
- 日志行通过对内层内容 `<div>` 直接赋值 `innerHTML` 渲染为单个 HTML 字符串，绕过 React 虚拟 DOM 以实现高吞吐量。
- 颜色通过 CSS 类（`.log-v`、`.log-d`、`.log-i`、`.log-w`、`.log-e`）而非逐元素内联样式应用。
- 用户向上滚动（自动滚动暂停）时，DOM 更新完全暂停——新数据在内存缓冲区中累积而不触及 DOM，允许不间断滚动。恢复后，缓冲区一次性刷新。
- 级别过滤同时在客户端（用于显示和导出）和服务端（传递给 `start_logcat` 后端命令）应用。

### 6.4 文件管理器标签页布局

```
┌──────────────────────────────────────────────────────────────────────┐
│  / sdcard/ DCIM/                    ← clickable path segments        │
│  [Upload] [Download (N)] [Delete (N)] [Refresh] [🔍 Filter by name…] │
│                                              [no root] [not remounted]│
├──────────────────────────────────────────────────────────────────────┤
│  Name            Size      Modified           Permissions      ▲     │
│  📁 Camera       -         2024-01-01         rwxr-xr-x              │
│  📁 Screenshots  -         2024-01-02         rwxr-xr-x        │     │
│  📄 photo.jpg    3.2 MB    2024-01-03         rw-r--r--        │     │
│  📄 video.mp4    120 MB    2024-01-04         rw-r--r--        ▼     │
└──────────────────────────────────────────────────────────────────────┘
```

**布局行为：**
- 路径栏和工具栏为**固定**——在文件列表独立滚动时固定在顶部。
- 路径栏将每个路径段渲染为可点击的 `Typography.Link`（如 `/ sdcard/ DCIM/`）；点击任意段直接导航到该路径并清除过滤器。
- **过滤输入框**（工具栏最右侧）对当前目录中的文件/目录名进行不区分大小写的子字符串匹配（不递归子目录）。目录导航时自动清除。
- **root/remount 状态标签**（`no root` / `root`，`not remounted` / `remounted`）显示在工具栏行右侧，反映自动检测的 root/remount 状态。颜色：灰色 = 未激活，金色 = root 已激活，蓝色 = 已挂载。提示框解释每种状态。

**查看（Cat）模态框 — 选中文件后点击 View 触发：**
```
┌─ filename ──────────────────────────────────────────────────────┐
│  ○ Text  ○ Hex(xxd)   Limit: [ 8 ] KB                          │
│  Auto-refresh: [off]  Every [ 2 ] s                             │
├─────────────────────────────────────────────────────────────────┤
│  Linux version 5.10.157 (build@host) (gcc version 12.x) ...    │
│                                                                  │
│                   [monospace scrollable, 420px]                  │
├─────────────────────────────────────────────────────────────────┤
│  127 chars · 09:42:01                    [Copy] [Refresh] [Close]│
└─────────────────────────────────────────────────────────────────┘
```

### 6.5 应用标签页布局

```
┌──────────────────────────────────────────────────────────────────────┐
│  [Install APK]  [🔍 Search packages…]  ● All  ○ User  ○ System  [↻] │
├──────────────────────────────────────────────────────────────────────┤
│  Package Name                   Type     APK Path              Action│
│  com.android.settings           system   /system/app/Set…   [Disable]│
│  com.google.android.gms         system   /data/app/com.g…   [Disable]│
│  com.example.myapp              user     /data/app/com.e… [Uninstall]│
│  com.example.anotherapp         user     /data/app/com.e… [Uninstall]│
│                                                                       │
│  < 1 2 3 … >   50/page ▾   1234 packages             (pagination bar)│
└──────────────────────────────────────────────────────────────────────┘
```

**行为：**
- 过滤标签（全部/用户/系统）和搜索框实时过滤包列表。`filteredPackages` 已记忆化；任何过滤/搜索变化时 `currentPage` 重置为 1。
- 分页受控（默认 50 条/页）；选项：20、50、100、200。分页栏显示总数。
- 卸载/禁用按钮标签和确认文案取决于应用类型和 root 状态（见 §4.1.5）。
- 安装 APK：打开过滤 `.apk` 的文件选择器；传输期间按钮显示内联 spinner 和通知提示；成功后列表重新加载。

---

## 7. 技术栈

### 7.1 依赖项概览

#### Rust 后端

| Crate | 版本 | 用途 |
|-------|------|------|
| `tauri` | 2.x | 应用框架、IPC、窗口管理 |
| `tokio` | 1.x | 异步运行时 |
| `serialport` | 4.x | 串口通信 |
| `serde` / `serde_json` | 1.x | 数据序列化 |
| `once_cell` | 1.x | 全局静态状态（`Lazy<Mutex<...>>`） |
| `uuid` | 1.x | 生成快捷命令 ID |
| `tauri-plugin-store` | 2.x | 配置持久化 |
| `tauri-plugin-dialog` | 2.x | 文件选择对话框 |
| `tauri-plugin-fs` | 2.x | 文件系统访问 |
| `tauri-plugin-shell` | 2.x | 生成外部进程（adb） |

#### 前端

| 包 | 用途 |
|----|------|
| `react` + `typescript` | UI 框架 |
| `antd` | UI 组件库（亮色主题配暗色终端） |
| `@ant-design/icons` | 图标集 |
| `zustand` | 状态管理 |
| `react-resizable-panels` | 可拖动分割面板 |
| `@tauri-apps/api` | Tauri 前端 API |

> **注意**：xterm.js 和 @dnd-kit/core 最初在计划中但目前未使用。Shell 标签页使用普通 `<div>` 输出，标准 `<Input>` 命令输入。这些库可能在高级功能（HEX 模式、拖放排序命令）中重新引入。

### 7.2 ADB 分发策略

将 `adb.exe`、`AdbWinApi.dll` 和 `AdbWinUsbApi.dll` 捆绑在应用的 `resources/` 目录中。启动时，应用解析 adb 路径，默认使用捆绑版本。如果用户希望使用自己的 platform-tools 安装，可以在设置中通过自定义路径覆盖。

---

## 8. 开发计划

### 第一阶段 — 基础建设（第 1–2 周）

- [x] 初始化 Tauri 项目并配置开发环境
- [x] 构建基础前端布局（侧边栏 + 标签页主区域 + 状态栏）
- [x] 实现 ADB 设备扫描和热插拔检测
- [x] 渲染统一设备列表（ADB + 串口在同一侧边栏）

### 第二阶段 — ADB 核心功能（第 3–4 周）

- [x] 文件系统浏览（解析 `ls` 输出，渲染文件列表）
- [x] 文件上传/下载（单文件 + 进度条）
- [x] 批量文件传输 + 传输队列 UI
- [x] 实时 logcat 显示 + Tag/Level 过滤
- [x] 日志导出
- [x] Shell 标签页中的 ADB shell 命令执行（流式传输含停止/清除，逐设备状态）

### 第三阶段 — 串口功能（第 5–6 周）

- [x] 端口扫描和连接配置 UI（ConnectModal）
- [x] 串口读取循环，带后台线程 + 事件触发
- [x] 串口写入接入 Shell 标签页输入
- [x] 快捷命令面板对 ADB 和串口均有效
- [x] 自动断连检测（`serial_disconnected` 事件）
- [x] COM 端口列表按数字排序（COM3 < COM10）；打开对话框时刷新端口列表
- [x] 序列执行器：逐设备循环执行有序快捷命令，间隔可配置
- [x] Shell 日志导出（快照）和持续写入文件开关（逐设备，独立）
- [ ] HEX / ASCII 显示模式切换
- [ ] 可配置行结束符（`\r\n` / `\r` / `\n` / 无）
- [ ] 快捷命令拖放排序
- [ ] 定时自动发送功能

### 第四阶段 — 打磨与打包（第 7–8 周）

- [x] 应用管理器标签页：列出包（用户 + 系统）、安装 APK、卸载/禁用
- [x] Shell 标准错误转发到终端输出（命令未找到的错误现在可见）
- [x] 主区域自适应上下文：欢迎页面、ADB 标签页、串口仅 Shell 标签页
- [x] 始终挂载的标签页容器（display:none）——shell/logcat 状态在设备类型切换时保留
- [x] ShellPanel 中逐设备输出缓冲区和写入文件状态（切换设备不会丢失数据）
- [x] 通过 Rust 后端命令进行文件写入/追加（避免 tauri-plugin-fs 作用域限制）
- [x] 6 主题系统（Snow、Dark Modern、Rose、Arctic、Violet、Nord），含设置抽屉和实时主题切换
- [x] 所有 UI 颜色由 CSS 自定义属性驱动——卡片、日志、文件行、终端、模态框、滚动条
- [x] 刷新按钮移至侧边栏（始终可见）；标题栏中间为纯拖动区域
- [x] 活动设备名称 + 型号显示在 StatusBar 右下角
- [x] 通过 Zustand `persist` 中间件（localStorage）持久化配置：主题、连接默认值、shell/logcat 限制、背景图片路径 + 透明度
- [x] 自定义设备名称跨重启持久化（以序列号为键存储在 `bridge-devices` localStorage 条目中）
- [x] 启动闪屏：全视口图标叠加层，带弹簧动画；首次 React 渲染前背景色与已保存主题匹配；首次渲染后淡出
- [x] 自定义背景图片：选择图片 → 复制到应用数据目录 → 以 base64 data URL 显示；可调透明度（0–100%，默认 50%）；隔离的 BgLayer 组件防止拖动滑块时触发 App 重渲染
- [ ] 将 adb.exe 捆绑到安装包
- [ ] 网络 ADB 连接
- [ ] 错误处理和自动重连
- [ ] 构建安装包（NSIS / MSI）

---

## 9. 目录结构

```
Bridge/
├── src-tauri/                  # Rust backend
│   ├── src/
│   │   ├── main.rs             # Entry point
│   │   ├── lib.rs              # Command registration, plugin setup, background tasks
│   │   ├── adb/
│   │   │   ├── mod.rs
│   │   │   ├── device.rs       # Device scanning, hot-plug watcher
│   │   │   ├── file.rs         # File manager commands (push/pull/delete)
│   │   │   ├── logcat.rs       # Streaming logcat reader
│   │   │   ├── apps.rs         # App manager: list packages, install/uninstall
│   │   │   ├── scrcpy.rs      # Screen mirror: scrcpy process management and config
│   │   │   └── commands.rs     # Shell stream, install APK, adb_path() resolver
│   │   ├── hdc/
│   │   │   ├── mod.rs
│   │   │   ├── device.rs       # OHOS device scanning, hdc watcher, remount
│   │   │   ├── file.rs         # File manager commands (send/recv/delete)
│   │   │   ├── hilog.rs        # HiLog + tlogcat streaming reader
│   │   │   ├── apps.rs         # App manager: list bundles, install HAP, uninstall
│   │   │   ├── screen.rs       # Screen mirror: capture loop, hdc_screen_frame/hdc_screen_state events
│   │   │   └── commands.rs     # Shell stream, run_hdc_shell_command, hdc_path() resolver
│   │   ├── serial/
│   │   │   ├── mod.rs
│   │   │   └── manager.rs      # Port open/close/write, read loop thread, event emission
│   │   ├── util.rs             # cmd() helper: wraps Command with CREATE_NO_WINDOW on Windows
│   │   └── config.rs           # Config struct definitions
│   ├── capabilities/           # Tauri capability permissions
│   ├── resources/
│   │   └── adb/                # Bundled adb tools
│   │       ├── adb.exe
│   │       ├── AdbWinApi.dll
│   │       └── AdbWinUsbApi.dll
│   ├── Cargo.toml
│   └── tauri.conf.json
│
├── src/                        # React frontend
│   ├── main.tsx                # Entry point
│   ├── App.tsx                 # Root component: Layout + context-adaptive main area + hooks
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Sidebar.tsx     # Left sidebar: unified device list (ADB + serial)
│   │   │   ├── TitleBar.tsx    # Frameless custom titlebar: full drag region, window controls
│   │   │   ├── StatusBar.tsx   # Bottom status bar
│   │   │   ├── ConnectModal.tsx  # Dialog for serial/network ADB/OHOS connection (host/port/baud persisted)
│   │   │   ├── SettingsPanel.tsx # Settings drawer: theme picker + background image + opacity
│   │   │   └── WelcomePage.tsx   # Welcome screen (shown when no device is selected)
│   │   ├── adb/
│   │   │   ├── FileManager.tsx
│   │   │   ├── CatModal.tsx        # View (cat) modal: text/hex, size limit, auto-refresh
│   │   │   ├── LogcatPanel.tsx
│   │   │   ├── AppManager.tsx      # App Manager tab: package list, install, uninstall/disable
│   │   │   ├── ScreenMirrorPanel.tsx  # Screen Mirror tab: scrcpy launch, settings, remote control
│   │   │   └── TransferQueue.tsx
│   │   ├── hdc/
│   │   │   ├── HdcFileManager.tsx
│   │   │   ├── HdcCatModal.tsx
│   │   │   ├── HilogPanel.tsx
│   │   │   ├── HdcAppManager.tsx
│   │   │   └── HdcScreenMirrorPanel.tsx  # Screen Mirror tab: in-app JPEG, remote control
│   │   ├── shared/
│   │   │   ├── UploadModal.tsx          # Reusable upload dialog with drag-drop
│   │   │   └── RemoteControlPanel.tsx   # D-pad + key remote, used by both screen mirror panels
│   │   └── shell/              # Unified shell for ADB + serial
│   │       ├── ShellPanel.tsx          # Terminal output + input, serial data subscription
│   │       └── QuickCommandsPanel.tsx  # Quick command list, add/delete, send to device
│   ├── store/
│   │   ├── deviceStore.ts      # zustand — unified device state (ADB + OHOS + serial)
│   │   ├── commandStore.ts     # zustand — quick command list
│   │   ├── serialStore.ts      # zustand — serial port state
│   │   └── configStore.ts      # zustand — app config
│   ├── hooks/
│   │   ├── useAdbEvents.ts     # ADB device events, scrcpy state
│   │   ├── useHdcEvents.ts     # OHOS device events, hilog, screen mirror state/frames
│   │   ├── useSerialEvents.ts  # useSerialData() + useSerialDisconnect() hooks
│   │   └── useShellEvents.ts   # useShellOutput() + useShellExit() hooks for streaming shell
│   ├── utils/
│   │   ├── adb.ts              # invoke wrappers for ADB commands
│   │   ├── hdc.ts              # invoke wrappers for OHOS/HDC commands
│   │   ├── serial.ts           # invoke wrappers for serial commands
│   │   ├── fs.ts               # invoke wrappers for file write/append (backend-side, avoids plugin-fs scope limits)
│   │   └── background.ts       # invoke wrappers for background image save/load/remove
│   ├── types/
│   │   ├── adb.ts              # AdbDevice, ScrcpyConfig, ScrcpyState
│   │   ├── hdc.ts              # OhosDevice, HilogEntry, BundleInfo, ScreenFrame, HdcScreenMirrorState
│   │   └── device.ts           # ConnectedDevice interface (unified ADB + OHOS + serial)
│   └── styles.css              # Global styles
│
├── CLAUDE.md                   # Claude Code project instructions
├── package.json
└── vite.config.ts
```

---

*本文档为持续更新的设计参考，将随各模块的实现进行更新。*
