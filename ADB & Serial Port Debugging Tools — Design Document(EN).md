# ADB & Serial Debug Tool — Design Document

> **Project Name**: DevBridge (tentative)
> **Document Version**: v1.2
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

Build a Windows desktop debugging tool that unifies ADB device management and serial port debugging in a single interface, reducing repetitive operations, improving debugging efficiency, and making it easy to share with teammates.

### 1.3 Core Value

- Visually manage ADB-connected Android devices without manually typing commands
- Support multi-file batch transfer with real-time progress display
- One-click logcat collection, filtering, and export
- Integrated serial terminal with a quick-command panel (inspired by SSCOM's extension feature)
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
| ADB Commands | Built-in shortcuts for common ADB operations (screenshot, reboot, install APK, etc.) | P1 |
| Network ADB | Connect to a device over the network by entering an IP:Port | P1 |

#### Serial Module

| Feature | Description | Priority |
|---------|-------------|----------|
| Port Scan | Auto-scan and list available COM ports | P0 |
| Serial Connect | Configure baud rate and connect via ConnectModal dialog | P0 |
| Shell I/O | Real-time send/receive in unified Shell tab (plain text display) | P0 |
| Quick Command Panel | Right-side panel for saving frequently used commands; click to send; supports add/delete; shared between ADB and serial | P0 |
| ~~HEX display mode~~ | ~~Toggle between HEX / ASCII display~~ | ~~Deferred~~ |
| ~~Send Settings~~ | ~~Configurable line ending, timed auto-send~~ | ~~Deferred~~ |
| ~~Data Export~~ | ~~Export serial send/receive history~~ | ~~Deferred~~ |

> **Design decision**: Serial uses the same Shell tab as ADB — no separate "Serial Terminal" tab. The Shell tab detects the selected device type and dispatches to the appropriate backend (ADB shell vs serial write). Line ending is hardcoded to `\r\n` for now; configurable suffix is deferred.

### 2.2 Non-Functional Requirements

- **Performance**: File transfers must not block the UI; log rendering must stay smooth (virtual scrolling)
- **Stability**: Auto-detect and notify on serial/ADB disconnection without crashing; prioritize stability over lightness when choosing dependencies
- **Usability**: No environment setup required; ships with a bundled `adb.exe` for out-of-the-box use; no installer size restrictions
- **Maintainability**: Clear frontend/backend separation; the Rust backend exposes only Tauri Commands; business logic stays clean and readable

---

## 3. System Architecture

### 3.1 Overall Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                     Frontend (WebView)                       │
│   React + TypeScript + Ant Design + zustand                  │
│                                                              │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│   │ Unified Shell│  │ File Manager │  │  Logcat           │  │
│   │ (ADB+Serial) │  │              │  │                   │  │
│   └──────────────┘  └──────────────┘  └──────────────────┘  │
└─────────────────────────┬────────────────────────────────────┘
                          │ Tauri IPC (invoke / emit)
┌─────────────────────────▼────────────────────────────────────┐
│                      Backend (Rust)                          │
│                                                              │
│  ┌─────────────────┐          ┌────────────────────────────┐ │
│  │   ADB Manager   │          │     Serial Manager         │ │
│  │                 │          │                            │ │
│  │ - Device watcher│          │  - Port scan               │ │
│  │ - Process mgmt  │          │  - Read thread (std::thread)│ │
│  │ - Progress parse│          │  - Event emit to frontend  │ │
│  └────────┬────────┘          └────────────┬───────────────┘ │
│           │                               │                  │
│  ┌────────▼────────┐          ┌────────────▼───────────────┐ │
│  │   adb.exe       │          │   serialport-rs crate      │ │
│  │  (bundled)      │          │                            │ │
│  └─────────────────┘          └────────────────────────────┘ │
│                                                              │
│  ┌───────────────────────────────────────────────────────┐   │
│  │          tauri-plugin-store (config persistence)       │   │
│  └───────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
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
├── Task: logcat_reader          # Streams adb logcat stdout line-by-line; emits each line
├── Task: shell_stream_reader    # Streams adb shell stdout in chunks; emits shell_output/shell_exit
├── Task: file_transfer          # Streams push/pull progress; emits progress updates

std::thread (native)
│
└── Thread: serial_reader        # Blocking serial read loop; emits received data as events
                                 # Uses AtomicBool stop flag for clean shutdown
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
}
```

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
// Spawns `adb -s {serial} logcat` subprocess
// Reads stdout line-by-line, parses into LogEntry, emits("logcat_line", LogEntry)

#[tauri::command]
async fn stop_logcat(serial: String) -> Result<(), String>

#[tauri::command]
async fn export_logs(logs: Vec<LogEntry>, path: String) -> Result<(), String>
```

