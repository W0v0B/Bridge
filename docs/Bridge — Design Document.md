# Bridge — Design Document

> **Project Name**: Bridge
> **Document Version**: v2.0
> **Author**: Personal Project
> **Tech Stack**: Tauri 2 + Rust + React + TypeScript
> **Last Updated**: 2026-03

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Requirements](#2-requirements)
3. [System Architecture](#3-system-architecture)
4. [Module Design](#4-module-design)
5. [Data Design](#5-data-design)
6. [UI Layout Design](#6-ui-layout-design)
7. [Technology Stack](#7-technology-stack)
8. [Development Plan](#8-development-plan)
9. [Directory Structure](#9-directory-structure)

---

## 1. Project Overview

### 1.1 Background

During Android development and embedded device debugging, developers frequently need to open a terminal and manually run `adb` commands for device management, file transfer, and log collection, while also using serial tools to communicate with hardware. Existing tools (such as SSCOM and Android Device Monitor) are fragmented and lack an integrated, visual solution.

### 1.2 Goals

Build a Windows desktop debugging tool that unifies ADB device management, OpenHarmony (OHOS) device management, and serial/Telnet debugging in a single interface, reducing repetitive operations, improving debugging efficiency, and making it easy to share with teammates.

### 1.3 Core Value

- Visually manage ADB-connected Android devices without manually typing commands
- Visually manage HDC-connected OHOS devices (HarmonyOS / OpenHarmony)
- Support multi-file batch transfer with real-time progress display
- One-click logcat / HiLog collection, filtering, and export
- Integrated serial terminal with Telnet support and a quick-command panel (inspired by SSCOM's extension feature)
- Persistent configuration so frequently used settings and commands don't need to be re-entered

---

## 2. Requirements

### 2.1 Functional Requirements

#### ADB Module

| Feature | Description | Priority |
|---------|-------------|----------|
| Device List | Real-time display of connected ADB devices (USB + network) with hot-plug detection | P0 |
| ~~Device Info~~ | ~~Show device model, Android version, serial number, battery, etc.~~ | ~~Dropped~~ |
| File Manager | Visual browsing of the device file system; supports upload, download, and delete | P0 |
| Batch Transfer | Multi-file / folder drag-and-drop transfer with real-time progress bar | P0 |
| Log Collection | Real-time logcat output with Tag/Level filtering and export support | P0 |
| App Manager | Visual list of installed apps (user + system); install APK, uninstall/disable per app | P1 |
| ADB Commands | Built-in shortcuts for common ADB operations (screenshot, reboot, etc.) | P1 |
| Network ADB | Connect to a device over the network by entering an IP:Port | P1 |

#### Serial Module

| Feature | Description | Priority |
|---------|-------------|----------|
| Port Scan | Auto-scan and list available COM ports; COM ports sorted numerically (COM3 < COM10) | P0 |
| Serial Connect | Configure baud rate and connect via ConnectModal dialog; port list refreshed on modal open and on tab switch | P0 |
| Telnet Connect | Connect to a remote host:port over TCP (for serial-over-network adapters); shares the same Shell UI as COM ports | P1 |
| Shell I/O | Real-time send/receive in unified Shell tab (plain text display) | P0 |
| Quick Command Panel | Right-side panel for saving frequently used commands; click to send; supports add/delete; shared between ADB and serial | P0 |
| Sequence Runner | Per-device loop runner in Quick Commands panel; cycles through commands with a configurable interval; independent per device; survives device switching | P1 |
| Log Export | Snapshot export and continuous log-to-file toggle; both are per-device and independent | P1 |
| ~~HEX display mode~~ | ~~Toggle between HEX / ASCII display~~ | ~~Deferred~~ |
| ~~Send Settings~~ | ~~Configurable line ending, timed auto-send~~ | ~~Deferred~~ |

> **Design decision**: Serial uses the same Shell tab as ADB — no separate "Serial Terminal" tab. The Shell tab detects the selected device type and dispatches to the appropriate backend (ADB shell vs serial write). Line ending is hardcoded to `\r\n` for now; configurable suffix is deferred.

#### OHOS Module

| Feature | Description | Priority |
|---------|-------------|----------|
| Device List | Real-time display of connected OHOS devices (USB + TCP) with auto-connect; cross-references `hdc list targets` (authoritative) with `hdc list targets -v` (metadata) to filter phantom UART/loopback entries | P0 |
| File Manager | Visual browsing of device filesystem; supports upload, download, delete; remount status shown per device | P0 |
| HiLog | Real-time HiLog streaming with level/keyword filtering and export | P0 |
| Shell | Interactive shell via `hdc shell`; streaming output to unified Shell tab | P0 |
| App Manager | List all HAP bundles with install path and type classification (user/product/vendor/system); install HAP, uninstall user apps, force stop, clear data | P1 |
| Auto-Remount | Automatically runs `hdc target mount` on device connect; shows remount status in File Manager header | P1 |
| TCP Connect | Connect to OHOS device over TCP via `hdc tconn` using Host + Port inputs | P1 |

### 2.2 Non-Functional Requirements

- **Performance**: File transfers must not block the UI; log rendering must stay smooth (virtual scrolling)
- **Stability**: Auto-detect and notify on serial/ADB disconnection without crashing; prioritize stability over lightness when choosing dependencies
- **Usability**: No environment setup required; ships with a bundled `adb.exe` for out-of-the-box use; no installer size restrictions
- **Maintainability**: Clear frontend/backend separation; the Rust backend exposes only Tauri Commands; business logic stays clean and readable

---

## 3. System Architecture

### 3.1 Overall Architecture

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

### 3.2 Communication Model

The frontend and backend communicate via Tauri IPC:

- **Frontend → Backend**: `invoke("command_name", { args })` calls a Rust function and returns an async Promise
- **Backend → Frontend**: `app.emit("event_name", payload)` pushes real-time data (device changes, log streams, serial data, transfer progress)

### 3.3 Background Task Model

```
tokio Runtime
│
├── Task: adb_device_watcher     # Polls `adb devices` every 2s; emits on change
├── Task: adb_root_remount       # Attempts root + remount once per device per session
├── Task: logcat_reader          # Streams adb logcat stdout; emits LogcatBatch { serial, entries }
├── Task: shell_stream_reader    # Streams adb shell stdout+stderr; emits shell_output/shell_exit
├── Task: file_transfer          # Streams push/pull progress; emits transfer_progress
│
├── Task: hdc_device_watcher     # Polls `hdc list targets` + `-v` every 2s; cross-references to filter phantoms
├── Task: hdc_remount            # Runs `hdc target mount` once per device per session
├── Task: hilog_reader           # Streams HiLog output; emits HilogBatch { connect_key, entries }
├── Task: hdc_shell_stream       # Streams hdc shell output; emits hdc_shell_output/hdc_shell_exit
├── Task: hdc_bundle_resolver    # Parallel bm dump -n calls via JoinSet for App Manager

std::thread (native)
│
├── Thread: serial_reader        # Blocking COM port read loop; AtomicBool stop flag
└── Thread: telnet_reader        # Blocking TCP read loop with IAC stripping; AtomicBool stop flag
```

---

## 4. Module Design

### 4.1 ADB Module

#### 4.1.1 Device Management

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

**Auto root/remount on connect**: When the device watcher detects a newly online device (`state == "device"`), it spawns `attempt_root_and_remount()` in the background (once per serial per session):
1. Runs `adb -s {serial} root` and parses output:
   - `"already running as root"` → `is_root = true`
   - `"restarting adbd as root"` → polls `whoami` every 1 s for up to 6 s to confirm; `is_root = true` when confirmed
   - Any other output (e.g. `"cannot run as root in production builds"`) → `is_root = false`
2. If `is_root`: runs `adb -s {serial} remount`; `is_remounted = output.status.success()`
3. Stores result in a process-global `DEVICE_ROOT_STATUS: HashMap<String, (bool, bool)>`
4. Re-emits `devices_changed` with updated status so the frontend reflects the result

Root/remount status is cached for the session (the same serial is not retried if the device briefly disconnects after `adb root` restarts the daemon).

#### 4.1.2 File Manager

File system browsing is implemented by parsing the output of `adb shell ls -la <path>`. Upload and download use `adb push` / `adb pull`.

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

**View (Cat) feature** — `CatModal` component (`src/components/adb/CatModal.tsx`):
- Triggered by the **View** button (enabled when a file or node is selected)
- Reads file content via `runShellCommand` (no new backend command):
  - Text mode: `head -c {N} "{path}" 2>&1`
  - Hex mode: `xxd -l {N} "{path}" 2>&1` (requires `xxd` on device; error is shown inline if unavailable)
- **Size limit**: user-configurable 1–512 KB input, default 8 KB; a truncation warning is shown when output reaches ≥95% of the limit
- **Auto-refresh**: optional toggle with a configurable interval (1–60 s); updates the view repeatedly for live proc nodes (e.g. `/proc/meminfo`)
- A `loadingRef` guard prevents overlapping fetches if auto-refresh fires while a previous fetch is still in progress

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

#### 4.1.3 Log Collection

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

**Batched event model**: Instead of emitting one IPC event per log line, the backend accumulates parsed entries and flushes in batches (up to 64 entries, or after 50 ms of inactivity). This dramatically reduces IPC overhead during high-throughput logging.

#### 4.1.4 Shell Streaming

All ADB shell commands use a streaming execution model. Instead of blocking until a command exits, the backend spawns the process, reads stdout in chunks, and emits real-time events. This enables long-running commands (e.g. `logcat`, `top`, `tcpdump`) to stream output and be cancelled via a Stop button.

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

> **Design decisions**:
> - **Chunk-based reading** instead of line-by-line: stdout is read in 8KB chunks via `AsyncReadExt::read()`, which naturally batches high-throughput output (e.g. logcat) into fewer IPC events, dramatically reducing overhead.
> - **Stderr forwarded to terminal**: A parallel tokio task reads stderr (4KB chunks) and emits the same `shell_output` event. This ensures error messages such as `sh: command: not found` (exit code 127) are visible in the terminal rather than silently discarded.
> - **Process tree kill**: Uses `taskkill /F /T /PID` on Windows to kill the entire process tree, not just the top-level `adb.exe` client.
> - **`kill_on_drop(true)`**: Safety net so the child process is automatically killed if the tokio task panics or is aborted.
> - **One stream per device**: Starting a new stream on the same device auto-stops the previous one. This avoids orphaned processes.

#### 4.1.5 App Manager

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

**Frontend** (`src/components/adb/AppManager.tsx`):
- Sticky toolbar: Install APK button, search input, All / User / System filter, Refresh + item count via pagination
- Paginated table (default 50/page, options 20/50/100/200) — limits DOM nodes rendered, eliminating stutter when switching filters or typing
- `filteredPackages` is wrapped in `useMemo([packages, filter, searchQuery])` for efficient recomputation
- Columns: Package Name (monospace), Type tag (orange = system, blue = user), APK Path (ellipsis + tooltip), Action button
- **Uninstall/Disable button**: label and Popconfirm wording adapt to app type and root status:
  - User app → "Uninstall" / "Uninstall {pkg}?"
  - System + root → "Uninstall" / "Fully remove system app {pkg}? (root — permanent)"
  - System + no root → "Disable" / "Disable {pkg} for current user? (no root — soft disable)"
- **Loading feedback**: `message.loading(…, 0)` toast appears for both install and uninstall operations; transitions to success/error on completion. The Install APK button also shows an inline spinner while running.

### 4.2 Serial Module

#### 4.2.1 Serial Port Management

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

> **Design decision**: Serial config is simplified to just `port_name` + `baud_rate`. Advanced settings (data bits, stop bits, parity, flow control) are deferred — the defaults (8N1, no flow control) cover the vast majority of use cases. The serial read loop uses a native `std::thread` (not tokio `spawn_blocking`) since `serialport` is a blocking API and this avoids tying up tokio worker threads.

#### 4.2.2 Quick Command Panel & Sequence Runner

Quick commands are managed entirely on the frontend via Zustand store (`commandStore.ts`) and shared between ADB and serial devices. The panel appears as a resizable right pane inside the Shell tab.

```typescript
interface QuickCommand {
  id: string;            // uuid
  label: string;         // Display label, e.g. "Reset"
  command: string;       // Payload to send, e.g. "AT+RST"
  sequenceOrder?: number; // undefined = excluded from sequence; 1,2,3… = run order
}
```

- **ADB devices**: quick command runs via `startShellStream()` — output streams in real-time via `shell_output` events; sets the shell running state so the Stop button appears
- **Serial devices**: quick command sends via `writeToPort(command + "\r\n")` — response arrives asynchronously via `serial_data` events

**Sequence Runner** — a Sequence Runner section below the command list allows looping through commands that have a `sequenceOrder` set:
- Each device has **independent** sequence state stored in a per-device ref map in `QuickCommandsPanel`
- The device targeted by the sequence is captured at start time, so switching the UI to another device does not interrupt the runner
- A configurable interval (default 2 s, min 0.5 s) separates successive commands
- Output from sequence commands is routed to the originating device's buffer via `onOutput(text, deviceId)`, not to the currently selected device
- The running state indicator and Run/Stop button reflect the **currently selected** device's sequence state, enabling independent control of each device's runner

#### 4.2.3 Shell Log Utilities

File writes from the Shell tab go through Rust backend commands (not `tauri-plugin-fs`) to avoid frontend permission restrictions:

```rust
#[tauri::command]
async fn write_text_file_to_path(path: String, content: String) -> Result<(), String>
// Creates or truncates a file and writes the given content (used for snapshot export
// and to initialise a new log-to-file session)

#[tauri::command]
async fn append_text_to_file(path: String, content: String) -> Result<(), String>
// Opens the file in append mode and writes content (used for continuous log-to-file)
```

**Snapshot export**: saves the current output buffer to a user-chosen file via `save()` dialog + `write_text_file_to_path`.

**Log-to-file**: per-device toggle; when active, every call to `writeToDeviceBuffer` appends incoming text to the device's log file — including data arriving from background devices while another is selected.

### 4.3 Unified Device Model

Both ADB and serial devices are tracked in a single `deviceStore` (Zustand). The sidebar renders all devices in one list, and the selected device determines which backend path the Shell tab uses.

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

- ADB devices are synced automatically via the `adb_device_watcher` background task
- Serial devices are added/removed manually via the ConnectModal dialog
- On `serial_disconnected` event, the device is automatically removed from the store

---

## 5. Data Design

### 5.1 Persistent Configuration

Stored in the WebView's `localStorage` via Zustand's `persist` middleware. Two keys are used:

**`bridge-config`** — app-wide settings (`configStore.ts`):

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

**`bridge-devices`** — device name overrides (`deviceStore.ts`; only `customNames` is persisted):

```jsonc
{
  "customNames": {
    "192.168.1.50:5555": "My Phone",
    "COM3": "ESP32 Dev Board"
  }
}
```

Custom names are keyed by device serial / connect-key and are applied automatically when a device is re-detected on startup.

---

## 6. UI Layout Design

### 6.1 Overall Layout

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
│  │ 📱 emu-1   │  │                          File Manager / Apps  │
│  │ ○ COM3     │  │   Serial device selected → Shell only        │
│  │ ○ COM7     │  │                                              │
│  └────────────┘  │                                              │
│                  │                                              │
│  [⚙ Settings]    │                                              │
├──────────────────┴──────────────────────────────────────────────┤
│  Status Bar: Device Count | Connection Status  Active: <name>   │
└─────────────────────────────────────────────────────────────────┘
```

The window uses **`decorations: false`** (frameless) with `shadow: true`. The custom `TitleBar` component spans the full window width and provides:
- Left: 16 px app icon + "Bridge" text
- Centre: `data-tauri-drag-region` spacer (fully draggable — no interactive elements)
- Right: standard window controls (minimise / maximise-restore / close) with Windows-convention hover colours

The active device name (with model) is shown in the **StatusBar** bottom-right instead of the titlebar, keeping the drag region unobstructed.

**Main area rendering logic** (`App.tsx`):
- `selectedDevice === null` → renders `<WelcomePage />` only
- Both the ADB tab container and the Serial tab container are **always mounted** once a device of that type has been connected. The inactive container is hidden with `display: none` — it is never unmounted.
- `destroyOnHidden={false}` on each `<Tabs>` keeps individual tab panels (Shell, Logcat, Files, Apps) alive when switching between tabs.

This ensures all shell output buffers, logcat entries, and file listings are preserved across device-type switches without requiring a global store.

### 6.1.1 Welcome Page (`WelcomePage.tsx`)

Shown when no device is selected. Vertically and horizontally centred within the content area (fixed 560 px inner column).

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
│   │  • File Manager │ │  • File Manager  │ │                 │  │
│   │  • App Manager  │ │  • App Manager   │ │                 │  │
│   └─────────────────┘ └──────────────────┘ └─────────────────┘  │
│                                                                  │
│           Click + in the sidebar to connect a device.            │
└──────────────────────────────────────────────────────────────────┘
```

### 6.2 Shell Tab Layout (Unified for ADB + Serial)

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

**Execution model:**
- **ADB devices**: prefix `$`. All commands execute via `startShellStream()` — output streams in real-time via `shell_output` events. A **Stop** button appears while a command is running, calling `stopShellStream()` to terminate it.
- **Serial devices**: prefix `>`. Command sent via `writeToPort()`, response arrives asynchronously via `serial_data` events and is appended to the output area.
- Panels are resizable via `react-resizable-panels` (default 70/30 split).

**Per-device state:**
- Output, input text, and running state are all tracked per-device via ref maps. Switching between devices preserves each device's shell session independently.
- Quick Commands also trigger `startShellStream()` for ADB and correctly set the running state so the Stop button appears.

**Header controls:**
- **Export snapshot** (download icon): saves the current device's complete output buffer to a user-chosen `.txt` file.
- **Log to file** (file-add icon, turns red when active): opens a save dialog and begins continuously appending all incoming data to the chosen file. The toggle is **per-device** and independent — logging on device A continues uninterrupted while device B is selected. Stops only when toggled off or the device is disconnected.
- **Settings toggle** (gear icon): reveals an inline `Max lines` setting (default 5000, range 0–100000, 0 = unlimited). The output buffer is trimmed to this limit to prevent DOM lag from unbounded log accumulation.
- **Clear button** (trash icon): clears the current device's output buffer immediately.

**Per-device output management** (`ShellPanel`):
- `outputMap`, `inputMap`, `runningMap`, and `logFileMap` are all `useRef<Record<string, …>>` maps keyed by device ID, accumulating state for **all** connected devices simultaneously.
- A central `writeToDeviceBuffer(deviceId, text)` helper handles buffer accumulation, `requestAnimationFrame` flush scheduling, and log-to-file append in one place.
- Output from Quick Command sequence runners is routed via `onOutput(text, deviceId)`, directing data to the originating device's buffer regardless of which device is currently displayed.

**Performance optimizations:**
- ADB backend reads stdout in 8KB chunks; serial backend reads in 1024-byte chunks with a 100 ms timeout. Both naturally batch output into fewer IPC events.
- Frontend uses `requestAnimationFrame`-based render batching (`scheduleFlush`) — multiple data events within a single frame are coalesced into one React state update (~60 fps max).
- Non-selected devices never trigger a React re-render; data is accumulated silently until that device is selected.

### 6.3 Logcat Tab Layout

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

**Toolbar controls (left to right):**
- **Mode selector**: `Logcat` / `tlogcat` — each mode runs **independently**; switching modes never stops the other. A green dot appears on the tab label when that mode is actively collecting. Both modes accumulate into their own buffers simultaneously if both are started.
- **Level dropdown**: `All` / `Verbose` / `Debug` / `Info` / `Warn` / `Error` / `Fatal`. `All` (default) shows every level with no filtering.
- **Unified filter input**: a single text box with three VS Code-style toggle buttons:
  - `.*` — Regular expression mode
  - `Aa` — Case-sensitive match
  - `ab` — Whole-word match (`\b` boundaries)
  - Filters match against both tag and message simultaneously.
- **Start / Stop button**: starts or stops the stream for the **currently displayed** mode only; the other mode is unaffected.
- **Clear button**: clears the current mode's in-app display buffer. In logcat mode, also runs `adb logcat -c` to flush the on-device ring buffer so the next Start begins from a clean slate. In tlogcat mode, clears display only.
- **Export button**: exports only the currently filtered and visible entries to a `.txt` file.
- **Max lines input**: always-visible buffer limit (default 5000, 0 = unlimited). Entry count is shown alongside.
- **Bottom button**: appears when the user has scrolled up to read history; click to resume auto-scroll and flush buffered data.

**Rendering model:**
- Log lines are rendered as a single HTML string via direct `innerHTML` assignment on an inner content `<div>`, bypassing React's virtual DOM for high throughput.
- Color is applied via CSS classes (`.log-v`, `.log-d`, `.log-i`, `.log-w`, `.log-e`) rather than per-element inline styles.
- While the user is scrolled up (auto-scroll paused), DOM updates are suspended entirely — new data accumulates in the in-memory buffer without touching the DOM, allowing uninterrupted scrolling. On resume, the buffer is flushed at once.
- Level filtering is applied both client-side (for display and export) and server-side (passed to the `start_logcat` backend command).

### 6.4 File Manager Tab Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│  / sdcard/ DCIM/                    ← clickable path segments        │
│  [Upload] [Download] [View] [Delete] [Refresh] [🔍 Filter by name…]  │
│                                              [no root] [not remounted]│
├──────────────────────────────────────────────────────────────────────┤
│  Name            Size      Modified           Permissions      ▲     │
│  📁 Camera       -         2024-01-01         rwxr-xr-x              │
│  📁 Screenshots  -         2024-01-02         rwxr-xr-x        │     │
│  📄 photo.jpg    3.2 MB    2024-01-03         rw-r--r--        │     │
│  📄 video.mp4    120 MB    2024-01-04         rw-r--r--        ▼     │
└──────────────────────────────────────────────────────────────────────┘
```

**Layout behaviour:**
- The path bar and toolbar are **sticky** — they remain fixed at the top while the file list scrolls independently below them.
- The path bar renders each segment as a clickable `Typography.Link` (e.g. `/ sdcard/ DCIM/`); clicking any segment navigates directly to that path and clears the filter.
- The **filter input** (rightmost in toolbar) performs a case-insensitive substring match on file/directory names within the current directory only (no subdirectory recursion). It clears automatically on directory navigation.
- The **root/remount status tags** (`no root` / `root`, `not remounted` / `remounted`) appear on the right side of the toolbar row, reflecting the auto-detected root/remount state. Color: gray = inactive, gold = root active, blue = remounted. Tooltips explain each state.

**View (Cat) modal — triggered by selecting a file then clicking View:**
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

### 6.5 Apps Tab Layout

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

**Behaviour:**
- Filter tabs (All / User / System) and search box filter the package list in real time. `filteredPackages` is memoized; `currentPage` resets to 1 on any filter/search change.
- Pagination is controlled (default 50/page); options: 20, 50, 100, 200. Total count is shown in the pagination bar.
- Uninstall/Disable button label and confirmation wording depend on app type and root status (see §4.1.5).
- Install APK: opens a file picker filtered to `.apk`; button shows inline spinner and a toast notification during transfer; list reloads on success.

---

## 7. Technology Stack

### 7.1 Dependency Overview

#### Rust Backend

| Crate | Version | Purpose |
|-------|---------|---------|
| `tauri` | 2.x | App framework, IPC, window management |
| `tokio` | 1.x | Async runtime |
| `serialport` | 4.x | Serial port communication |
| `serde` / `serde_json` | 1.x | Data serialization |
| `once_cell` | 1.x | Global static state (`Lazy<Mutex<...>>`) |
| `uuid` | 1.x | Generating quick command IDs |
| `tauri-plugin-store` | 2.x | Config persistence |
| `tauri-plugin-dialog` | 2.x | File picker dialogs |
| `tauri-plugin-fs` | 2.x | File system access |
| `tauri-plugin-shell` | 2.x | Spawning external processes (adb) |

#### Frontend

| Package | Purpose |
|---------|---------|
| `react` + `typescript` | UI framework |
| `antd` | UI component library (light theme with dark terminal) |
| `@ant-design/icons` | Icon set |
| `zustand` | State management |
| `react-resizable-panels` | Draggable split panels |
| `@tauri-apps/api` | Tauri frontend API |

> **Note**: xterm.js and @dnd-kit/core were originally planned but are not currently used. The Shell tab uses a plain `<div>` for output and a standard `<Input>` for command entry. These may be re-introduced for advanced features (HEX mode, drag-to-reorder commands).

### 7.2 ADB Distribution Strategy

Bundle `adb.exe`, `AdbWinApi.dll`, and `AdbWinUsbApi.dll` inside the app's `resources/` directory. On startup, the app resolves the adb path, defaulting to the bundled version. Users can override this with a custom path in Settings if they prefer to use their own platform-tools installation.

---

## 8. Development Plan

### Phase 1 — Foundation (Week 1–2)

- [x] Initialize Tauri project and configure dev environment
- [x] Build the base frontend layout (Sidebar + Tab main area + Status Bar)
- [x] Implement ADB device scanning and hot-plug detection
- [x] Render the unified device list (ADB + serial in one sidebar)

### Phase 2 — ADB Core Features (Week 3–4)

- [x] File system browsing (parse `ls` output, render file list)
- [x] File upload / download (single file + progress bar)
- [x] Batch file transfer + transfer queue UI
- [x] Real-time logcat display + Tag/Level filtering
- [x] Log export
- [x] ADB shell command execution in Shell tab (streaming with stop/clear, per-device state)

### Phase 3 — Serial Features (Week 5–6)

- [x] Port scanning and connection config UI (ConnectModal)
- [x] Serial read loop with background thread + event emission
- [x] Serial write wired to Shell tab input
- [x] Quick command panel working for both ADB and serial
- [x] Auto-disconnect detection (`serial_disconnected` event)
- [x] COM port list sorted numerically (COM3 < COM10); port list refreshed on modal open
- [x] Sequence Runner: per-device loop through ordered quick commands with configurable interval
- [x] Shell log export (snapshot) and continuous log-to-file toggle (per-device, independent)
- [ ] HEX / ASCII display mode toggle
- [ ] Configurable line ending (`\r\n` / `\r` / `\n` / None)
- [ ] Drag-and-drop reordering of quick commands
- [ ] Timed auto-send feature

### Phase 4 — Polish & Packaging (Week 7–8)

- [x] App Manager tab: list packages (user + system), install APK, uninstall/disable
- [x] Shell stderr forwarded to terminal output (command-not-found errors now visible)
- [x] Context-adaptive main area: welcome page, ADB tabs, serial Shell-only tab
- [x] Always-mounted tab containers (display:none) — shell/logcat state survives device-type switches
- [x] Per-device output buffers and log-to-file state in ShellPanel (switching devices never loses data)
- [x] File write/append via Rust backend commands (avoids tauri-plugin-fs scope restrictions)
- [x] 6-theme system (Snow, Dark Modern, Rose, Arctic, Violet, Nord) with Settings drawer and live theme switching
- [x] All UI colors driven by CSS custom properties — cards, logs, file rows, terminal, modals, scrollbars
- [x] Refresh button moved to sidebar (always visible); titlebar centre is a pure drag region
- [x] Active device name + model shown in StatusBar bottom-right
- [x] Config persistence via Zustand `persist` middleware (localStorage): theme, connection defaults, shell/logcat limits, background image path + opacity
- [x] Custom device names persisted across restarts (keyed by serial in `bridge-devices` localStorage entry)
- [x] Startup splash screen: full-viewport icon overlay with spring animation; background color matched to saved theme before first React paint; fades out after first render
- [x] Custom background image: choose image → copy to app-data dir → display as base64 data URL; adjustable opacity (0–100%, default 50%); isolated BgLayer component prevents App re-renders on slider drag
- [ ] Bundle adb.exe into installer
- [ ] Network ADB connection
- [ ] Error handling and auto-reconnect
- [ ] Build installer (NSIS / MSI)

---

## 9. Directory Structure

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
│   │   │   └── commands.rs     # Shell stream, install APK, adb_path() resolver
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
│   │   │   └── TransferQueue.tsx
│   │   └── shell/              # Unified shell for ADB + serial
│   │       ├── ShellPanel.tsx          # Terminal output + input, serial data subscription
│   │       └── QuickCommandsPanel.tsx  # Quick command list, add/delete, send to device
│   ├── store/
│   │   ├── deviceStore.ts      # zustand — unified device state (ADB + serial)
│   │   ├── commandStore.ts     # zustand — quick command list
│   │   ├── serialStore.ts      # zustand — serial port state
│   │   └── configStore.ts      # zustand — app config
│   ├── hooks/
│   │   ├── useAdbEvents.ts     # Listen to ADB device change events
│   │   ├── useSerialEvents.ts  # useSerialData() + useSerialDisconnect() hooks
│   │   └── useShellEvents.ts   # useShellOutput() + useShellExit() hooks for streaming shell
│   ├── utils/
│   │   ├── adb.ts              # invoke wrappers for ADB commands
│   │   ├── serial.ts           # invoke wrappers for serial commands
│   │   ├── fs.ts               # invoke wrappers for file write/append (backend-side, avoids plugin-fs scope limits)
│   │   └── background.ts       # invoke wrappers for background image save/load/remove
│   ├── types/
│   │   ├── adb.ts              # AdbDevice interface
│   │   └── device.ts           # ConnectedDevice interface
│   └── styles.css              # Global styles
│
├── CLAUDE.md                   # Claude Code project instructions
├── package.json
└── vite.config.ts
```

---

*This document is a living reference and will be updated as each module is implemented.*
