# Serial Module — API Reference

> **Project**: DevBridge
> **Module**: Serial (`src-tauri/src/serial/`, `src/utils/serial.ts`, `src/utils/fs.ts`)
> **Last Updated**: 2026-03

This document is the complete API reference for the Serial module. It covers every Tauri command exposed to the frontend, every backend-to-frontend event, all shared data types, and the frontend state management model. Internal Rust helpers that are not exposed over IPC are not listed here.

---

## Table of Contents

1. [IPC Mechanism](#1-ipc-mechanism)
2. [Data Types](#2-data-types)
3. [Commands — Port Management](#3-commands--port-management)
4. [Commands — Data I/O](#4-commands--data-io)
5. [Commands — File Utilities](#5-commands--file-utilities)
6. [Events (Backend → Frontend)](#6-events-backend--frontend)
7. [Frontend Utility Wrappers](#7-frontend-utility-wrappers)
8. [Frontend State Management](#8-frontend-state-management)
9. [Error Handling](#9-error-handling)

---

## 1. IPC Mechanism

All Serial commands follow the Tauri IPC pattern:

- **Frontend → Backend**: `invoke("command_name", { ...args })` — returns a `Promise` that resolves with the command's return value or rejects with an error string.
- **Backend → Frontend**: `app.emit("event_name", payload)` — push events the frontend subscribes to via `listen()`.

Serial commands are **not** async on the Rust side (they operate on a global `Mutex` over synchronous I/O), but are exposed as `async fn` to satisfy Tauri's command model. Actual I/O happens on a dedicated `std::thread` per port.

---

## 2. Data Types

### `SerialDataEvent`

Emitted whenever bytes are received from an open serial port **or** a Telnet session. Both connection types share the same event.

```rust
#[derive(Clone, Serialize)]
pub struct SerialDataEvent {
    pub port: String,  // Port name (e.g. "COM3") or Telnet session ID (e.g. "192.168.1.1:23")
    pub data: String,  // Received bytes decoded as UTF-8 (lossy — invalid sequences replaced with U+FFFD)
}
```

```typescript
interface SerialDataEvent {
  port: string;  // COM port name or "host:port" for Telnet sessions
  data: string;  // Received text chunk (may span multiple lines)
}
```

**Notes:**
- `data` is a raw chunk, not a single line. It may contain multiple newlines, partial lines, or ANSI escape codes depending on the connected device.
- Encoding is UTF-8 lossy: invalid byte sequences are silently replaced. Raw binary data is not supported.
- For Telnet sessions, Telnet IAC control sequences are stripped before emission (see [`open_telnet_session`](#open_telnet_session)).

---

### `ConnectedDevice` (serial variant)

How the device store represents a connected serial or Telnet device. Not a Rust type — constructed entirely on the frontend.

```typescript
interface ConnectedDevice {
  id: string;      // COM port name (e.g. "COM3") or Telnet "host:port" (e.g. "192.168.1.1:23")
  type: "serial";
  name: string;    // User-supplied label, or falls back to the id
  serial: string;  // Same as id
  state: "connected";
}
```

---

### `QuickCommand`

A saved command in the Quick Commands panel. Managed in the `commandStore` Zustand store.

```typescript
interface QuickCommand {
  id: string;             // Unique ID (Date.now()-based)
  label: string;          // Display label shown on the button
  command: string;        // Raw string to send to the device
  sequenceOrder?: number; // undefined = excluded from Sequence Runner; 1, 2, 3, … = run order
}
```

---

## 3. Commands — Port Management

### `list_serial_ports`

Returns all currently available serial ports on the system, sorted numerically for COM ports (`COM3` before `COM10`) and lexically for all others.

**Rust signature:**
```rust
#[tauri::command]
fn list_serial_ports() -> Result<Vec<String>, String>
```

**Frontend call:**
```typescript
invoke<string[]>("list_serial_ports")
```

**Returns:** `string[]` — list of port names (e.g. `["COM3", "COM7", "COM10"]`).

**Errors:** Returns an error string if `serialport::available_ports()` fails (e.g. driver error).

**Notes:**
- This command is synchronous on the Rust side (not async). Results reflect the port state at the moment of the call.
- COM port numeric sort is applied via a custom comparator — `COM3 < COM10`, not the OS-default lexical order that would produce `COM10 < COM3`.

---

### `open_telnet_session`

Connects to a remote host over TCP (Telnet) and starts a background read loop that emits `serial_data` events — identical in behaviour to a COM port session from the frontend's perspective.

**Rust signature:**
```rust
#[tauri::command]
async fn open_telnet_session(host: String, port: u16, app: AppHandle) -> Result<(), String>
```

**Frontend call:**
```typescript
invoke("open_telnet_session", { host, port })
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `host` | `string` | IP address or hostname, e.g. `"192.168.1.100"` |
| `port` | `u16` | TCP port (default `23` for standard Telnet) |

**Returns:** `void` on success.

**Errors:**
- Connection refused / host unreachable — error message from `TcpStream::connect`.
- Host resolves but connection times out (OS default TCP timeout applies).

**Behaviour:**
1. Calls `TcpStream::connect("{host}:{port}")` inside `tokio::task::spawn_blocking` to avoid blocking the async runtime.
2. Sets a 100 ms read timeout on the socket.
3. Clones the stream — original stored in `TELNET_SESSIONS` for writing; clone passed to the read thread.
4. Creates an `Arc<AtomicBool>` stop flag stored in `TELNET_FLAGS`.
5. Spawns a `std::thread` running `telnet_read_loop`.

**Telnet IAC negotiation:**
The read loop strips RFC 854 Telnet control sequences before emitting data:

| Received | Response sent | Data effect |
|----------|---------------|-------------|
| `IAC WILL x` | `IAC DONT x` | stripped |
| `IAC DO x` | `IAC WONT x` | stripped |
| `IAC WONT x` / `IAC DONT x` | none | stripped |
| `IAC SB … IAC SE` | none | entire block stripped |
| `IAC IAC` | none | emitted as literal `0xFF` |

This is sufficient for all common serial-over-TCP adapters (ser2net, HW VSP, Lantronix). Full RFC 2217 (remote baud/flow control) is not supported.

**Internal globals:**
```rust
static TELNET_SESSIONS: Lazy<Mutex<HashMap<String, Arc<Mutex<TcpStream>>>>>
static TELNET_FLAGS:    Lazy<Mutex<HashMap<String, Arc<AtomicBool>>>>
```

---

### `open_serial_port`

Opens a serial port at the specified baud rate and starts a background read loop that emits `serial_data` events.

**Rust signature:**
```rust
#[tauri::command]
async fn open_serial_port(port_name: String, baud_rate: u32, app: AppHandle) -> Result<(), String>
```

**Frontend call:**
```typescript
invoke("open_serial_port", { portName, baudRate })
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `portName` | `string` | Port name, e.g. `"COM3"` |
| `baudRate` | `number` | Baud rate, e.g. `115200` |

**Returns:** `void` on success.

**Errors:**
- Port is already in use by another application.
- Port does not exist (driver not installed, device unplugged).
- `port.try_clone()` fails — the port does not support cloning (rare; driver-dependent).

**Behaviour:**
1. Opens the port via `serialport::new(port_name, baud_rate).timeout(100ms).open()`.
2. Clones the port handle — the original is stored in `OPEN_PORTS` for writing; the clone is passed to the read thread.
3. Creates an `Arc<AtomicBool>` stop flag stored in `READER_FLAGS`.
4. Spawns a `std::thread` running a blocking read loop (`read_loop`).

**Serial configuration defaults:**

| Setting | Value |
|---------|-------|
| Data bits | 8 |
| Stop bits | 1 |
| Parity | None |
| Flow control | None |
| Read timeout | 100 ms |

Advanced settings (data bits, stop bits, parity, flow control) are not currently configurable via UI; the `serialport` crate defaults to 8N1, no flow control.

**Internal globals:**
```rust
// Port handles keyed by port name — used for writing
static OPEN_PORTS: Lazy<Mutex<HashMap<String, Box<dyn SerialPort + Send>>>>

// Stop flags keyed by port name — signal read loop to exit
static READER_FLAGS: Lazy<Mutex<HashMap<String, Arc<AtomicBool>>>>
```

---

### `close_serial_port`

Closes an open serial port, stopping its background read loop.

**Rust signature:**
```rust
#[tauri::command]
async fn close_serial_port(port_name: String) -> Result<(), String>
```

**Frontend call:**
```typescript
invoke("close_serial_port", { portName })
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `portName` | `string` | Port name to close |

**Returns:** `void` on success.

**Errors:** Returns an error string if the `OPEN_PORTS` mutex is poisoned (should not occur in normal operation).

**Behaviour:**
1. Sets the stop flag (`READER_FLAGS` for COM ports, `TELNET_FLAGS` for Telnet) to `true`. The read thread checks this flag at the top of its loop and exits on the next iteration.
2. Removes the session from `OPEN_PORTS` (COM) or `TELNET_SESSIONS` (Telnet).

**Note:** The read thread exits asynchronously after the stop flag is set. There may be one final `serial_data` event emitted from data already in the thread's buffer before it exits.

---

## 4. Commands — Data I/O

### `write_serial`

Writes a string to an open serial port.

**Rust signature:**
```rust
#[tauri::command]
async fn write_serial(port_name: String, data: String) -> Result<(), String>
```

**Frontend call:**
```typescript
invoke("write_serial", { portName, data })
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `portName` | `string` | Port name to write to |
| `data` | `string` | String data to send (UTF-8 encoded) |

**Returns:** `void` on success.

**Errors:**
- `"Port not open"` — the session ID is not present in either `OPEN_PORTS` (COM) or `TELNET_SESSIONS` (Telnet).
- Any OS-level write error string (e.g. port disconnected mid-write).

**Notes:**
- Data is written as raw UTF-8 bytes via `port.write_all(data.as_bytes())`.
- **Line endings are not automatically appended.** Callers are responsible for including `\r\n` (or other line endings) in `data`. The Shell tab's `handleCommand` appends `\r\n` before calling this command; quick commands also append `\r\n`.
- Writes are synchronous (blocking) but execute within the tokio thread pool. At typical baud rates (≤921600 bps), the write completes in microseconds and does not cause observable UI latency.

---

## 5. Commands — File Utilities

These commands exist to work around `tauri-plugin-fs` scope restrictions — the plugin requires explicit capability scopes to write to user-chosen paths, but the Rust backend has unrestricted filesystem access. They are used exclusively by `ShellPanel` for log export and log-to-file.

### `write_text_file_to_path`

Creates or truncates a file and writes text content to it.

**Rust signature:**
```rust
#[tauri::command]
async fn write_text_file_to_path(path: String, content: String) -> Result<(), String>
```

**Frontend call:**
```typescript
invoke("write_text_file_to_path", { path, content })
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `path` | `string` | Absolute path to the destination file |
| `content` | `string` | Text to write (UTF-8) |

**Returns:** `void` on success.

**Errors:** OS I/O error string (e.g. permission denied, path does not exist).

**Usage:** Called when the user clicks **Export snapshot** (saves current buffer) or when **Log to file** is first enabled (creates/truncates the log file before streaming begins).

---

### `append_text_to_file`

Opens a file in append mode and writes text to it, creating the file if it does not exist.

**Rust signature:**
```rust
#[tauri::command]
async fn append_text_to_file(path: String, content: String) -> Result<(), String>
```

**Frontend call:**
```typescript
invoke("append_text_to_file", { path, content })
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `path` | `string` | Absolute path to the destination file |
| `content` | `string` | Text to append (UTF-8) |

**Returns:** `void` on success.

**Errors:** OS I/O error string (e.g. permission denied).

**Usage:** Called on every `writeToDeviceBuffer` invocation when log-to-file is active for that device. Fires and forgets (errors are silently swallowed) to avoid blocking the UI for disk errors.

---

## 6. Events (Backend → Frontend)

### `serial_data`

Emitted by the read loop thread whenever bytes are received from an open serial port.

**Payload:** `SerialDataEvent`
```typescript
{ port: string; data: string }
```

**Emission rate:** One event per successful `read()` call that returns >0 bytes. The read loop uses a 1024-byte buffer and a 100 ms timeout. At 921600 bps with continuous output, this can be up to ~100 events/second; the frontend's RAF batching handles this without re-rendering more than ~60 times/second.

**Frontend subscription:**
```typescript
// src/hooks/useSerialEvents.ts
export function useSerialData(handler: (event: SerialDataEvent) => void) {
  useEffect(() => {
    const unlisten = listen<SerialDataEvent>("serial_data", (e) => handler(e.payload));
    return () => { unlisten.then(fn => fn()); };
  }, [handler]);
}
```

**Consumer:** `ShellPanel` — routes data to `writeToDeviceBuffer(device.id, event.data)` for the matching device, regardless of which device is currently selected.

---

### `serial_disconnected`

Emitted by the read loop thread when an I/O error occurs (e.g. USB cable pulled, device powered off).

**Payload:** `string` — the port name (e.g. `"COM3"`).

**Frontend subscription:**
```typescript
// src/hooks/useSerialEvents.ts
export function useSerialDisconnect(handler: (port: string) => void) {
  useEffect(() => {
    const unlisten = listen<string>("serial_disconnected", (e) => handler(e.payload));
    return () => { unlisten.then(fn => fn()); };
  }, [handler]);
}
```

**Consumer:** `useSerialDisconnect` hook (registered in `App.tsx`) — removes the corresponding device from the `deviceStore`. Any buffered output in `ShellPanel`'s `outputMap` is preserved and displayed until the user clears it or reconnects.

**Note:** This event is emitted from the read loop thread, not from the command handler. Timeout errors (`ErrorKind::TimedOut`) are silently retried and do **not** trigger this event.

---

## 7. Frontend Utility Wrappers

Located in `src/utils/serial.ts` and `src/utils/fs.ts`.

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

## 8. Frontend State Management

### Device Store (`deviceStore.ts`)

Serial devices live in the same Zustand store as ADB devices, using `type: "serial"` to distinguish them.

| Action | Trigger |
|--------|---------|
| `addDevice(device)` | Called in `ConnectModal` after `openPort` succeeds |
| `removeDevice(id)` | Called in `useSerialDisconnect` handler on `serial_disconnected` event |
| `setSelectedDeviceId(id)` | Called when user clicks a device in the sidebar |

### Shell Output Buffers (`ShellPanel.tsx`)

All buffer state lives in `useRef` maps inside `ShellPanel`, keyed by device ID. This keeps data alive across device switches without a global store.

```typescript
const outputMap  = useRef<Record<string, string>>({});         // Terminal output per device
const inputMap   = useRef<Record<string, string>>({});         // Pending input per device
const runningMap = useRef<Record<string, boolean>>({});        // ADB process running state per device
const logFileMap = useRef<Record<string, string | null>>({});  // Active log file path per device (null = off)
```

**`writeToDeviceBuffer(deviceId, text)`** is the central write helper — all incoming data flows through it:

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

**RAF batching** (`scheduleFlush`): uses `requestAnimationFrame` so multiple `serial_data` events arriving within the same frame (~16 ms) are coalesced into one `setOutput` call — capping renders at ~60 fps regardless of event frequency.

### Quick Commands Store (`commandStore.ts`)

```typescript
interface CommandState {
  commands: QuickCommand[];
  addCommand: (label: string, command: string) => void;
  removeCommand: (id: string) => void;
  setSequenceOrder: (id: string, order: number | undefined) => void;
}
```

Commands are shared between ADB and Serial devices. The `sequenceOrder` field is set per-command to include it in the Sequence Runner.

### Sequence Runner State (`QuickCommandsPanel.tsx`)

Per-device sequence state is stored in a `useRef<Map<string, SeqEntry>>`, not in React state, to allow background operation independent of the selected device:

```typescript
interface SeqEntry {
  running: boolean;
  interval: number;       // seconds between commands
  currentLabel: string;   // label of the last-sent command
  timeoutId?: ReturnType<typeof setTimeout>;
  index: number;          // cycles through sorted sequenceOrder commands
  device: DeviceItem | null; // captured at startSequence() time
}
```

React state (`seqRunning`, `seqInterval`, `seqCurrentLabel`) reflects only the **currently selected** device's entry and is synced from the map whenever `selectedDeviceId` changes.

The step function is stored in a `useRef` (`runNextStepRef`) so `setTimeout` callbacks always call the latest version without stale closures:

```
startSequence()
  └── capture selectedDevice → SeqEntry.device
  └── runNextStepRef.current(deviceId)
        ├── send command to SeqEntry.device (not selectedDevice)
        ├── update SeqEntry.currentLabel
        └── setTimeout(() => runNextStepRef.current(deviceId), interval * 1000)
```

---

## 9. Error Handling

| Scenario | Backend behaviour | Frontend behaviour |
|----------|-------------------|--------------------|
| Port open fails (in use / not found) | Returns `Err(message)` | `ConnectModal` shows `message.error(String(e))` |
| Telnet connect fails (refused / unreachable) | Returns `Err("Failed to connect to host:port: ...")` | `ConnectModal` shows `message.error(String(e))` |
| Port write fails (disconnected mid-write) | Returns `Err(message)` | Shell tab shows `Error: {e}` in output area |
| Port disconnected during read | Read loop emits `serial_disconnected` then exits | `useSerialDisconnect` removes device from store |
| Sequence Runner: device was removed | `SeqEntry.device` is stale, but commands still attempt to run — `writeToPort` / `startShellStream` will fail | Error line appears in the device's output buffer; next step is still scheduled. User must press Stop manually. |
| Log file write fails | `appendTextToFile` error is silently swallowed (`.catch(() => {})`) | No user notification — log-to-file indicator remains active |
| `list_serial_ports` fails | Returns `Err(message)` | `ConnectModal` silently ignores the error (port list remains empty) |

---

*This document covers the Serial module as of v1.8 of the design document.*