```typescript
interface LogEntry {
  timestamp: string;
  pid: number;
  tid: number;
  level: "V" | "D" | "I" | "W" | "E" | "F";
  tag: string;
  message: string;
}

interface LogcatFilter {
  level?: string;
  tags?: string[];      // Tag whitelist
  keyword?: string;     // Keyword filter
}
```

#### 4.1.4 Shell Streaming

All ADB shell commands use a streaming execution model. Instead of blocking until a command exits, the backend spawns the process, reads stdout in chunks, and emits real-time events. This enables long-running commands (e.g. `logcat`, `top`, `tcpdump`) to stream output and be cancelled via a Stop button.

```rust
// Process-global PID map for one active stream per device
static SHELL_PROCESSES: Lazy<Mutex<HashMap<String, u32>>>

#[tauri::command]
async fn start_shell_stream(serial: String, command: String, app: AppHandle) -> Result<(), String>
// 1. If a process already exists for "shell:{serial}", kills it first (auto-stop previous)
// 2. Spawns `adb -s {serial} shell {command}` with stdout piped, stderr null, kill_on_drop
// 3. Stores PID in SHELL_PROCESSES
// 4. Spawns tokio task that reads stdout in 8KB chunks and emits("shell_output", ShellOutput)
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
> - **Process tree kill**: Uses `taskkill /F /T /PID` on Windows to kill the entire process tree, not just the top-level `adb.exe` client.
> - **`kill_on_drop(true)`**: Safety net so the child process is automatically killed if the tokio task panics or is aborted.
> - **One stream per device**: Starting a new stream on the same device auto-stops the previous one. This avoids orphaned processes.

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

#### 4.2.2 Quick Command Panel

Quick commands are managed entirely on the frontend via Zustand store (`commandStore.ts`) and shared between ADB and serial devices. The panel appears as a resizable right pane inside the Shell tab.

```typescript
interface QuickCommand {
  id: string;           // uuid
  label: string;        // Display label, e.g. "Reset"
  command: string;      // Payload to send, e.g. "AT+RST"
}
```

- **ADB devices**: quick command runs via `startShellStream()` — output streams in real-time via `shell_output` events; sets the shell running state so the Stop button appears
- **Serial devices**: quick command sends via `writeToPort(command + "\r\n")` — response arrives asynchronously via `serial_data` events

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
}
```

- ADB devices are synced automatically via the `adb_device_watcher` background task
- Serial devices are added/removed manually via the ConnectModal dialog
- On `serial_disconnected` event, the device is automatically removed from the store

---

## 5. Data Design

### 5.1 Persistent Configuration

Stored via `tauri-plugin-store` at `%APPDATA%/DevBridge/config.json`.

```jsonc
{
  "app": {
    "theme": "dark",
    "language": "en-US"
  },
  "adb": {
    "adb_path": "bundled",    // Use bundled adb or a custom path
    "refresh_interval": 2000
  },
  "serial": {
    "last_port": "COM3",
    "last_baud_rate": 115200
  },
  "quick_commands": [
    {
      "id": "uuid-1",
      "label": "Reset",
      "command": "AT+RST"
    }
  ],
  "shell": {
    "max_lines": 5000       // Output buffer limit per device (0 = unlimited)
  },
  "logcat": {
    "max_lines": 5000,
    "default_filter_level": "D"
  }
}
```

---

## 6. UI Layout Design

