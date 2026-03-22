# OHOS 模块 — API 参考

> **项目**: Bridge
> **模块**: OHOS / HDC (`src-tauri/src/hdc/`, `src/utils/hdc.ts`)
> **最后更新**: 2026-03 (v0.3.1)

本文档是 OHOS 模块的完整 API 参考，涵盖所有向前端暴露的 Tauri 命令、所有后端到前端的事件，以及全部共享数据类型。未通过 IPC 暴露的 Rust 内部辅助函数不在本文档列出范围之内。

---

## 目录

1. [IPC 机制](#1-ipc-机制)
2. [数据类型](#2-数据类型)
3. [命令 — 设备管理](#3-命令--设备管理)
4. [命令 — 文件管理器](#4-命令--文件管理器)
5. [命令 — Shell](#5-命令--shell)
6. [命令 — HiLog](#6-命令--hilog)
7. [命令 — 应用管理器](#7-命令--应用管理器)
8. [命令 — 屏幕镜像](#8-命令--屏幕镜像)
9. [事件（后端 → 前端）](#9-事件后端--前端)
10. [前端工具函数封装](#10-前端工具函数封装)
11. [错误处理](#11-错误处理)
12. [HDC 工具路径解析](#12-hdc-工具路径解析)

---

## 1. IPC 机制

所有 OHOS 命令遵循与 ADB 模块相同的 Tauri IPC 模式：

- **前端 → 后端**：`invoke("command_name", { ...args })` — 返回一个 `Promise`，成功时解析为返回值，失败时以错误字符串拒绝。
- **后端 → 前端**：`app.emit("event_name", payload)` — 通过 `listen()` 订阅的推送事件。

所有命令在 Rust 侧均为 `async`（基于 tokio），返回 `Result<T, String>`。错误变体始终携带人类可读的消息。

OHOS 模块使用与 ADB 模块不同的事件名称（以 `hdc_` 为前缀），以便两个模块可以同时运行而不会发生事件冲突。

---

## 2. 数据类型

### `OhosDevice`

表示一个已连接的 OHOS 设备。由 `get_ohos_devices` 返回，并在 `hdc_devices_changed` 事件中发出。

```typescript
interface OhosDevice {
  connect_key: string;   // 设备标识符：序列号（USB）或 "IP:port"（TCP）
  conn_type: string;     // "USB" | "TCP"
  state: string;         // "Connected" | "Offline" | "Unauthorized"
  name: string;          // hdc 上报的主机名（通常为 "localhost"）
  is_remounted: boolean; // 若本次会话中 `hdc target mount` 成功则为 true
  remount_info: string;  // 重新挂载尝试的输出；空字符串表示尝试仍在进行中
}
```

```rust
pub struct OhosDevice {
    pub connect_key: String,
    pub conn_type: String,
    pub state: String,
    pub name: String,
    pub is_remounted: bool,
    pub remount_info: String,
}
```

**说明：**
- `is_remounted` 和 `remount_info` 在设备首次连接时自动确定（参见[设备监听器](#设备监听器)）。它们缓存在 `DEVICE_REMOUNT_STATUS` 中，并合并到每次后续的 `list_devices()` 调用结果中。
- 当重新挂载尝试仍在运行时，`is_remounted` 为 `false`，`remount_info` 为空字符串。此状态下 UI 显示 `"checking..."`。
- 成功检测会检查 `hdc target mount` 的 stdout+stderr 合并输出中是否存在失败标记（`[Fail]`、`not user mountable`、`Operation not permitted`、`debug mode`），同时结合退出码判断，因为某些固件在退出码为 0 时也可能输出错误信息。

---

### `FileEntry`

表示由 `list_hdc_files` 返回的单个文件或目录条目。其结构与 ADB 模块的 `FileEntry` 完全相同。

```typescript
interface FileEntry {
  name: string;        // 文件/目录显示名称
  path: string;        // 设备上的完整绝对路径
  is_dir: boolean;     // 目录为 true
  size: number;        // 文件大小（字节），目录为 0
  permissions: string; // Unix 权限字符串，例如 "drwxrwxr-x"
  modified: string;    // 最后修改时间戳，例如 "2024-01-15 10:30"
}
```

---

### `HilogEntry`

表示一条已解析的 HiLog 日志行。用于 `HilogBatch` 载荷及 `export_hilog`。

```typescript
interface HilogEntry {
  timestamp: string; // "MM-DD HH:MM:SS.mmm"
  pid: string;       // 进程 ID 字符串
  tid: string;       // 线程 ID 字符串
  level: string;     // "D" | "I" | "W" | "E" | "F"
  tag: string;       // "DOMAIN/Tag" 格式，例如 "A03200/testTag"
  message: string;   // 日志消息正文
}
```

---

### `HilogBatch`

由 `hilog_lines` 事件发出的包装类型。将一批日志条目与产生它们的设备关联。

```typescript
interface HilogBatch {
  connect_key: string;     // 本批次所属设备的 connect_key
  entries: HilogEntry[];   // 1 至 64 条已解析的日志条目
}
```

---

### `HilogFilter`

`start_hilog` 的输入参数。所有字段均为可选 — `null` 表示在该维度上不进行过滤。

```typescript
interface HilogFilter {
  level: string | null;   // 最低级别阈值："D"|"I"|"W"|"E"|"F"，null 表示全部
  keyword: string | null; // 对 tag 和 message 进行子字符串匹配；null 表示不过滤
}
```

**说明：**
- `level` 过滤为阈值模式：`"W"` 允许 W、E、F 通过，拒绝 D 和 I。
- 关键词过滤不区分大小写，在解析前对原始日志行全文应用。
- 与 ADB logcat 不同，HiLog 没有 `"V"`（Verbose）级别。

---

### `HilogExit`

`hilog_exit` 事件的载荷。在 HiLog 或 tlogcat 进程退出时发出。

```typescript
interface HilogExit {
  connect_key: string; // 设备 connect_key
  mode: string;        // "hilog" 或 "tlogcat"
  code: number | null; // 进程退出码；无法确定时为 null
}
```

---

### `BundleInfo`

由 `list_bundles` 返回，表示一个已安装的 HAP 应用包。

```typescript
interface BundleInfo {
  bundle_name: string;                             // 例如 "com.huawei.hmos.browser"
  code_path: string;                               // 实际 HAP 文件路径，例如 "/system/app/Browser/HuaweiBrowser.hap"
                                                   // 若路径无法解析则为空字符串
  app_type: "user" | "system" | "vendor" | "product"; // 根据 isSystemApp + hapPath 前缀推导
}
```

**应用类型分类：**

| `isSystemApp` | `hapPath` 前缀 | `app_type` |
|---------------|-----------------|------------|
| `false` | 任意 | `"user"` |
| `true` | `/sys_prod/`、`/cust/` | `"product"` |
| `true` | `/vendor/`、`/chipset/` | `"vendor"` |
| `true` | `/system/`、`/data/`（预装）或无法识别 | `"system"` |

**说明：**
- `code_path` 从 `bm dump -n` JSON 输出中第一个非空的 `"hapPath"` 字段获取，**而非**来自 `"codePath"`（后者始终指向 `/data/app/` 下的运行时数据目录，无论应用类型如何）。
- 分类以 JSON 输出中的 `"isSystemApp"` 字段作为主要依据；`hapPath` 前缀用于在系统应用内进一步区分 `"product"` 与 `"vendor"` 和 `"system"`。
- `/sys_prod/` 是 OEM 产品定制分区（等同于 Android 的 `/product/`），与硬件供应商分区（`/vendor/`、`/chipset/`）不同。

---

### `HdcScreenMirrorConfig`

`start_hdc_screen_mirror` 的输入参数。

```typescript
interface HdcScreenMirrorConfig {
  intervalMs: number; // 捕获间隔，单位毫秒（限制在 333–5000 ms 范围内）
}
```

```rust
pub struct ScreenMirrorConfig {
    pub interval_ms: u64, // 通过 #[serde(rename_all = "camelCase")] 在 JSON 中使用驼峰命名
}
```

---

### `ScreenFrame`

`hdc_screen_frame` 事件的载荷。携带一帧捕获的 JPEG 图像。

```typescript
interface ScreenFrame {
  connect_key: string; // 本帧所属设备的 connect_key
  data: string;        // Base64 编码的 JPEG 图像
}
```

---

### `HdcScreenMirrorState`

`hdc_screen_state` 事件的载荷。

```typescript
interface HdcScreenMirrorState {
  connect_key: string; // 设备 connect_key
  running: boolean;    // true = 镜像激活中，false = 已停止/已退出
}
```

---

### `HdcShellOutput`

`hdc_shell_output` 事件的载荷。

```typescript
interface HdcShellOutput {
  connect_key: string; // 本输出所属设备的 connect_key
  data: string;        // 原始文本块（stdout，UTF-8 宽松解码）
}
```

---

### `HdcShellExit`

`hdc_shell_exit` 事件的载荷。

```typescript
interface HdcShellExit {
  connect_key: string; // 设备 connect_key
  code: number;        // 进程退出码；无法确定时为 -1
}
```

---

## 3. 命令 — 设备管理

**源文件**：`src-tauri/src/hdc/device.rs`

---

### `get_ohos_devices`

返回当前已连接 OHOS 设备的列表。

```typescript
invoke("get_ohos_devices"): Promise<OhosDevice[]>
```

```typescript
// 前端封装
import { getOhosDevices } from "../utils/hdc";
const devices = await getOhosDevices();
```

**返回值**：`OhosDevice` 数组。若无设备连接或 `hdc` 执行失败，则返回空数组。内部并行运行 `hdc list targets`（权威设备列表）和 `hdc list targets -v`（元数据），交叉对比以排除幽灵条目（UART/COM 端口扫描、回环监听器）。

**说明**：此为单次读取操作。如需实时更新，请订阅 [`hdc_devices_changed`](#hdc_devices_changed) 事件。返回前会从 `DEVICE_REMOUNT_STATUS` 合并重新挂载状态。

---

### `connect_ohos_device`

通过 `hdc tconn` 以 TCP 方式连接 OHOS 设备。

```typescript
invoke("connect_ohos_device", { addr: string }): Promise<string>
```

| 参数 | 类型 | 说明 |
|-----------|------|-------------|
| `addr` | `string` | `"IP:port"` 字符串，例如 `"192.168.1.100:5555"` |

**返回值**：`hdc tconn` 的原始输出字符串。

**错误**：若 `hdc tconn` 以非零退出码退出则拒绝。

---

### `disconnect_ohos_device`

通过 `hdc tconn <addr> -remove` 断开 TCP 连接的 OHOS 设备。同时清理已缓存的重新挂载状态，并停止该设备的所有活跃屏幕镜像会话。

```typescript
invoke("disconnect_ohos_device", { addr: string }): Promise<string>
```

| 参数 | 类型 | 说明 |
|-----------|------|-------------|
| `addr` | `string` | 待断开设备的 `"IP:port"` 字符串 |

**返回值**：`hdc tconn ... -remove` 的原始输出字符串。

**错误**：若命令以非零退出码退出则拒绝。

---

#### 设备监听器

`start_device_watcher(app)` 在应用启动时自动启动（在 `lib.rs::setup` 中）。它不是一个 Tauri 命令。

**行为：**
1. 每 **2 秒** 并行轮询 `hdc list targets` 和 `hdc list targets -v`。仅保留非 verbose 输出中出现的设备；verbose 输出提供元数据（conn_type、state、name）。
2. 当设备列表发生变化时，发出 [`hdc_devices_changed`](#hdc_devices_changed) 事件。
3. 对于每个新出现的 `state == "Connected"` 设备，每个 connect_key 在每次会话中**仅**生成一次 `attempt_remount()`（通过会话本地的 `HashSet` 跟踪）。
4. `attempt_remount()` 依次运行以下两条命令（两条均为必需）：
   - **第 1 步**：`hdc -t {connect_key} shell mount -o rw,remount /`
   - **第 2 步**：`hdc -t {connect_key} target mount`
   - 两步均检查 stdout+stderr 合并输出中是否存在失败标记：`[Fail]`、`not user mountable`、`Operation not permitted`、`debug mode`、`Read-only file system`。
   - `success = exit_status.success() && !has_failure`。
   - 将 `(is_remounted, remount_info)` 存储到 `DEVICE_REMOUNT_STATUS: Lazy<Mutex<HashMap<String, (bool, String)>>>`。
   - 重新发出携带更新状态的 `hdc_devices_changed` 事件。

5. 当某设备从轮询中消失（检测到断开连接）时，生成 `screen::kill_session(connect_key)` 以停止该设备的所有活跃屏幕镜像会话。

**说明**：重新挂载仅在调试/工程固件构建上成功。在生产固件上将失败，错误信息为 `[Fail][E007100] Operate need running under debug mode`，该信息会存入 `remount_info` 并显示在文件管理器 UI 中。

---

## 4. 命令 — 文件管理器

**源文件**：`src-tauri/src/hdc/file.rs`

---

### `list_hdc_files`

列出设备上某目录的内容。

```typescript
invoke("list_hdc_files", { connectKey: string, path: string }): Promise<FileEntry[]>
```

| 参数 | 类型 | 说明 |
|-----------|------|-------------|
| `connectKey` | `string` | 设备 connect_key |
| `path` | `string` | 设备上的绝对路径，例如 `"/data"` |

**返回值**：`FileEntry` 数组，排序规则：目录优先，其次按名称排序（不区分大小写）。

**实现**：运行 `hdc -t {connectKey} shell ls -la '{path}'`，并使用与 ADB 模块相同的正则表达式解析输出。

**错误**：若路径不存在或 `ls` 执行失败则拒绝。

---

### `send_hdc_files`

将一个或多个本地文件上传到设备上的指定目录。

```typescript
invoke("send_hdc_files", {
  connectKey: string,
  localPaths: string[],
  remotePath: string,
}): Promise<void>
```

| 参数 | 类型 | 说明 |
|-----------|------|-------------|
| `connectKey` | `string` | 设备 connect_key |
| `localPaths` | `string[]` | 本地文件绝对路径列表 |
| `remotePath` | `string` | 设备上的目标目录 |

**返回值**：成功时返回 `void`。

**副作用**：发出 [`transfer_progress`](#transfer_progress) 事件（与 ADB 模块共享）。由于 HDC 不提供字节级进度，每个文件仅发出 `percent: 0`（开始）和 `percent: 100`（完成）两个事件。

**错误**：若 `hdc file send` 以非零退出码退出则拒绝。

---

### `recv_hdc_file`

从设备下载单个文件到本地机器。

```typescript
invoke("recv_hdc_file", {
  connectKey: string,
  remotePath: string,
  localPath: string,
}): Promise<void>
```

| 参数 | 类型 | 说明 |
|-----------|------|-------------|
| `connectKey` | `string` | 设备 connect_key |
| `remotePath` | `string` | 设备上的绝对路径 |
| `localPath` | `string` | 本地机器上的目标路径（包含文件名的完整路径） |

**副作用**：先后发出 `transfer_progress` 事件，`percent: 0` 然后 `percent: 100`。

**错误**：若 `hdc file recv` 以非零退出码退出则拒绝。

---

### `delete_hdc_file`

删除设备上的文件或目录。

```typescript
invoke("delete_hdc_file", { connectKey: string, path: string }): Promise<void>
```

| 参数 | 类型 | 说明 |
|-----------|------|-------------|
| `connectKey` | `string` | 设备 connect_key |
| `path` | `string` | 设备上的绝对路径 |

**实现**：运行 `hdc -t {connectKey} shell rm -rf '{path}'`。递归删除且不可恢复。

**错误**：若 `rm` 以非零退出码退出则拒绝。

---

## 5. 命令 — Shell

**源文件**：`src-tauri/src/hdc/commands.rs`

---

### `run_hdc_shell_command`

同步运行 shell 命令并返回完整输出。

```typescript
invoke("run_hdc_shell_command", { connectKey: string, command: string }): Promise<string>
```

| 参数 | 类型 | 说明 |
|-----------|------|-------------|
| `connectKey` | `string` | 设备 connect_key |
| `command` | `string` | Shell 命令字符串 |

**返回值**：stdout+stderr 合并后的字符串。

**说明**：阻塞式 — 等待命令退出。仅用于短生命周期命令（例如 `cat`、`head -c`、`xxd -l`）。如需流式输出，请使用 `start_hdc_shell_stream`。

**错误**：若 `hdc shell` 以非零退出码退出，则以包含输出内容的消息拒绝。

---

### `start_hdc_shell_stream`

启动流式 shell 命令。输出以 [`hdc_shell_output`](#hdc_shell_output) 事件形式发出。完成时通过 [`hdc_shell_exit`](#hdc_shell_exit) 事件发出信号。

```typescript
invoke("start_hdc_shell_stream", { connectKey: string, command: string }): Promise<void>
```

| 参数 | 类型 | 说明 |
|-----------|------|-------------|
| `connectKey` | `string` | 设备 connect_key |
| `command` | `string` | Shell 命令字符串 |

**返回值**：立即返回 `void`（流在后台运行）。

**副作用**：
- 若该 `connectKey` 已有流在运行，则先终止该流。
- 随着 stdout 块的到达，发出 [`hdc_shell_output`](#hdc_shell_output) 事件。
- 进程退出时发出 [`hdc_shell_exit`](#hdc_shell_exit) 事件。

**实现**：生成 `hdc -t {connectKey} shell {command}`，stdout 以管道方式传输，以 8 KB 为块读取。进程 PID 以 `"shell:{connectKey}"` 为键存储在 `HDC_SHELL_PROCESSES` 中。停止时通过 `taskkill /F /T /PID` 终止进程树。

**错误**：仅在子进程生成失败时拒绝。

---

### `stop_hdc_shell_stream`

停止某设备正在运行的 shell 流。

```typescript
invoke("stop_hdc_shell_stream", { connectKey: string }): Promise<void>
```

**错误**：若没有活跃的流，则以 `"No HDC shell stream running for {connectKey}"` 拒绝。

---

## 6. 命令 — HiLog

**源文件**：`src-tauri/src/hdc/hilog.rs`

---

### `start_hilog`

启动某设备的 HiLog 输出流。

```typescript
invoke("start_hilog", { connectKey: string, filter: HilogFilter }): Promise<void>
```

| 参数 | 类型 | 说明 |
|-----------|------|-------------|
| `connectKey` | `string` | 设备 connect_key |
| `filter` | `HilogFilter` | 在后端应用的级别和关键词过滤器 |

**返回值**：立即返回 `void`（流式传输在后台运行）。

**副作用**：发出 [`hilog_lines`](#hilog_lines) 批次事件。

**实现**：
- 运行 `hdc -t {connectKey} shell hilog`。
- 使用以下正则表达式解析每行：
  ```
  ^(\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+)\s+(\d+)\s+(\d+)\s+([DIWEF])\s+([^\s:][^:]*?):\s*(.*)
  ```
- 不匹配正则的行将被静默丢弃。
- stderr 以管道方式传输，并以 tag 为 `hilog-stderr` 的错误级别条目形式发出。
- 在 Rust 侧进行过滤后，再将条目添加到批次中。
- 当批次达到 **64 条**或距上次刷新已过 **50 ms** 时，发出批次事件。
- 进程 PID 以 `"hilog:{connectKey}"` 为键存储在 `HILOG_PROCESSES` 中。
- 进程退出时，以 `mode: "hilog"` 和退出码发出 [`hilog_exit`](#hilog_exit) 事件。

**错误**：若该 `connectKey` 的流已在运行，则以 `"HiLog already running for {connectKey}"` 拒绝。请先调用 `stop_hilog`。

---

### `stop_hilog`

停止某设备的 HiLog 流。

```typescript
invoke("stop_hilog", { connectKey: string }): Promise<void>
```

**错误**：若未激活，则以 `"No HiLog running for {connectKey}"` 拒绝。

---

### `clear_hilog`

清除设备上的 HiLog 环形缓冲区（`hilog -r`）。不影响前端显示缓冲区。

```typescript
invoke("clear_hilog", { connectKey: string }): Promise<void>
```

**错误**：若命令以非零退出码退出则拒绝。

---

### `export_hilog`

将 `HilogEntry` 对象数组写入本地机器上的文本文件。

```typescript
invoke("export_hilog", { entries: HilogEntry[], path: string }): Promise<void>
```

| 参数 | 类型 | 说明 |
|-----------|------|-------------|
| `entries` | `HilogEntry[]` | 待导出的条目 |
| `path` | `string` | 写入的本地绝对路径 |

**输出格式**（每个条目占一行）：
```
{timestamp} {pid} {tid} {level} {tag}: {message}
```

**错误**：若文件无法写入则拒绝。

---

### `start_hdc_tlogcat`

启动某设备的 tlogcat 输出流。

```typescript
invoke("start_hdc_tlogcat", { connectKey: string }): Promise<void>
```

| 参数 | 类型 | 说明 |
|-----------|------|-------------|
| `connectKey` | `string` | 设备 connect_key |

**返回值**：立即返回 `void`（流式传输在后台运行）。

**副作用**：发出 [`hdc_tlogcat_lines`](#hdc_tlogcat_lines) 批次事件。

**实现**：
- 运行 `hdc -t {connectKey} shell tlogcat`。
- 使用 `parse_tlogcat_line()` 解析每行：优先尝试 HiLog 正则，若无法解析则将非空行作为 INFO 级别条目处理。这确保类似 `/bin/sh: tlogcat: inaccessible or not found` 的错误消息能够被显示。
- stderr 以管道方式传输，并以 tag 为 `tlogcat-stderr` 的错误级别条目形式发出。
- 进程 PID 以 `"tlogcat:{connectKey}"` 为键存储在 `HILOG_PROCESSES` 中。
- 进程退出时，以 `mode: "tlogcat"` 和退出码发出 [`hilog_exit`](#hilog_exit) 事件。

**错误**：若该设备的流已在运行，则以 `"tlogcat already running for this device"` 拒绝。请先调用 `stop_hdc_tlogcat`。

---

### `stop_hdc_tlogcat`

停止某设备的 tlogcat 流。

```typescript
invoke("stop_hdc_tlogcat", { connectKey: string }): Promise<void>
```

**错误**：若未激活，则以 `"No tlogcat running for this device"` 拒绝。

---

## 7. 命令 — 应用管理器

**源文件**：`src-tauri/src/hdc/apps.rs`

---

### `list_bundles`

返回所有已安装 HAP 应用包的列表，包含已解析的安装路径和类型分类。

```typescript
invoke("list_bundles", { connectKey: string }): Promise<BundleInfo[]>
```

| 参数 | 类型 | 说明 |
|-----------|------|-------------|
| `connectKey` | `string` | 设备 connect_key |

**返回值**：`BundleInfo` 数组，排序规则：用户应用优先（按字母排序），其次是供应商应用，最后是系统应用。

**实现（两阶段）：**
1. 运行 `hdc -t {connectKey} shell bm dump -a` 获取所有应用包名称。
   - 过滤掉包含 `:`（例如 `ID: 100:`）或不包含 `.` 的行。
2. 对每个应用包名称，并行生成 tokio 任务运行 `hdc -t {connectKey} shell bm dump -n {name}`。
   - 通过 `tokio::task::JoinSet` 等待所有任务完成。
   - 解析 JSON 输出中的 `"isSystemApp"`（布尔值）和第一个非空的 `"hapPath"` 字符串值。
   - 根据 `isSystemApp` 和 `hapPath` 前缀分类 `app_type`（参见 [`BundleInfo`](#bundleinfo)）。

**性能说明**：解析过程为 O(n) 并行 shell 调用。在有约 150 个应用包的设备上，预计总耗时 1–3 秒。前端在此期间显示加载动画。

**错误**：若 `bm dump -a` 执行失败则拒绝。单个 `bm dump -n` 的失败会被静默忽略 — 这些应用包的 `code_path` 将为 `""`，`app_type` 默认为 `"system"`。

---

### `install_hap`

从本地机器向设备安装 HAP 包。

```typescript
invoke("install_hap", { connectKey: string, hapPath: string }): Promise<string>
```

| 参数 | 类型 | 说明 |
|-----------|------|-------------|
| `connectKey` | `string` | 设备 connect_key |
| `hapPath` | `string` | `.hap` 文件的本地绝对路径 |

**返回值**：`hdc install` 的 stdout+stderr 合并输出。

**实现**：运行 `hdc -t {connectKey} install {hapPath}`。

**错误**：若 `hdc install` 以非零退出码退出**且**输出中不包含 `"success"`（不区分大小写）则拒绝。

---

### `uninstall_bundle`

从设备卸载某应用包。

```typescript
invoke("uninstall_bundle", { connectKey: string, bundleName: string }): Promise<string>
```

| 参数 | 类型 | 说明 |
|-----------|------|-------------|
| `connectKey` | `string` | 设备 connect_key |
| `bundleName` | `string` | 应用包名称，例如 `"com.example.app"` |

**返回值**：`hdc uninstall` 的 stdout+stderr 合并输出。

**实现**：运行 `hdc -t {connectKey} uninstall {bundleName}`。

**说明**：此命令对用户安装的应用（`app_type == "user"`）可靠有效。系统、产品和供应商应用包在生产固件上将失败（`error: uninstall system app error`，错误码 9568380）。当前 OHOS 版本中没有可用的 `bm disable` CLI，因此不存在针对系统应用的软禁用备用方案。非用户应用包的卸载按钮在 UI 中呈灰色禁用状态。

**错误**：若 `hdc uninstall` 以非零退出码退出**且**输出中不包含 `"success"` 则拒绝。

---

### `force_stop_bundle`

强制停止正在运行的应用包进程。

```typescript
invoke("force_stop_bundle", { connectKey: string, bundleName: string }): Promise<void>
```

| 参数 | 类型 | 说明 |
|-----------|------|-------------|
| `connectKey` | `string` | 设备 connect_key |
| `bundleName` | `string` | 应用包名称，例如 `"com.huawei.hmos.browser"` |

**实现**：运行 `hdc -t {connectKey} shell aa force-stop {bundleName}`，检查输出中是否包含 `"successfully"`。

**说明**：等同于 Android 的 `am force-stop` 命令。对任何应用包类型（用户、系统、产品、供应商）均安全可用。强制停止后应用包可正常重新启动。

**错误**：若命令失败或输出中不包含 `"successfully"` 则拒绝。

---

### `clear_bundle_data`

清除某应用包的所有数据（偏好设置、数据库、文件）。

```typescript
invoke("clear_bundle_data", { connectKey: string, bundleName: string }): Promise<void>
```

| 参数 | 类型 | 说明 |
|-----------|------|-------------|
| `connectKey` | `string` | 设备 connect_key |
| `bundleName` | `string` | 应用包名称 |

**实现**：运行 `hdc -t {connectKey} shell bm clean -n {bundleName} -d`，检查输出中是否包含 `"successfully"`。

**说明**：将应用包重置为出厂初始状态。数据不可恢复。对任何应用包类型均安全可用。

**错误**：若命令失败或输出中不包含 `"successfully"` 则拒绝。

---

## 8. 命令 — 屏幕镜像

**源文件**：`src-tauri/src/hdc/screen.rs`

屏幕镜像通过在设备上运行 `snapshot_display` 捕获设备显示内容，经由 `hdc file recv` 传输生成的 JPEG 文件，编码为 base64 后以 `hdc_screen_frame` 事件发出。帧以可配置的间隔在循环中捕获。

---

### `start_hdc_screen_mirror`

启动某设备的屏幕镜像捕获。

```typescript
invoke("start_hdc_screen_mirror", {
  connectKey: string,
  config: HdcScreenMirrorConfig,
}): Promise<void>
```

| 参数 | 类型 | 说明 |
|-----------|------|-------------|
| `connectKey` | `string` | 设备 connect_key |
| `config` | `HdcScreenMirrorConfig` | 捕获配置 |

**返回值**：立即返回 `void`（捕获循环在后台 tokio 任务中运行）。

**副作用**：
- 若该 `connectKey` 已有会话在运行，则先停止该会话。
- 启动时发出 [`hdc_screen_state`](#hdc_screen_state) `{ connect_key, running: true }`。
- 每捕获并传输一帧 JPEG 时发出 [`hdc_screen_frame`](#hdc_screen_frame) 事件。
- 循环退出时（手动停止或连续 5 次失败）发出 `hdc_screen_state { running: false }`。

**实现**：
1. 取消标志存储在 `SCREEN_SESSIONS: Lazy<Mutex<HashMap<String, Arc<AtomicBool>>>>` 中。
2. 每次迭代：运行 `hdc -t {connectKey} shell snapshot_display -f /data/local/tmp/devbridge_screen.jpeg`，然后 `hdc -t {connectKey} file recv` 到本地临时文件，读取文件，编码为 base64，发出帧事件。
3. 每次发出后删除本地临时文件。循环退出时清理远端文件。
4. 连续 5 次捕获/传输失败将终止循环。

**错误**：仅在取消标志映射锁定失败时拒绝（实际中不应发生）。

---

### `stop_hdc_screen_mirror`

停止某设备的屏幕镜像会话。

```typescript
invoke("stop_hdc_screen_mirror", { connectKey: string }): Promise<void>
```

| 参数 | 类型 | 说明 |
|-----------|------|-------------|
| `connectKey` | `string` | 设备 connect_key |

**返回值**：`void`。若无活跃会话也不报错。

**实现**：从 `SCREEN_SESSIONS` 中移除取消标志并将其设为 `true`。捕获循环在每次迭代时检查此标志并正常退出。

---

### `is_hdc_screen_mirror_running`

检查某设备的屏幕镜像当前是否处于活跃状态。

```typescript
invoke("is_hdc_screen_mirror_running", { connectKey: string }): Promise<boolean>
```

| 参数 | 类型 | 说明 |
|-----------|------|-------------|
| `connectKey` | `string` | 设备 connect_key |

**返回值**：若 `SCREEN_SESSIONS` 中存在会话条目则返回 `true`，否则返回 `false`。

**说明**：同步（非异步）。仅检查内存中的会话映射。

---

## 9. 事件（后端 → 前端）

事件由 Rust 后端通过 `app.emit()` 发出，并在前端通过 `listen()` 订阅。

---

### `hdc_devices_changed`

当 OHOS 设备列表发生变化，或新连接设备的 `attempt_remount` 完成后，由设备监听器发出。

```typescript
listen("hdc_devices_changed", (event: { payload: OhosDevice[] }) => { ... })
```

**载荷**：`OhosDevice[]` — 合并了重新挂载状态的完整当前设备列表。

**触发条件**：
- 任意设备连接或断开
- 设备在状态之间转换
- `attempt_remount` 完成后（以更新 `is_remounted`/`remount_info`）

---

### `hdc_shell_output`

由 `start_hdc_shell_stream` 在从运行进程读取到每个 stdout 块时发出。

```typescript
listen("hdc_shell_output", (event: { payload: HdcShellOutput }) => { ... })
```

**载荷**：`HdcShellOutput { connect_key, data }`

---

### `hdc_shell_exit`

在 shell 流进程退出时发出（自然退出或通过 `stop_hdc_shell_stream` 停止后）。

```typescript
listen("hdc_shell_exit", (event: { payload: HdcShellExit }) => { ... })
```

**载荷**：`HdcShellExit { connect_key, code }`

**说明**：`code: -1` 表示退出码无法确定。

---

### `hilog_lines`

由 `start_hilog` 以解析后日志条目批次的形式发出。

```typescript
listen("hilog_lines", (event: { payload: HilogBatch }) => { ... })
```

**载荷**：`HilogBatch { connect_key, entries }` — 每批次包含 1 至 64 条条目。

**说明**：仅包含通过传递给 `start_hilog` 的 `HilogFilter` 过滤的条目。批次在达到 64 条或经过 50 ms 时（以先到者为准）刷新。

---

### `hdc_tlogcat_lines`

由 `start_hdc_tlogcat` 以解析后日志条目批次的形式发出。

```typescript
listen("hdc_tlogcat_lines", (event: { payload: HilogBatch }) => { ... })
```

**载荷**：`HilogBatch { connect_key, entries }` — 每批次包含 1 至 64 条条目。

**说明**：与 `hilog_lines` 不同，tlogcat 条目不进行预过滤。无法解析的行（包括错误消息）以 tag 为空的 INFO 级别条目形式发出。

---

### `hilog_exit`

在 HiLog 或 tlogcat 进程退出时发出（自然退出或通过 `stop_hilog` / `stop_hdc_tlogcat` 停止后）。

```typescript
listen("hilog_exit", (event: { payload: HilogExit }) => { ... })
```

**载荷**：`HilogExit { connect_key, mode, code }`

**说明**：`code: null` 表示退出码无法确定。此事件表明日志流已终止，该设备和模式不会再发出 `hilog_lines` / `hdc_tlogcat_lines` 事件。前端使用此事件重置运行中指示器，若进程以非零退出码退出则显示警告。

---

### `hdc_screen_frame`

由屏幕镜像捕获循环在每成功捕获一帧 JPEG 时发出。

```typescript
listen("hdc_screen_frame", (event: { payload: ScreenFrame }) => { ... })
```

**载荷**：`ScreenFrame { connect_key, data }` — `data` 为 base64 编码的 JPEG 字符串，可直接用作 `<img>` 标签 `src` 属性中的 `data:image/jpeg;base64,{data}`。

**说明**：以 `HdcScreenMirrorConfig.intervalMs` 配置的间隔（333–5000 ms）发出。当多个设备处于活跃状态时，前端应按 `connect_key` 进行过滤。

---

### `hdc_screen_state`

在屏幕镜像会话启动或停止时发出。

```typescript
listen("hdc_screen_state", (event: { payload: HdcScreenMirrorState }) => { ... })
```

**载荷**：`HdcScreenMirrorState { connect_key, running }`

**触发条件**：
- 调用 `start_hdc_screen_mirror` → `running: true`
- 捕获循环退出（通过 `stop_hdc_screen_mirror` 手动停止，或连续 5 次捕获失败）→ `running: false`
- 设备断开连接且设备监听器调用 `screen::kill_session()` → `running: false`

---

### `transfer_progress`

与 ADB 模块共享。在 `send_hdc_files` 和 `recv_hdc_file` 期间发出。

```typescript
listen("transfer_progress", (event: { payload: TransferProgress }) => { ... })
```

**说明**：由于 HDC 不提供字节级进度标记，因此仅发出 `percent: 0`（开始）和 `percent: 100`（成功）两个事件。若失败，则发出 `percent: -1` 且 `speed: "failed"` 的事件。`TransferProgress` 类型定义请参见 ADB 模块 API 参考。

---

## 10. 前端工具函数封装

所有封装函数位于 `src/utils/hdc.ts`，是带有 TypeScript 类型的 `invoke()` 调用薄层。

```typescript
import {
  getOhosDevices,
  connectOhosDevice,
  runHdcShellCommand,
  startHdcShellStream,
  stopHdcShellStream,
  listHdcFiles,
  sendHdcFiles,
  recvHdcFile,
  deleteHdcFile,
  startHilog,
  stopHilog,
  clearHilog,
  exportHilog,
  listBundles,
  installHap,
  uninstallBundle,
  forceStopBundle,
  clearBundleData,
  startHdcScreenMirror,
  stopHdcScreenMirror,
  isHdcScreenMirrorRunning,
} from "../utils/hdc";
```

| 封装函数 | 对应命令 |
|---------|-----------------|
| `getOhosDevices()` | `get_ohos_devices` |
| `connectOhosDevice(addr)` | `connect_ohos_device` |
| `disconnectOhosDevice(addr)` | `disconnect_ohos_device` |
| `runHdcShellCommand(connectKey, command)` | `run_hdc_shell_command` |
| `startHdcShellStream(connectKey, command)` | `start_hdc_shell_stream` |
| `stopHdcShellStream(connectKey)` | `stop_hdc_shell_stream` |
| `listHdcFiles(connectKey, path)` | `list_hdc_files` |
| `sendHdcFiles(connectKey, localPaths, remotePath)` | `send_hdc_files` |
| `recvHdcFile(connectKey, remotePath, localPath)` | `recv_hdc_file` |
| `deleteHdcFile(connectKey, path)` | `delete_hdc_file` |
| `startHilog(connectKey, filter)` | `start_hilog` |
| `stopHilog(connectKey)` | `stop_hilog` |
| `clearHilog(connectKey)` | `clear_hilog` |
| `exportHilog(entries, path)` | `export_hilog` |
| `startHdcTlogcat(connectKey)` | `start_hdc_tlogcat` |
| `stopHdcTlogcat(connectKey)` | `stop_hdc_tlogcat` |
| `listBundles(connectKey)` | `list_bundles` |
| `installHap(connectKey, hapPath)` | `install_hap` |
| `uninstallBundle(connectKey, bundleName)` | `uninstall_bundle` |
| `forceStopBundle(connectKey, bundleName)` | `force_stop_bundle` |
| `clearBundleData(connectKey, bundleName)` | `clear_bundle_data` |
| `startHdcScreenMirror(connectKey, config)` | `start_hdc_screen_mirror` |
| `stopHdcScreenMirror(connectKey)` | `stop_hdc_screen_mirror` |
| `isHdcScreenMirrorRunning(connectKey)` | `is_hdc_screen_mirror_running` |

---

## 11. 错误处理

所有 Tauri 命令在 Rust 侧均返回 `Result<T, String>`，在前端对应为被拒绝的 Promise。拒绝值始终为纯人类可读的字符串。

**推荐模式：**

```typescript
try {
  await someHdcCommand(...);
} catch (e) {
  message.error(String(e));
}
```

**常见错误消息：**

| 情况 | 错误字符串 |
|-----------|-------------|
| 未找到 `hdc` 可执行文件 | `"Failed to run hdc: ..."` |
| `bm dump -a` 执行失败 | `"Failed to run bm dump: ..."` |
| shell 命令非零退出 | stdout+stderr 合并内容作为错误字符串 |
| HiLog 已在运行 | `"HiLog already running for {connectKey}"` |
| 无活跃 HiLog 流 | `"No HiLog running for {connectKey}"` |
| tlogcat 已在运行 | `"tlogcat already running for this device"` |
| 无活跃 tlogcat 流 | `"No tlogcat running for this device"` |
| 无活跃 shell 流 | `"No HDC shell stream running for {connectKey}"` |
| 文件发送/接收失败 | `hdc file send/recv` 的非零退出输出 |

---

## 12. HDC 工具路径解析

**源文件**：`src-tauri/src/hdc/commands.rs` — `hdc_path()`

HDC 可执行文件在运行时按以下顺序搜索各位置：

1. **打包资源** — `{app_resource_dir}/hdc/hdc.exe`（用于已发布的应用）
2. **DevEco Studio SDK** — `%DEVECO_SDK_HOME%/hdc.exe`（环境变量）
3. **DevEco Studio 默认安装路径** — `%LOCALAPPDATA%/DevEco Studio/sdk/**/toolchains/hdc.exe`（glob 搜索）
4. **系统 PATH** — `hdc`（依赖操作系统查找）

若以上所有位置均无法找到可用的可执行文件，所有 HDC 命令将以生成错误而失败。用户应确保已安装 DevEco Studio 或 `hdc` 已添加到系统 PATH 中。

**与 ADB 的差异**：与 ADB（使用 `tauri-plugin-shell` 进行子进程管理）不同，HDC 模块直接使用 `tokio::process::Command`。这是因为 HDC 需要生成具有精确参数控制的交互式子进程，而 shell 插件的抽象层对此支持不够便捷。
