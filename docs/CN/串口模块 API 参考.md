# 串口模块 — API 参考

> **项目**: Bridge
> **模块**: 串口（`src-tauri/src/serial/`、`src/utils/serial.ts`、`src/utils/fs.ts`）
> **最后更新**: 2026-03

本文档是串口模块的完整 API 参考，涵盖所有暴露给前端的 Tauri 命令、所有后端到前端的事件、全部共享数据类型，以及前端状态管理模型。未通过 IPC 暴露的内部 Rust 辅助函数不在本文档范围内。

---

## 目录

1. [IPC 机制](#1-ipc-机制)
2. [数据类型](#2-数据类型)
3. [命令 — 端口管理](#3-命令--端口管理)
4. [命令 — 数据读写](#4-命令--数据读写)
5. [命令 — 文件工具](#5-命令--文件工具)
6. [事件（后端 → 前端）](#6-事件后端--前端)
7. [前端工具封装](#7-前端工具封装)
8. [前端状态管理](#8-前端状态管理)
9. [错误处理](#9-错误处理)

---

## 1. IPC 机制

所有串口命令均遵循 Tauri IPC 模式：

- **前端 → 后端**：`invoke("command_name", { ...args })` — 返回一个 `Promise`，成功时 resolve 为命令返回值，失败时 reject 为错误字符串。
- **后端 → 前端**：`app.emit("event_name", payload)` — 推送事件，前端通过 `listen()` 订阅。

串口命令在 Rust 侧**并非**真正异步（它们通过全局 `Mutex` 操作同步 I/O），但为了满足 Tauri 命令模型的要求，仍声明为 `async fn`。实际 I/O 在每个端口各自独立的 `std::thread` 上执行。

---

## 2. 数据类型

### `SerialDataEvent`

每当从已打开的串口**或** Telnet 会话接收到字节时触发。两种连接类型共用同一事件。

```rust
#[derive(Clone, Serialize)]
pub struct SerialDataEvent {
    pub port: String,  // 端口名称（如 "COM3"）或 Telnet 会话 ID（如 "192.168.1.1:23"）
    pub data: String,  // 接收到的字节，以 UTF-8（宽松模式）解码（无效序列替换为 U+FFFD）
}
```

```typescript
interface SerialDataEvent {
  port: string;  // COM 端口名或 Telnet 会话的 "host:port"
  data: string;  // 接收到的文本块（可能跨越多行）
}
```

**说明：**
- `data` 是原始数据块，不是单行。根据所连设备的不同，其中可能包含多个换行符、不完整的行或 ANSI 转义码。
- 编码采用 UTF-8 宽松模式：无效字节序列将被静默替换。不支持原始二进制数据。
- 对于 Telnet 会话，Telnet IAC 控制序列在触发事件前会被剥除（参见 [`open_telnet_session`](#open_telnet_session)）。

---

### `ConnectedDevice`（串口变体）

设备 store 中表示已连接的串口或 Telnet 设备的数据结构。这不是 Rust 类型，完全在前端构造。

```typescript
interface ConnectedDevice {
  id: string;      // COM 端口名（如 "COM3"）或 Telnet 的 "host:port"（如 "192.168.1.1:23"）
  type: "serial";
  name: string;    // 用户自定义标签，若未设置则回退为 id
  serial: string;  // 与 id 相同
  state: "connected";
}
```

---

### `QuickCommand`

快捷命令面板中保存的命令。由 `commandStore` Zustand store 管理（持久化到 `bridge-commands`）。

```typescript
type DeviceType = "adb" | "ohos" | "serial";

interface QuickCommand {
  id: string;             // 唯一 ID（基于 Date.now() 生成）
  label: string;          // 按钮上显示的标签
  command: string;        // 发送给设备的原始字符串
  sequenceOrder?: number; // undefined = 不参与序列执行器；1、2、3、… = 执行顺序
  scriptPath?: string;    // 若设置，则执行本地脚本而非发送设备命令
}
```

命令按设备类型存储（`commandsByType: { adb, ohos, serial }`），每种类型各自维护独立列表。脚本（.bat、.cmd、.ps1、.sh）可通过文件选择器添加，在宿主机上通过 `cmd /C <script>` 本地执行，输出流式传输到 Shell 面板。

---

## 3. 命令 — 端口管理

### `list_serial_ports`

返回系统当前所有可用串口，COM 端口按数字顺序排列（`COM3` 在 `COM10` 之前），其他端口按字典序排列。

**Rust 签名：**
```rust
#[tauri::command]
fn list_serial_ports() -> Result<Vec<String>, String>
```

**前端调用：**
```typescript
invoke<string[]>("list_serial_ports")
```

**返回值：** `string[]` — 端口名称列表（如 `["COM3", "COM7", "COM10"]`）。

**错误：** 若 `serialport::available_ports()` 失败（如驱动错误），返回错误字符串。

**说明：**
- 该命令在 Rust 侧为同步执行（非 async），返回结果反映调用瞬间的端口状态。
- COM 端口数字排序通过自定义比较器实现 — `COM3 < COM10`，而非操作系统默认的字典序（字典序会产生 `COM10 < COM3`）。

---

### `open_telnet_session`

通过 TCP（Telnet）连接到远程主机，并启动后台读取循环，持续触发 `serial_data` 事件 — 从前端角度来看，其行为与 COM 端口会话完全一致。

**Rust 签名：**
```rust
#[tauri::command]
async fn open_telnet_session(host: String, port: u16, app: AppHandle) -> Result<(), String>
```

**前端调用：**
```typescript
invoke("open_telnet_session", { host, port })
```

**参数：**

| 参数 | 类型 | 描述 |
|------|------|------|
| `host` | `string` | IP 地址或主机名，如 `"192.168.1.100"` |
| `port` | `u16` | TCP 端口（标准 Telnet 默认为 `23`） |

**返回值：** 成功时返回 `void`。

**错误：**
- 连接被拒绝 / 主机不可达 — 来自 `TcpStream::connect` 的错误信息。
- 主机可解析但连接超时（适用操作系统默认 TCP 超时）。

**行为：**
1. 在 `tokio::task::spawn_blocking` 内调用 `TcpStream::connect("{host}:{port}")`，避免阻塞异步运行时。
2. 在 socket 上设置 100 ms 读取超时。
3. 克隆流 — 原始流存储到 `TELNET_SESSIONS` 用于写入；克隆传递给读取线程。
4. 创建 `Arc<AtomicBool>` 停止标志，存储到 `TELNET_FLAGS`。
5. 启动运行 `telnet_read_loop` 的 `std::thread`。

**Telnet IAC 协商：**
读取循环在触发数据事件前，会剥除 RFC 854 Telnet 控制序列：

| 接收内容 | 发送响应 | 数据效果 |
|----------|----------|----------|
| `IAC WILL x` | `IAC DONT x` | 被剥除 |
| `IAC DO x` | `IAC WONT x` | 被剥除 |
| `IAC WONT x` / `IAC DONT x` | 无 | 被剥除 |
| `IAC SB … IAC SE` | 无 | 整块被剥除 |
| `IAC IAC` | 无 | 作为字面量 `0xFF` 输出 |

这已足够支持所有常见的串口转 TCP 适配器（ser2net、HW VSP、Lantronix）。不支持完整的 RFC 2217（远程波特率/流控）。

**内部全局变量：**
```rust
static TELNET_SESSIONS: Lazy<Mutex<HashMap<String, Arc<Mutex<TcpStream>>>>>
static TELNET_FLAGS:    Lazy<Mutex<HashMap<String, Arc<AtomicBool>>>>
```

---

### `open_serial_port`

以指定波特率打开串口，并启动后台读取循环，持续触发 `serial_data` 事件。

**Rust 签名：**
```rust
#[tauri::command]
async fn open_serial_port(port_name: String, baud_rate: u32, app: AppHandle) -> Result<(), String>
```

**前端调用：**
```typescript
invoke("open_serial_port", { portName, baudRate })
```

**参数：**

| 参数 | 类型 | 描述 |
|------|------|------|
| `portName` | `string` | 端口名称，如 `"COM3"` |
| `baudRate` | `number` | 波特率，如 `115200` |

**返回值：** 成功时返回 `void`。

**错误：**
- 端口已被其他应用程序占用。
- 端口不存在（驱动未安装、设备已拔出）。
- `port.try_clone()` 失败 — 该端口不支持克隆（罕见，取决于驱动）。

**行为：**
1. 通过 `serialport::new(port_name, baud_rate).timeout(100ms).open()` 打开端口。
2. 克隆端口句柄 — 原始句柄存储到 `OPEN_PORTS` 用于写入；克隆传递给读取线程。
3. 创建 `Arc<AtomicBool>` 停止标志，存储到 `READER_FLAGS`。
4. 启动运行阻塞读取循环（`read_loop`）的 `std::thread`。

**串口配置默认值：**

| 设置项 | 值 |
|--------|----|
| 数据位 | 8 |
| 停止位 | 1 |
| 校验位 | 无 |
| 流控制 | 无 |
| 读取超时 | 100 ms |

高级设置（数据位、停止位、校验位、流控制）目前无法通过 UI 配置；`serialport` crate 默认采用 8N1、无流控制。

**内部全局变量：**
```rust
// 以端口名为键的端口句柄 — 用于写入
static OPEN_PORTS: Lazy<Mutex<HashMap<String, Box<dyn SerialPort + Send>>>>

// 以端口名为键的停止标志 — 通知读取循环退出
static READER_FLAGS: Lazy<Mutex<HashMap<String, Arc<AtomicBool>>>>
```

---

### `close_serial_port`

关闭已打开的串口，停止其后台读取循环。

**Rust 签名：**
```rust
#[tauri::command]
async fn close_serial_port(port_name: String) -> Result<(), String>
```

**前端调用：**
```typescript
invoke("close_serial_port", { portName })
```

**参数：**

| 参数 | 类型 | 描述 |
|------|------|------|
| `portName` | `string` | 要关闭的端口名称 |

**返回值：** 成功时返回 `void`。

**错误：** 若 `OPEN_PORTS` 互斥锁中毒（正常运行下不应发生），返回错误字符串。

**行为：**
1. 将停止标志（COM 端口对应 `READER_FLAGS`，Telnet 对应 `TELNET_FLAGS`）设置为 `true`。读取线程在循环开头检查此标志，并在下一次迭代时退出。
2. 从 `OPEN_PORTS`（COM）或 `TELNET_SESSIONS`（Telnet）中移除该会话。

**说明：** 读取线程在停止标志被设置后异步退出。在线程退出前，可能还会有一次最终的 `serial_data` 事件，来自线程缓冲区中已有的数据。

---

## 4. 命令 — 数据读写

### `write_serial`

向已打开的串口写入字符串。

**Rust 签名：**
```rust
#[tauri::command]
async fn write_serial(port_name: String, data: String) -> Result<(), String>
```

**前端调用：**
```typescript
invoke("write_serial", { portName, data })
```

**参数：**

| 参数 | 类型 | 描述 |
|------|------|------|
| `portName` | `string` | 要写入的端口名称 |
| `data` | `string` | 要发送的字符串数据（UTF-8 编码） |

**返回值：** 成功时返回 `void`。

**错误：**
- `"Port not open"` — 会话 ID 在 `OPEN_PORTS`（COM）和 `TELNET_SESSIONS`（Telnet）中均不存在。
- 任何操作系统级别的写入错误字符串（如写入过程中端口断开）。

**说明：**
- 数据通过 `port.write_all(data.as_bytes())` 以原始 UTF-8 字节写入。
- **不会自动追加行尾符。** 调用方需自行在 `data` 中包含 `\r\n`（或其他行尾符）。Shell 标签页的 `handleCommand` 会在调用此命令前追加 `\r\n`；快捷命令同样会追加 `\r\n`。
- 写入操作为同步（阻塞）模式，但在 tokio 线程池中执行。在常见波特率（≤921600 bps）下，写入在微秒级完成，不会造成可见的 UI 延迟。

---

## 5. 命令 — 文件工具

这些命令用于绕过 `tauri-plugin-fs` 的作用域限制 — 该插件要求为用户选择的路径配置明确的权限作用域，而 Rust 后端拥有不受限的文件系统访问权限。这些命令仅供 `ShellPanel` 用于日志导出和日志写入文件功能。

### `write_text_file_to_path`

创建或截断文件，并将文本内容写入其中。

**Rust 签名：**
```rust
#[tauri::command]
async fn write_text_file_to_path(path: String, content: String) -> Result<(), String>
```

**前端调用：**
```typescript
invoke("write_text_file_to_path", { path, content })
```

**参数：**

| 参数 | 类型 | 描述 |
|------|------|------|
| `path` | `string` | 目标文件的绝对路径 |
| `content` | `string` | 要写入的文本（UTF-8） |

**返回值：** 成功时返回 `void`。

**错误：** 操作系统 I/O 错误字符串（如权限拒绝、路径不存在）。

**用途：** 用户点击**导出快照**（保存当前缓冲区内容）时调用，或**写入日志文件**功能首次启用时调用（在开始流式写入前创建/截断日志文件）。

---

### `append_text_to_file`

以追加模式打开文件并写入文本，若文件不存在则创建。

**Rust 签名：**
```rust
#[tauri::command]
async fn append_text_to_file(path: String, content: String) -> Result<(), String>
```

**前端调用：**
```typescript
invoke("append_text_to_file", { path, content })
```

**参数：**

| 参数 | 类型 | 描述 |
|------|------|------|
| `path` | `string` | 目标文件的绝对路径 |
| `content` | `string` | 要追加的文本（UTF-8） |

**返回值：** 成功时返回 `void`。

**错误：** 操作系统 I/O 错误字符串（如权限拒绝）。

**用途：** 当某设备的日志写入文件功能处于激活状态时，每次调用 `writeToDeviceBuffer` 均会触发此命令。采用"触发即忘"模式（错误被静默忽略），以避免磁盘错误阻塞 UI。

---

## 6. 事件（后端 → 前端）

### `serial_data`

当已打开的串口接收到字节时，由读取循环线程触发。

**载荷（Payload）：** `SerialDataEvent`
```typescript
{ port: string; data: string }
```

**触发频率：** 每次 `read()` 调用成功返回 >0 字节时触发一次事件。读取循环使用 1024 字节缓冲区，超时为 100 ms。在 921600 bps 持续输出场景下，每秒最多约 100 个事件；前端的 RAF 批处理机制可确保渲染频率不超过约 60 次/秒。

**前端订阅：**
```typescript
// src/hooks/useSerialEvents.ts
export function useSerialData(handler: (event: SerialDataEvent) => void) {
  useEffect(() => {
    const unlisten = listen<SerialDataEvent>("serial_data", (e) => handler(e.payload));
    return () => { unlisten.then(fn => fn()); };
  }, [handler]);
}
```

**消费方：** `ShellPanel` — 将数据路由到匹配设备的 `writeToDeviceBuffer(device.id, event.data)`，无论当前选中的是哪个设备。

---

### `serial_disconnected`

当读取循环线程发生 I/O 错误时触发（如 USB 线拔出、设备断电）。

**载荷（Payload）：** `string` — 端口名称（如 `"COM3"`）。

**前端订阅：**
```typescript
// src/hooks/useSerialEvents.ts
export function useSerialDisconnect(handler: (port: string) => void) {
  useEffect(() => {
    const unlisten = listen<string>("serial_disconnected", (e) => handler(e.payload));
    return () => { unlisten.then(fn => fn()); };
  }, [handler]);
}
```

**消费方：** `useSerialDisconnect` hook（在 `App.tsx` 中注册）— 从 `deviceStore` 中移除对应设备。`ShellPanel` 的 `outputMap` 中已缓冲的输出内容会被保留并继续显示，直到用户清除或重新连接。

**说明：** 该事件由读取循环线程触发，而非命令处理器。超时错误（`ErrorKind::TimedOut`）会被静默重试，**不会**触发此事件。

---

## 7. 前端工具封装

位于 `src/utils/serial.ts` 和 `src/utils/fs.ts`。

### `serial.ts`

```typescript
import { invoke } from "@tauri-apps/api/core";

/** Returns all available port names, sorted numerically for COM ports. */
export async function listPorts(): Promise<string[]> {
  return invoke<string[]>("list_serial_ports");
}

/** Opens a serial port at the given baud rate and starts the read loop. */
export async function openPort(portName: string, baudRate: number): Promise<void> {
  return invoke("open_serial_port", { portName, baudRate });
}

/** Connects to a Telnet host and starts the read loop. Session ID is "host:port". */
export async function openTelnetSession(host: string, port: number): Promise<void> {
  return invoke("open_telnet_session", { host, port });
}

/** Stops the read loop and closes the port or Telnet session. */
export async function closePort(portName: string): Promise<void> {
  return invoke("close_serial_port", { portName });
}

/**
 * Writes data to an open serial port.
 * Callers must include line endings in `data` (e.g. append "\r\n" for AT commands).
 */
export async function writeToPort(portName: string, data: string): Promise<void> {
  return invoke("write_serial", { portName, data });
}
```

### `fs.ts`

```typescript
import { invoke } from "@tauri-apps/api/core";

/** Creates or truncates a file and writes `content` to it. */
export async function writeTextFileTo(path: string, content: string): Promise<void> {
  return invoke("write_text_file_to_path", { path, content });
}

/** Appends `content` to an existing file (creates it if absent). */
export async function appendTextToFile(path: string, content: string): Promise<void> {
  return invoke("append_text_to_file", { path, content });
}
```

---

## 8. 前端状态管理

### 设备 Store（`deviceStore.ts`）

串口设备与 ADB 设备共用同一 Zustand store，通过 `type: "serial"` 加以区分。

| 操作 | 触发时机 |
|------|----------|
| `addDevice(device)` | `openPort` 成功后在 `ConnectModal` 中调用 |
| `removeDevice(id)` | `serial_disconnected` 事件触发时在 `useSerialDisconnect` 处理器中调用 |
| `setSelectedDeviceId(id)` | 用户在侧边栏点击设备时调用 |

### Shell 输出缓冲区（`ShellPanel.tsx`）

所有缓冲区状态以设备 ID 为键，存储在 `ShellPanel` 内部的 `useRef` 映射中。这样即可在设备切换时保留数据，无需使用全局 store。

```typescript
const outputMap  = useRef<Record<string, string>>({});         // 每设备的终端输出
const inputMap   = useRef<Record<string, string>>({});         // 每设备的待发送输入
const runningMap = useRef<Record<string, boolean>>({});        // 每设备的 ADB 进程运行状态
const logFileMap = useRef<Record<string, string | null>>({});  // 每设备的活跃日志文件路径（null 表示未启用）
```

**`writeToDeviceBuffer(deviceId, text)`** 是核心写入辅助函数 — 所有传入数据均通过它流转：

```
serial_data event
      ↓
handleSerialData (finds device by port name)
      ↓
writeToDeviceBuffer(device.id, event.data)
      ├── outputMap[deviceId] += text  (trimmed to max lines)
      ├── if deviceId === selectedDeviceId → scheduleFlush()  (RAF batching → setOutput)
      └── if logFileMap[deviceId] is set  → appendTextToFile(path, text)
```

**RAF 批处理**（`scheduleFlush`）：使用 `requestAnimationFrame`，使同一帧（约 16 ms）内到达的多个 `serial_data` 事件合并为一次 `setOutput` 调用 — 无论事件频率如何，渲染次数上限约为 60 fps。

### 快捷命令 Store（`commandStore.ts`）

```typescript
interface CommandsByType {
  adb: QuickCommand[];
  ohos: QuickCommand[];
  serial: QuickCommand[];
}

interface CommandState {
  commandsByType: CommandsByType;
  addCommand: (deviceType: DeviceType, label: string, command: string) => void;
  addScript: (deviceType: DeviceType, label: string, scriptPath: string) => void;
  removeCommand: (deviceType: DeviceType, id: string) => void;
  setSequenceOrder: (deviceType: DeviceType, id: string, order: number | undefined) => void;
}
```

命令按设备类型存储，并通过 `zustand/middleware` 的 persist 中间件持久化到 `bridge-commands`。`QuickCommandsPanel` 会根据当前选中设备的类型自动选取对应列表。`sequenceOrder` 字段用于将命令纳入序列执行器。

### 序列执行器状态（`QuickCommandsPanel.tsx`）

每设备的序列状态存储在 `useRef<Map<string, SeqEntry>>` 中，而非 React state，以支持在不依赖当前选中设备的情况下在后台运行：

```typescript
interface SeqEntry {
  running: boolean;
  interval: number;       // 命令之间的间隔秒数
  currentLabel: string;   // 最后发送的命令的标签
  timeoutId?: ReturnType<typeof setTimeout>;
  index: number;          // 循环遍历按 sequenceOrder 排序的命令
  device: DeviceItem | null; // 在 startSequence() 时捕获的设备
}
```

React state（`seqRunning`、`seqInterval`、`seqCurrentLabel`）仅反映**当前选中**设备的条目，并在 `selectedDeviceId` 变化时从映射中同步更新。

步骤函数存储在 `useRef`（`runNextStepRef`）中，以确保 `setTimeout` 回调始终调用最新版本，避免闭包过时问题：

```
startSequence()
  └── capture selectedDevice → SeqEntry.device
  └── runNextStepRef.current(deviceId)
        ├── send command to SeqEntry.device (not selectedDevice)
        ├── update SeqEntry.currentLabel
        └── setTimeout(() => runNextStepRef.current(deviceId), interval * 1000)
```

---

## 9. 错误处理

| 场景 | 后端行为 | 前端行为 |
|------|----------|----------|
| 端口打开失败（被占用 / 不存在） | 返回 `Err(message)` | `ConnectModal` 显示 `message.error(String(e))` |
| Telnet 连接失败（被拒绝 / 不可达） | 返回 `Err("Failed to connect to host:port: ...")` | `ConnectModal` 显示 `message.error(String(e))` |
| 端口写入失败（写入中途断开） | 返回 `Err(message)` | Shell 标签页在输出区域显示 `Error: {e}` |
| 读取过程中端口断开 | 读取循环触发 `serial_disconnected` 后退出 | `useSerialDisconnect` 从 store 中移除设备 |
| 序列执行器：设备已被移除 | `SeqEntry.device` 已过时，但命令仍会尝试执行 — `writeToPort` / `startShellStream` 将失败 | 错误行出现在该设备的输出缓冲区中；下一步仍会被调度。用户须手动按停止键。 |
| 日志文件写入失败 | `appendTextToFile` 错误被静默忽略（`.catch(() => {})`） | 不通知用户 — 日志写入文件指示器保持激活状态 |
| `list_serial_ports` 失败 | 返回 `Err(message)` | `ConnectModal` 静默忽略错误（端口列表保持为空） |

---

*本文档涵盖设计文档 v1.8 中的串口模块。*