### 6.1 Overall Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  Toolbar: Logo | Device Info | Connect Button | Settings        │
├──────────────────┬──────────────────────────────────────────────┤
│                  │  Tabs: [Shell] [Logcat] [File Manager]       │
│  Left Sidebar    │ ──────────────────────────────────────────── │
│                  │                                              │
│  Unified Device  │              Main Work Area                  │
│  List            │                                              │
│  ┌────────────┐  │  (Content switches based on active Tab       │
│  │ 📱 Dev-1   │  │   and selected device type)                  │
│  │ 📱 emu-1   │  │                                              │
│  │ ○ COM3     │  │  Shell tab: works for both ADB and serial    │
│  │ ○ COM7     │  │  Logcat/Files: ADB-only features             │
│  └────────────┘  │                                              │
│                  │                                              │
│  [+ Connect]     │                                              │
├──────────────────┴──────────────────────────────────────────────┤
│  Status Bar: Device Count | Connection Status                    │
└─────────────────────────────────────────────────────────────────┘
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
- **Settings toggle** (gear icon): reveals an inline `Max lines` setting (default 5000, range 0–100000, 0 = unlimited). The output buffer is trimmed to this limit to prevent DOM lag from unbounded log accumulation.
- **Clear button** (trash icon): clears the current device's output buffer immediately.

**Performance optimizations:**
- Backend reads stdout in 8KB chunks instead of line-by-line, naturally batching high-throughput output into fewer IPC events.
- Frontend uses `requestAnimationFrame`-based render batching — multiple data events within a single frame are coalesced into one React state update (~60fps max).

### 6.3 File Manager Tab Layout

```
┌────────────────────────────────────────────────────────────────┐
│  Path: / sdcard / Download              [New Folder] [Upload]  │
├────────────────────────────────────────────────────────────────┤
│  Name            Size      Modified           Permissions      │
│  📁 DCIM         -         2024-01-01         rwxr-xr-x        │
│  📁 Download     -         2024-01-02         rwxr-xr-x        │
│  📄 test.txt     1.2 KB    2024-01-03         rw-r--r--        │
│                                                                │
│   (Right-click menu: Download / Delete / Rename)               │
├────────────────────────────────────────────────────────────────┤
│  Transfer Queue:                                               │
│  test.apk    ████████░░  80%   1.2 MB/s   [Cancel]            │
│  log.tar.gz  ██░░░░░░░░  20%   800 KB/s   [Cancel]            │
└────────────────────────────────────────────────────────────────┘
```

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
- [ ] HEX / ASCII display mode toggle
- [ ] Configurable line ending (`\r\n` / `\r` / `\n` / None)
- [ ] Drag-and-drop reordering of quick commands
- [ ] Timed auto-send feature

### Phase 4 — Polish & Packaging (Week 7–8)

- [ ] Config persistence (tauri-plugin-store)
- [ ] Bundle adb.exe into installer
- [ ] Network ADB connection
- [ ] APK install feature
- [ ] Error handling and auto-reconnect
- [ ] Build installer (NSIS / MSI)

---

## 9. Directory Structure

```
DevBridge/
├── src-tauri/                  # Rust backend
│   ├── src/
│   │   ├── main.rs             # Entry point
│   │   ├── lib.rs              # Command registration, plugin setup, background tasks
│   │   ├── adb/
│   │   │   ├── mod.rs
│   │   │   ├── device.rs       # Device scanning, hot-plug watcher
│   │   │   ├── file.rs         # File manager commands (push/pull/delete)
│   │   │   ├── logcat.rs       # Streaming logcat reader
│   │   │   └── commands.rs     # Shell commands, reboot, install APK
│   │   ├── serial/
│   │   │   ├── mod.rs
│   │   │   └── manager.rs      # Port open/close/write, read loop thread, event emission
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
│   ├── App.tsx                 # Root component: Layout + Tabs + hooks
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Sidebar.tsx     # Left sidebar: unified device list (ADB + serial)
│   │   │   ├── Toolbar.tsx     # Top toolbar
│   │   │   ├── StatusBar.tsx   # Bottom status bar
│   │   │   └── ConnectModal.tsx # Dialog for serial/network ADB connection
│   │   ├── adb/
│   │   │   ├── FileManager.tsx
│   │   │   ├── LogcatPanel.tsx
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
│   │   └── serial.ts           # invoke wrappers for serial commands
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
