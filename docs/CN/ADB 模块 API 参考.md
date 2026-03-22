# ADB 模块 — API 参考

> **项目**：Bridge
> **模块**：ADB（`src-tauri/src/adb/`、`src/utils/adb.ts`）
> **最后更新**：2026-03

本文档是 ADB 模块的完整 API 参考，涵盖所有暴露给前端的 Tauri 命令、所有后端到前端的事件，以及所有共享数据类型。未通过 IPC 暴露的 Rust 内部辅助函数不在本文档列出范围之内。

---

## 目录

1. [IPC 机制](#1-ipc-机制)
2. [数据类型](#2-数据类型)
3. [命令 — 设备管理](#3-命令--设备管理)
4. [命令 — 文件管理器](#4-命令--文件管理器)
5. [命令 — Shell](#5-命令--shell)
6. [命令 — Logcat](#6-命令--logcat)
7. [命令 — 应用管理器](#7-命令--应用管理器)
8. [命令 — 屏幕镜像（scrcpy）](#8-命令--屏幕镜像scrcpy)
9. [事件（后端 → 前端）](#9-事件后端--前端)
10. [命令 — 本地脚本执行](#10-命令--本地脚本执行)
11. [前端工具函数封装](#11-前端工具函数封装)
12. [错误处理](#12-错误处理)

---

## 1. IPC 机制

所有 ADB 命令均遵循 Tauri IPC 模式：

- **前端 → 后端**：`invoke("command_name", { ...args })` — 返回一个 `Promise`，成功时解析为命令的返回值，失败时以错误字符串拒绝。
- **后端 → 前端**：`app.emit("event_name", payload)` — 推送事件，前端通过 `listen()` 订阅。

所有命令在 Rust 端均为 `async`（tokio），并返回 `Result<T, String>`。错误变体始终携带可读的错误信息。

---

## 2. 数据类型

### `ScrcpyConfig`

传递给 `start_scrcpy` 的配置对象。所有字段均为可选项 — 省略的字段将使用 scrcpy 默认值。

```typescript
interface ScrcpyConfig {
  maxSize?: number;        // --max-size (e.g. 1024)
  videoBitrate?: string;   // --video-bit-rate (e.g. "8M")
  maxFps?: number;         // --max-fps (e.g. 60)
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

```rust
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScrcpyConfig {
    pub max_size: Option<u16>,
    pub video_bitrate: Option<String>,
    pub max_fps: Option<u8>,
    pub stay_awake: Option<bool>,
    pub show_touches: Option<bool>,
    pub borderless: Option<bool>,
    pub always_on_top: Option<bool>,
    pub turn_screen_off: Option<bool>,
    pub power_off_on_close: Option<bool>,
    pub crop: Option<String>,
    pub lock_orientation: Option<u8>,
    pub record_path: Option<String>,
    pub no_audio: Option<bool>,
    pub keyboard_mode: Option<String>,
    pub mouse_mode: Option<String>,
}
```

---

### `ScrcpyState`

`scrcpy_state` 事件的载荷。

```typescript
interface ScrcpyState {
  serial: string;  // 设备序列号
  running: boolean; // true = scrcpy 正在运行，false = 已停止/已退出
}
```

---

### `AdbDevice`

表示一个已连接的 ADB 设备。由 `get_devices` 返回，并在 `devices_changed` 事件中发送。

```typescript
interface AdbDevice {
  serial: string;        // 设备序列号，网络设备为 "host:port" 格式
  state: string;         // "device" | "offline" | "unauthorized" | "recovery" | ...
  model: string;         // 例如 "Pixel_6_Pro"（如未报告则为空字符串）
  product: string;       // 例如 "raven"（如未报告则为空字符串）
  transport_id: string;  // ADB 内部传输 ID
  is_root: boolean;      // 若设备上 adbd 以 root 身份运行则为 true
  root_info: string;     // root 尝试的可读输出；空字符串表示仍在进行中
  is_remounted: boolean; // 若系统分区成功重挂载为可读写则为 true
  remount_info: string;  // 重挂载尝试的可读输出；空字符串表示仍在进行中
}
```

```rust
pub struct AdbDevice {
    pub serial: String,
    pub state: String,
    pub model: String,
    pub product: String,
    pub transport_id: String,
    pub is_root: bool,
    pub root_info: String,
    pub is_remounted: bool,
    pub remount_info: String,
}
```

**说明：**
- `is_root`、`root_info`、`is_remounted` 和 `remount_info` 在每次会话中，当设备首次上线时确定（参见[设备监听器](#设备监听器)）。它们缓存于 `DEVICE_ROOT_STATUS` 中，并合并到每次后续的 `list_devices()` 调用中。
- 当 root/重挂载尝试仍在进行中时，`root_info` 和 `remount_info` 为空字符串。文件管理器 UI 在此状态下显示 `"checking..."`。
- `state == "device"` 表示设备已完全连接并通过授权。

---

### `FileEntry`

表示 `list_files` 返回的单个文件或目录条目。

```typescript
interface FileEntry {
  name: string;        // 文件/目录显示名称（符号链接会去除 "-> target" 后缀）
  path: string;        // 设备上的完整绝对路径
  is_dir: boolean;     // 目录及指向目录的符号链接为 true
  size: number;        // 文件大小（字节）；目录为 0
  permissions: string; // Unix 权限字符串，例如 "drwxrwxr-x"
  modified: string;    // 最后修改时间戳，例如 "2024-01-15 10:30"
}
```

---

### `TransferProgress`

在 `push_files` 和 `pull_file` 操作期间发送。

```typescript
interface TransferProgress {
  id: string;        // 标识此次传输操作的 UUID
  file_name: string; // 正在传输的基础文件名
  transferred: number; // 当前始终为 0（字节级跟踪尚未实现）
  total: number;       // 当前始终为 0
  percent: number;     // 0.0–100.0，从 adb stderr 输出中解析
  speed: string;       // 当前始终为 ""（速度尚未解析）
}
```

**说明：**
- 进度通过正则表达式 `\[\s*(\d+)%\]` 从 `adb push`/`pull` 的 stderr 输出中解析。
- 传输完成时始终会发送一个 `percent: 100.0` 的最终事件，即使未收到任何中间事件也是如此。

---

### `LogEntry`

表示一条已解析的日志行。用于 `LogcatBatch` 载荷及 `export_logs` 中。

```typescript
interface LogEntry {
  timestamp: string; // "MM-DD HH:MM:SS.mmm"，或 tlogcat brief 格式行为 ""
  pid: string;       // 进程 ID 字符串，例如 "1234"
  tid: string;       // 线程 ID 字符串，例如 "5678"（tlogcat 可能为 ""）
  level: string;     // "V" | "D" | "I" | "W" | "E" | "F"
  tag: string;       // 日志标签，例如 "ActivityManager"
  message: string;   // 日志消息正文
}
```

---

### `LogcatBatch`

由 `logcat_lines` 和 `tlogcat_lines` 事件发送的包装对象。将一批日志条目与产生它们的设备关联。

```typescript
interface LogcatBatch {
  serial: string;        // 此批次所属设备的序列号
  entries: LogEntry[];   // 1 到 64 条已解析的日志条目
}
```

---

### `LogcatFilter`

`start_logcat` 的输入参数。所有字段均为可选项 — `null` 表示不在该维度上进行过滤。

```typescript
interface LogcatFilter {
  level: string | null;    // 最低级别阈值："V"|"D"|"I"|"W"|"E"|"F"，或 null 表示全部
  tags: string[] | null;   // 标签子字符串白名单；null 或 [] 表示不过滤标签
  keyword: string | null;  // 对标签和消息进行子字符串匹配；null 表示不过滤
}
```

**说明：**
- `level` 过滤为阈值模式：设置为 `"W"` 会放行 W、E 和 F，拒绝 V、D 和 I。
- 标签过滤检查白名单中的任意字符串是否为条目标签的子字符串（`entry.tag.contains(t)`）。
- 关键字过滤不区分大小写。
- 过滤在 Rust 后端发送之前应用；不匹配的条目永远不会到达前端。

---

### `ShellOutput`

`shell_output` 事件的载荷。

```typescript
interface ShellOutput {
  serial: string; // 此输出所属设备的序列号
  data: string;   // 原始文本块（stdout 或 stderr，UTF-8 宽松解码）
}
```

---

### `ShellExit`

`shell_exit` 事件的载荷。

```typescript
interface ShellExit {
  serial: string; // 设备序列号
  code: number;   // 进程退出码；若无法确定则为 -1
}
```

---

### `PackageInfo`

由 `list_packages` 返回。表示一个已安装的应用包。

```typescript
interface PackageInfo {
  package_name: string;                             // 例如 "com.android.settings"
  apk_path: string;                                 // 基础 APK 的完整路径，例如 "/system/app/Settings/Settings.apk"
  is_system: boolean;                               // 若该包不在 "pm list packages -3"（第三方列表）中则为 true
  is_disabled: boolean;                             // 若该包出现在 "pm list packages -d"（已显式禁用）中则为 true
  is_hidden: boolean;                               // 若存在于 "pm list packages -u" 但不在常规已安装集合中则为 true
  app_type: "user" | "system" | "vendor" | "product"; // 从 apk_path 派生的分区分类
}
```

**应用类型分类**（根据 `apk_path` 前缀）：

| `apk_path` 前缀 | `app_type` |
|-----------------|------------|
| `/data/app/` | `"user"` |
| `/product/` | `"product"` |
| `/vendor/` | `"vendor"` |
| `/system/`、`/system_ext/`、`/apex/` 或无法识别 | `"system"` |

**隐藏包**：当通过 `pm uninstall -k --user 0` 进行软删除时，包的 `is_hidden = true`。APK 文件仍保留在其分区上，但该包对当前用户不可见 — 它会从启动器和所有标准 `pm list packages` 输出中消失。可通过 `re_enable_package`（`pm install-existing --user 0`）恢复。隐藏包仅出现在 `pm list packages -u`（包含未安装包）中。

---

## 3. 命令 — 设备管理

**源码**：`src-tauri/src/adb/device.rs`

---

### `get_devices`

返回当前已连接 ADB 设备的列表。

```typescript
invoke("get_devices"): Promise<AdbDevice[]>
```

```typescript
// 前端封装
import { getDevices } from "../utils/adb";
const devices = await getDevices();
```

**返回值**：`AdbDevice` 数组。若无设备连接则返回空数组。

**说明**：这是对当前状态的单次读取。如需实时更新，请改为订阅 [`devices_changed`](#devices_changed) 事件。`is_root` 和 `is_remounted` 在此调用返回时已合并完毕。

---

### `connect_network_device`

通过 `adb connect` 以网络方式连接 Android 设备。

```typescript
invoke("connect_network_device", { host: string, port: number }): Promise<string>
```

| 参数 | 类型 | 描述 |
|------|------|------|
| `host` | `string` | IP 地址或主机名，例如 `"192.168.1.100"` |
| `port` | `number` | TCP 端口，通常为 `5555` |

**返回值**：`adb connect` 的原始输出字符串，例如 `"connected to 192.168.1.100:5555"` 或 `"already connected"`。

**错误**：若 `adb connect` 以非零退出码退出则拒绝。

---

### `disconnect_device`

通过 `adb disconnect` 断开网络连接的设备。

```typescript
invoke("disconnect_device", { serial: string }): Promise<string>
```

| 参数 | 类型 | 描述 |
|------|------|------|
| `serial` | `string` | 设备序列号，例如 `"192.168.1.100:5555"` |

**返回值**：`adb disconnect` 的原始输出字符串。

---

#### 设备监听器

`start_device_watcher(app)` 在应用启动时自动启动（在 `lib.rs::setup` 中）。它不是 Tauri 命令，无法从前端直接调用。

**行为：**
1. 每 **2 秒** 轮询一次 `adb devices -l`。
2. 当设备列表变化时，发送 [`devices_changed`](#devices_changed) 事件。
3. 对每个新出现的 `state == "device"` 的设备，在每次会话中**每个序列号仅执行一次** `attempt_root_and_remount()`（通过会话本地 `HashSet` 追踪）。
4. `attempt_root_and_remount()` 的执行过程：
   - 运行 `adb -s {serial} root` 并检查 stdout：
     - `"already running as root"` → `is_root = true`，`root_info = "Already running as root"`
     - `"restarting adbd as root"` → 每隔 1 秒轮询 `adb -s {serial} shell whoami`，最多 6 秒；确认为 `"root"` 时 `is_root = true`，`root_info = "Restarted adbd as root"`；超时时 `root_info = "adbd restart timed out"`
     - 其他输出（例如 `"cannot run as root in production builds"`）→ `is_root = false`，`root_info = <trimmed stdout+stderr>`
   - 若 `is_root == true`，运行 `adb -s {serial} remount`；`is_remounted = exit_status.success()`，`remount_info = <trimmed stdout+stderr>`
   - 若 `is_root == false`，`remount_info = "Remount requires root access"`
   - 将 `(is_root, root_info, is_remounted, remount_info)` 存储于 `DEVICE_ROOT_STATUS: Lazy<Mutex<HashMap<String, (bool, String, bool, String)>>>`
   - 携带更新后的状态重新发送 `devices_changed` 事件

---

## 4. 命令 — 文件管理器

**源码**：`src-tauri/src/adb/file.rs`

---

### `list_files`

列出设备上某个目录的内容。

```typescript
invoke("list_files", { serial: string, path: string }): Promise<FileEntry[]>
```

| 参数 | 类型 | 描述 |
|------|------|------|
| `serial` | `string` | 设备序列号 |
| `path` | `string` | 设备上的绝对路径，例如 `"/sdcard"` |

**返回值**：`FileEntry` 数组，排序规则为：目录优先，然后按名称排序（不区分大小写）。`.` 和 `..` 条目被排除。

**实现**：运行 `adb shell ls -la '{path}'` 并用匹配 `ls -la` 格式的正则表达式解析每一行。符号链接的显示名称会去除 `" -> target"` 后缀。

**错误**：若路径不存在、不可读（权限被拒绝）或 `ls` 命令失败则拒绝。

---

### `push_files`

将一个或多个本地文件上传到设备上的某个目录。

```typescript
invoke("push_files", { serial: string, localPaths: string[], remotePath: string }): Promise<void>
```

| 参数 | 类型 | 描述 |
|------|------|------|
| `serial` | `string` | 设备序列号 |
| `localPaths` | `string[]` | 要上传的本地绝对路径列表 |
| `remotePath` | `string` | 设备上的目标目录 |

**返回值**：成功时返回 `void`。

**副作用**：在操作期间发送 [`transfer_progress`](#transfer_progress) 事件（每解析到一行 `adb push` stderr 进度发送一次，成功时额外发送 `percent: 100`，每个文件失败时发送 `percent: -1`）。

**说明**：文件按顺序上传（每次一个）。若任一文件失败，命令立即拒绝，后续文件不再处理。

**错误**：非零退出时以 `"adb push failed for {filename}"` 拒绝。

---

### `pull_file`

从设备下载单个文件到本地机器。

```typescript
invoke("pull_file", { serial: string, remotePath: string, localPath: string }): Promise<void>
```

| 参数 | 类型 | 描述 |
|------|------|------|
| `serial` | `string` | 设备序列号 |
| `remotePath` | `string` | 设备上的绝对路径 |
| `localPath` | `string` | 本地目标路径（含文件名的完整路径） |

**返回值**：成功时返回 `void`。

**副作用**：在操作期间发送 [`transfer_progress`](#transfer_progress) 事件。

**错误**：非零退出时以 `"adb pull failed for {filename}"` 拒绝。

---

### `delete_file`

删除设备上的文件或目录。

```typescript
invoke("delete_file", { serial: string, path: string }): Promise<void>
```

| 参数 | 类型 | 描述 |
|------|------|------|
| `serial` | `string` | 设备序列号 |
| `path` | `string` | 设备上的绝对路径 |

**返回值**：成功时返回 `void`。

**实现**：运行 `adb shell rm -rf '{path}'`。此操作为递归且不可恢复 — 请谨慎使用。

**错误**：若 `rm` 以非零退出码退出（例如权限被拒绝）则拒绝。

---

## 5. 命令 — Shell

**源码**：`src-tauri/src/adb/commands.rs`

---

### `run_shell_command`

同步运行 shell 命令并返回完整的 stdout 输出。

```typescript
invoke("run_shell_command", { serial: string, command: string }): Promise<string>
```

| 参数 | 类型 | 描述 |
|------|------|------|
| `serial` | `string` | 设备序列号 |
| `command` | `string` | 传递给 `adb -s {serial} shell` 的 shell 命令字符串 |

**返回值**：完整的 stdout 字符串。

**说明**：这是一个阻塞调用 — 它会等待命令退出后再返回。仅适用于短时命令（例如 `whoami`、`cat /proc/version`、`head -c 8192 /path`）。对于长时运行或交互式命令，请改用 `start_shell_stream`。

**错误**：若 `adb shell` 以非零退出码退出，则以合并了 stderr 和 stdout 的消息拒绝。

---

### `start_shell_stream`

启动流式 shell 命令。输出（stdout 和 stderr）实时以 [`shell_output`](#shell_output) 事件发送。进程完成时以 [`shell_exit`](#shell_exit) 事件通知。

```typescript
invoke("start_shell_stream", { serial: string, command: string }): Promise<void>
```

| 参数 | 类型 | 描述 |
|------|------|------|
| `serial` | `string` | 设备序列号 |
| `command` | `string` | Shell 命令字符串 |

**返回值**：立即返回 `void`（流在后台运行）。

**副作用**：
- 若此 `serial` 已有正在运行的流，会先将其终止（自动停止上一个）。
- 随着数据到来，发送包含 stdout 和 stderr 块的 [`shell_output`](#shell_output) 事件。
- 进程退出时发送 [`shell_exit`](#shell_exit) 事件。

**实现细节**：
- 以管道方式同时捕获 stdout 和 stderr，生成 `adb -s {serial} shell {command}` 子进程。
- Stdout 由一个 tokio 任务以 **8KB 块**读取。
- Stderr 由另一个并行 tokio 任务以 **4KB 块**读取。
- 两个任务均会发送 `shell_output` 事件，因此命令未找到的错误（退出码 127）和其他 stderr 消息也会出现在终端输出中。
- 进程 PID 以 `"shell:{serial}"` 为键存储在 `SHELL_PROCESSES: Lazy<Mutex<HashMap<String, u32>>>` 中。
- `kill_on_drop(true)` 确保任务被中止时子进程也会被终止。

**错误**：仅当子进程无法生成时拒绝（例如未找到 `adb`）。

---

### `stop_shell_stream`

停止设备的正在运行的 shell 流。

```typescript
invoke("stop_shell_stream", { serial: string }): Promise<void>
```

| 参数 | 类型 | 描述 |
|------|------|------|
| `serial` | `string` | 设备序列号 |

**返回值**：`void`。

**实现**：从 `SHELL_PROCESSES` 中移除 PID，并运行 `taskkill /F /T /PID` 终止整个进程树。

**错误**：若无活跃的流，则以 `"No shell stream running for this device"` 拒绝。

---

## 6. 命令 — Logcat

**源码**：`src-tauri/src/adb/logcat.rs`

---

### `start_logcat`

开始为设备流式传输 logcat 输出。

```typescript
invoke("start_logcat", { serial: string, filter: LogcatFilter }): Promise<void>
```

| 参数 | 类型 | 描述 |
|------|------|------|
| `serial` | `string` | 设备序列号 |
| `filter` | `LogcatFilter` | 在后端应用的级别/标签/关键字过滤器 |

**返回值**：立即返回 `void`（流在后台运行）。

**副作用**：发送 [`logcat_lines`](#logcat_lines) 批次事件。

**实现**：
- 运行 `adb -s {serial} logcat -v threadtime`。
- 使用宽松的 threadtime 正则表达式解析行，同时支持 `MM-DD` 和 `YYYY-MM-DD` 时间戳前缀。
- 在 Rust 中，将条目添加到批次之前先应用过滤（`passes_filter`）。
- 条目在批量满足以下任一条件时发送：批次达到 **64 条**，或距上次刷新已过 **50ms**（以先到者为准）。这在延迟和 IPC 开销之间取得平衡。
- PID 以 `"logcat:{serial}"` 为键存储在 `LOGCAT_PROCESSES` 中。

**错误**：若 logcat 流已处于活跃状态，则以 `"Logcat already running for this device"` 拒绝。请先调用 `stop_logcat`。

---

### `stop_logcat`

停止设备的 logcat 流。

```typescript
invoke("stop_logcat", { serial: string }): Promise<void>
```

**实现**：从 `LOGCAT_PROCESSES` 中移除 PID，并通过 `taskkill /F /T /PID` 终止进程树。

**错误**：若流未活跃，则以 `"No logcat running for this device"` 拒绝。

---

### `start_tlogcat`

开始为设备流式传输 TEE 日志（`tlogcat`）输出。

```typescript
invoke("start_tlogcat", { serial: string }): Promise<void>
```

**返回值**：立即返回 `void`。

**副作用**：发送 [`tlogcat_lines`](#tlogcat_lines) 批次事件。

**实现**：
- 运行 `adb -s {serial} shell tlogcat`。
- 解析比 logcat 更宽松 — 优先尝试 threadtime 正则，其次尝试 brief 格式（`L/Tag(PID): message`），最后将整行视为带空标签的 `INFO` 消息。确保不会静默丢弃任何行。
- Stderr 也通过管道捕获，并由独立的 tokio 任务读取。Stderr 行以错误级别（`"E"`）、标签为 `"tlogcat-stderr"` 的条目发送，使得 tlogcat 错误消息（例如命令未找到、权限被拒绝）出现在日志流中。
- 不应用任何过滤（tlogcat 不支持服务端级别过滤）。
- 与 `start_logcat` 相同的 64 条 / 50ms 批处理模型。
- PID 以 `"tlogcat:{serial}"` 为键存储在 `LOGCAT_PROCESSES` 中。

**说明**：logcat 和 tlogcat 是独立的流，同一设备可以同时运行两者。

**错误**：若 tlogcat 流已处于活跃状态，则以 `"tlogcat already running for this device"` 拒绝。

---

### `stop_tlogcat`

停止设备的 tlogcat 流。

```typescript
invoke("stop_tlogcat", { serial: string }): Promise<void>
```

**错误**：若流未活跃，则以 `"No tlogcat running for this device"` 拒绝。

---

### `clear_device_log`

清除设备上的 logcat 环形缓冲区（`adb logcat -c`）。不影响前端显示缓冲区。

```typescript
invoke("clear_device_log", { serial: string }): Promise<void>
```

**错误**：若 `logcat -c` 以非零退出码退出则拒绝。

---

### `export_logs`

将 `LogEntry` 对象数组写入本地机器上的文本文件。

```typescript
invoke("export_logs", { logs: LogEntry[], path: string }): Promise<void>
```

| 参数 | 类型 | 描述 |
|------|------|------|
| `logs` | `LogEntry[]` | 要导出的条目（调用方在传入前应用任何显示侧过滤） |
| `path` | `string` | 要写入的本地绝对路径，例如 `"C:\\Users\\user\\Desktop\\log.txt"` |

**输出格式**（每条目一行）：
```
{timestamp} {pid} {tid} {level}/{tag}: {message}
```

**错误**：若文件无法写入则拒绝。

---

## 7. 命令 — 应用管理器

**源码**：`src-tauri/src/adb/apps.rs`

---

### `list_packages`

返回设备上所有已安装应用包的列表。

```typescript
invoke("list_packages", { serial: string }): Promise<PackageInfo[]>
```

| 参数 | 类型 | 描述 |
|------|------|------|
| `serial` | `string` | 设备序列号 |

**返回值**：`PackageInfo` 数组，排序规则为：user → product → vendor → system，然后按 `is_hidden`（可见优先），再在每个分组内按字母顺序排列。

**实现**（通过 `tokio::try_join!` 并行执行 4 个 `pm` 命令）：
1. `pm list packages -u -f` — 主列表：所有包（含 user 0 未安装的隐藏包），带 APK 路径。
2. `pm list packages -f` — 已安装集合：当前为 user 0 已安装的包，带 APK 路径。
3. `pm list packages -3` — 第三方集合：仅包名，不带路径。
4. `pm list packages -d` — 已禁用集合：已显式禁用的包名。

交叉引用：
- `is_hidden = package_name NOT IN installed_set`（出现在 `-u` 中但不在常规 `-f` 中）
- `is_system = package_name NOT IN third_party_set`
- `is_disabled = package_name IN disabled_set`
- `app_type` = 根据 `apk_path` 前缀分类（参见 [`PackageInfo`](#packageinfo)）

**错误**：若任一 `pm` 命令执行失败则拒绝。

---

### `uninstall_package`

从设备上卸载或禁用一个应用包。

```typescript
invoke("uninstall_package", {
  serial: string,
  package: string,
  isSystem: boolean,
  isRoot: boolean,
}): Promise<string>
```

| 参数 | 类型 | 描述 |
|------|------|------|
| `serial` | `string` | 设备序列号 |
| `package` | `string` | 包名，例如 `"com.example.app"` |
| `isSystem` | `boolean` | 是否为系统应用（决定卸载方式） |
| `isRoot` | `boolean` | 设备是否以 root 身份运行 adbd |

**返回值**：卸载命令的合并 stdout+stderr（例如 `"Success"`、`"Deleted 1 APKs"`）。

**方法选择**：

| 条件 | 命令 | 效果 |
|------|------|------|
| `!isSystem` | `adb -s {serial} uninstall {package}` | 完全移除用户安装的应用及其数据 |
| `isSystem && isRoot` | `adb -s {serial} shell pm uninstall {package}` | 完全移除系统应用（永久性，需要 root） |
| `isSystem && !isRoot` | `adb -s {serial} shell pm uninstall -k --user 0 {package}` | 为当前用户软禁用该应用；不移除 APK |

**错误**：若命令以非零退出码退出**且**输出中不包含 `"success"`（不区分大小写）则拒绝。某些设备固件返回非零但输出中包含 `"success"` — 这类情况被视为成功。

---

### `install_apk`

将本地机器上的 APK 文件安装到设备上。

```typescript
invoke("install_apk", { serial: string, apkPath: string }): Promise<void>
```

| 参数 | 类型 | 描述 |
|------|------|------|
| `serial` | `string` | 设备序列号 |
| `apkPath` | `string` | APK 文件的本地绝对路径 |

**返回值**：成功时返回 `void`。

**实现**：运行 `adb -s {serial} install -r {apkPath}`。`-r` 标志允许重新安装/升级已有应用。

**错误**：若 `adb install` 以非零退出码退出则拒绝。

---

### `force_stop_package`

强制停止正在运行的应用进程。

```typescript
invoke("force_stop_package", { serial: string, package: string }): Promise<void>
```

| 参数 | 类型 | 描述 |
|------|------|------|
| `serial` | `string` | 设备序列号 |
| `package` | `string` | 包名，例如 `"com.example.app"` |

**实现**：运行 `adb -s {serial} shell am force-stop {package}`。

**说明**：等效于从最近应用界面杀死应用。之后可以正常重新启动应用。对任何类型的应用都是安全的。

**错误**：若命令以非零退出码退出则拒绝。

---

### `clear_package_data`

清除应用包的所有数据（偏好设置、数据库、缓存）。

```typescript
invoke("clear_package_data", { serial: string, package: string }): Promise<string>
```

| 参数 | 类型 | 描述 |
|------|------|------|
| `serial` | `string` | 设备序列号 |
| `package` | `string` | 包名 |

**返回值**：`pm clear` 的输出，例如 `"Success"`。

**实现**：运行 `adb -s {serial} shell pm clear {package}`。检查输出中是否包含 `"success"`（不区分大小写）。

**说明**：将应用重置为出厂初始状态。数据无法恢复。对任何类型的应用都是安全的。

**错误**：若命令失败或输出中不包含 `"success"` 则拒绝。

---

### `re_enable_package`

重新启用之前通过 `pm uninstall -k --user 0` 隐藏的应用包。

```typescript
invoke("re_enable_package", { serial: string, package: string }): Promise<string>
```

| 参数 | 类型 | 描述 |
|------|------|------|
| `serial` | `string` | 设备序列号 |
| `package` | `string` | 隐藏包的包名 |

**返回值**：`pm install-existing` 的输出。

**实现**：运行 `adb -s {serial} shell pm install-existing --user 0 {package}`。检查输出中是否包含 `"installed for user"`。

**说明**：仅适用于 `is_hidden = true` 的包。重新启用后，该包恢复为正常已安装状态，并重新出现在启动器中。

**错误**：若命令失败或输出中不包含 `"installed for user"` 则拒绝。

---

## 8. 命令 — 屏幕镜像（scrcpy）

**源码**：`src-tauri/src/adb/scrcpy.rs`

---

### `start_scrcpy`

为设备启动 scrcpy 屏幕镜像。

```typescript
invoke("start_scrcpy", { serial: string, config: ScrcpyConfig }): Promise<void>
```

| 参数 | 类型 | 描述 |
|------|------|------|
| `serial` | `string` | 设备序列号 |
| `config` | `ScrcpyConfig` | scrcpy 启动选项（所有字段均为可选） |

**返回值**：立即返回 `void`（scrcpy 作为独立窗口运行）。

**副作用**：
- 若此序列号的 scrcpy 已在运行，会先将其终止（自动停止上一个）。
- 成功启动时发送 [`scrcpy_state`](#scrcpy_state) `{ serial, running: true }`。
- 生成一个后台任务，监控 scrcpy 退出，并在退出时发送 `{ serial, running: false }`。

**实现**：
- 通过 `scrcpy_path()` 解析 scrcpy 二进制文件：bundled `resources/scrcpy/scrcpy.exe` → Scoop/Chocolatey 安装路径 → PATH 上的裸 `"scrcpy"`。
- 生成 `scrcpy -s {serial} --window-title "DevBridge - {serial}"` 加上所有已启用的配置标志。
- PID 存储在 `SCRCPY_PROCESSES: Lazy<Mutex<HashMap<String, u32>>>` 中。
- 通过 `cmd()` 辅助函数使用 `CREATE_NO_WINDOW` 标志，避免在 Windows 上出现控制台闪烁。

**错误**：若找不到 scrcpy，则以 `"scrcpy not found. Install from https://github.com/Genymobile/scrcpy and ensure it is on PATH, then restart DevBridge."` 拒绝；其他生成失败则以 `"Failed to start scrcpy: ..."` 拒绝。

---

### `stop_scrcpy`

停止设备的 scrcpy 实例。

```typescript
invoke("stop_scrcpy", { serial: string }): Promise<void>
```

| 参数 | 类型 | 描述 |
|------|------|------|
| `serial` | `string` | 设备序列号 |

**返回值**：`void`。若此序列号的 scrcpy 未在运行，不报错。

**实现**：从 `SCRCPY_PROCESSES` 中移除 PID，并通过 `taskkill /F /T /PID` 终止进程树。

**副作用**：发送 [`scrcpy_state`](#scrcpy_state) `{ serial, running: false }`。

---

### `is_scrcpy_running`

检查设备的 scrcpy 当前是否正在运行。

```typescript
invoke("is_scrcpy_running", { serial: string }): Promise<boolean>
```

| 参数 | 类型 | 描述 |
|------|------|------|
| `serial` | `string` | 设备序列号 |

**返回值**：若此序列号已注册 scrcpy PID 则为 `true`，否则为 `false`。

**说明**：这是一个同步（非 async）Tauri 命令。它只检查内存中的 PID 注册表 — 不验证进程是否仍然存活。

---

#### 远程控制面板

`ScreenMirrorPanel.tsx` 包含一个远程控制面板（方向键、Home、返回、菜单、音量+/音量-、电源键），与 scrcpy 设置一起渲染。每个按钮通过现有的 `runShellCommand(serial, command)` 封装发送 `input keyevent <code>` — 不需要新的后端命令。未选择 ADB 设备时面板禁用。

远程控制 UI 实现于共享组件 `src/components/shared/RemoteControlPanel.tsx`，OHOS 屏幕镜像面板也使用同一组件。

---

#### 设备断开时自动清理

设备监听器（`device.rs::start_device_watcher`）将当前设备列表与上次轮询结果进行比较。当某个设备序列号消失时，生成 `scrcpy::stop(serial)` 以关闭 scrcpy 窗口。这能处理意外断开的情况（拔线、重启），以及 UI 主动断开的情况。

---

## 9. 事件（后端 → 前端）

事件由 Rust 后端通过 `app.emit()` 发送，前端通过 `listen()` 订阅。

---

### `devices_changed`

当设备列表变化时，或新连接设备的 `attempt_root_and_remount` 完成后，由设备监听器发送。

```typescript
listen("devices_changed", (event: { payload: AdbDevice[] }) => { ... })
```

**载荷**：`AdbDevice[]` — 当前完整的设备列表。

**触发条件**：
- 任意设备连接或断开
- 设备在状态之间转换（例如 `"offline"` → `"device"`）
- `attempt_root_and_remount` 完成后（以更新 `is_root`/`is_remounted`）

---

### `shell_output`

由 `start_shell_stream` 在每次从运行中的进程读取到一块 stdout 或 stderr 时发送。

```typescript
listen("shell_output", (event: { payload: ShellOutput }) => { ... })
```

**载荷**：`ShellOutput { serial, data }`

**说明**：对于高吞吐量命令，每秒可能发送多个事件。前端使用基于 `requestAnimationFrame` 的批处理，将更新合并为每帧最多一次 React 状态更新（约 60fps）。

---

### `shell_exit`

当 shell 流进程退出时发送（自然退出或调用 `stop_shell_stream` 后）。

```typescript
listen("shell_exit", (event: { payload: ShellExit }) => { ... })
```

**载荷**：`ShellExit { serial, code }`

**说明**：`code: -1` 表示无法确定退出码（例如进程被强制终止）。常见退出码：`0` = 成功，`127` = 命令未找到。

---

### `logcat_lines`

由 `start_logcat` 以已解析日志条目的批次方式发送。

```typescript
listen("logcat_lines", (event: { payload: LogcatBatch }) => { ... })
```

**载荷**：`LogcatBatch { serial, entries }` — 每批次包含 1 到 64 条条目。

**说明**：仅包含通过传递给 `start_logcat` 的 `LogcatFilter` 的条目。批次在达到 64 条或经过 50ms 时刷新，以先到者为准。

---

### `tlogcat_lines`

由 `start_tlogcat` 以批次方式发送。语义与 `logcat_lines` 相同，但不应用服务端级别过滤。

```typescript
listen("tlogcat_lines", (event: { payload: LogcatBatch }) => { ... })
```

**载荷**：`LogcatBatch { serial, entries }`

**说明**：除 stdout 外，tlogcat 也会管道捕获 stderr。任何 stderr 行都会以错误级别（`"E"`）、标签为 `"tlogcat-stderr"` 的条目发送，确保 tlogcat 错误消息（例如命令未找到、权限被拒绝）出现在日志流中而不会静默丢失。

---

### `transfer_progress`

在 `push_files` 和 `pull_file` 操作期间发送。

```typescript
listen("transfer_progress", (event: { payload: TransferProgress }) => { ... })
```

**载荷**：`TransferProgress`

**说明**：进度从匹配 `[ 42%]` 的 `adb` stderr 行中解析。成功时发送 `percent: 100.0` 的最终事件；失败时改为发送 `percent: -1.0` 且 `speed: "failed"` 的事件。`push_files` 调用中的多个文件各自拥有独立的 UUID `id`。

---

### `scrcpy_state`

当设备的 scrcpy 实例启动或停止时发送。

```typescript
listen("scrcpy_state", (event: { payload: ScrcpyState }) => { ... })
```

**载荷**：`ScrcpyState { serial, running }`

**触发条件**：
- `start_scrcpy` 成功启动 scrcpy → `running: true`
- scrcpy 进程退出（用户关闭窗口、设备断开连接，或调用了 `stop_scrcpy`）→ `running: false`
- 设备从设备监听器轮询中消失 → 自动调用 `stop_scrcpy` → `running: false`

---

## 10. 命令 — 本地脚本执行

这些命令并非 ADB 专属 — 它们在宿主机上执行脚本。当快捷命令面板中的命令设置了 `scriptPath` 时使用。

### `run_local_script`

运行本地脚本（.bat、.cmd、.ps1、.sh）并通过事件流式传输其输出。

**Rust 签名：**
```rust
#[tauri::command]
async fn run_local_script(id: String, script_path: String, app: AppHandle) -> Result<(), String>
```

**前端调用：**
```typescript
import { runLocalScript } from "../utils/script";
await runLocalScript(deviceId, "/path/to/script.bat");
```

**参数：** `id` — 调用方提供的标识符（通常为设备 ID），用于关联输出事件。`script_path` — 脚本文件的绝对路径。

**发送的事件：**
- `script_output` — `{ id: string, data: string }` — stdout/stderr 块
- `script_exit` — `{ id: string, code: number }` — 进程退出码

**说明：** 在 Windows 上，脚本通过 `cmd /C <script_path>` 执行。每个 `id` 同一时间只能运行一个脚本 — 启动新脚本会终止上一个。

### `stop_local_script`

通过 id 停止正在运行的脚本。

**Rust 签名：**
```rust
#[tauri::command]
async fn stop_local_script(id: String) -> Result<(), String>
```

**前端调用：**
```typescript
import { stopLocalScript } from "../utils/script";
await stopLocalScript(deviceId);
```

---

## 11. 前端工具函数封装

所有封装均位于 `src/utils/adb.ts`，是带 TypeScript 类型的精简 `invoke()` 调用。

```typescript
import {
  getDevices,
  connectNetworkDevice,
  disconnectDevice,
  listFiles,
  pushFiles,
  pullFile,
  deleteFile,
  runShellCommand,
  startShellStream,
  stopShellStream,
  startLogcat,
  stopLogcat,
  startTlogcat,
  stopTlogcat,
  clearDeviceLog,
  exportLogs,
  listPackages,
  uninstallPackage,
  installApk,
  forceStopPackage,
  clearPackageData,
  reEnablePackage,
  startScrcpy,
  stopScrcpy,
  isScrcpyRunning,
} from "../utils/adb";
```

| 封装函数 | 对应命令 |
|----------|----------|
| `getDevices()` | `get_devices` |
| `connectNetworkDevice(host, port)` | `connect_network_device` |
| `disconnectDevice(serial)` | `disconnect_device` |
| `listFiles(serial, path)` | `list_files` |
| `pushFiles(serial, localPaths, remotePath)` | `push_files` |
| `pullFile(serial, remotePath, localPath)` | `pull_file` |
| `deleteFile(serial, path)` | `delete_file` |
| `runShellCommand(serial, command)` | `run_shell_command` |
| `startShellStream(serial, command)` | `start_shell_stream` |
| `stopShellStream(serial)` | `stop_shell_stream` |
| `startLogcat(serial, filter)` | `start_logcat` |
| `stopLogcat(serial)` | `stop_logcat` |
| `startTlogcat(serial)` | `start_tlogcat` |
| `stopTlogcat(serial)` | `stop_tlogcat` |
| `clearDeviceLog(serial)` | `clear_device_log` |
| `exportLogs(logs, path)` | `export_logs` |
| `listPackages(serial)` | `list_packages` |
| `uninstallPackage(serial, pkg, isSystem, isRoot)` | `uninstall_package` |
| `installApk(serial, apkPath)` | `install_apk` |
| `forceStopPackage(serial, pkg)` | `force_stop_package` |
| `clearPackageData(serial, pkg)` | `clear_package_data` |
| `reEnablePackage(serial, pkg)` | `re_enable_package` |
| `startScrcpy(serial, config)` | `start_scrcpy` |
| `stopScrcpy(serial)` | `stop_scrcpy` |
| `isScrcpyRunning(serial)` | `is_scrcpy_running` |

**脚本封装函数**（位于 `src/utils/script.ts`）：

| 封装函数 | 对应命令 |
|----------|----------|
| `runLocalScript(id, scriptPath)` | `run_local_script` |
| `stopLocalScript(id)` | `stop_local_script` |

---

## 12. 错误处理

所有 Tauri 命令在 Rust 端均返回 `Result<T, String>`，映射到前端的 rejected Promise。拒绝值始终为包含可读信息的普通字符串。

**推荐模式：**

```typescript
try {
  await someAdbCommand(...);
} catch (e) {
  message.error(String(e));
}
```

**常见错误信息：**

| 情况 | 错误字符串 |
|------|-----------|
| `adb` 二进制文件未找到或崩溃 | `"Failed to run adb: ..."` |
| shell 命令非零退出 | `"adb shell {cmd} failed: {stderr}{stdout}"` |
| logcat 已在运行 | `"Logcat already running for this device"` |
| tlogcat 已在运行 | `"tlogcat already running for this device"` |
| 无活跃 shell 流 | `"No shell stream running for this device"` |
| 无活跃 logcat | `"No logcat running for this device"` |
| 文件推送/拉取失败 | `"adb push/pull failed for {filename}"` |
| 日志导出写入失败 | `"Failed to write log file: ..."` |

**关于 `run_shell_command` 的说明**：此命令在非零退出时拒绝。对于退出码预期为非零但输出仍有用的命令（例如 `grep` 未找到匹配项），可使用带 try/catch 的 `run_shell_command` 并检查错误字符串中的输出内容。
