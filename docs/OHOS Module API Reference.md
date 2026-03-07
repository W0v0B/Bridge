# OHOS Module — API Reference

> **Project**: DevBridge
> **Module**: OHOS / HDC (`src-tauri/src/hdc/`, `src/utils/hdc.ts`)
> **Last Updated**: 2026-03

This document is the complete API reference for the OHOS module. It covers every Tauri command exposed to the frontend, every backend-to-frontend event, and all shared data types. Internal Rust helpers that are not exposed over IPC are not listed here.

---

## Table of Contents

1. [IPC Mechanism](#1-ipc-mechanism)
2. [Data Types](#2-data-types)
3. [Commands — Device Management](#3-commands--device-management)
4. [Commands — File Manager](#4-commands--file-manager)
5. [Commands — Shell](#5-commands--shell)
6. [Commands — HiLog](#6-commands--hilog)
7. [Commands — App Manager](#7-commands--app-manager)
8. [Events (Backend → Frontend)](#8-events-backend--frontend)
9. [Frontend Utility Wrappers](#9-frontend-utility-wrappers)
10. [Error Handling](#10-error-handling)
11. [HDC Tool Resolution](#11-hdc-tool-resolution)

---

## 1. IPC Mechanism

All OHOS commands follow the same Tauri IPC pattern as the ADB module:

- **Frontend → Backend**: `invoke("command_name", { ...args })` — returns a `Promise` that resolves with the return value or rejects with an error string.
- **Backend → Frontend**: `app.emit("event_name", payload)` — push events subscribed to via `listen()`.

All commands are `async` on the Rust side (tokio) and return `Result<T, String>`. The error variant always carries a human-readable message.

The OHOS module uses separate event names from the ADB module (prefixed `hdc_`) so that both modules can operate simultaneously without event collisions.

---

## 2. Data Types

### `OhosDevice`

Represents a connected OHOS device. Returned by `get_ohos_devices` and emitted in `hdc_devices_changed`.

```typescript
interface OhosDevice {
  connect_key: string;   // Device identifier: serial number (USB) or "IP:port" (TCP)
  conn_type: string;     // "USB" | "TCP"
  state: string;         // "Connected" | "Offline" | "Unauthorized"
  name: string;          // Host name reported by hdc (often "localhost")
  is_remounted: boolean; // true if `hdc target mount` succeeded for this device this session
  remount_info: string;  // Output from the remount attempt; empty = attempt still in progress
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

**Notes:**
- `is_remounted` and `remount_info` are determined automatically when the device first connects (see [Device Watcher](#device-watcher)). They are cached in `DEVICE_REMOUNT_STATUS` and merged into every subsequent `list_devices()` call.
- While the remount attempt is still running, `is_remounted` is `false` and `remount_info` is an empty string. The UI displays `"checking..."` in this state.
- Success detection inspects the combined stdout+stderr of `hdc target mount` for failure markers (`[Fail]`, `not user mountable`, `Operation not permitted`, `debug mode`) in addition to the exit code, because some firmwares return exit 0 with an error message.

---

### `FileEntry`

Represents a single file or directory entry returned by `list_hdc_files`. Identical in shape to the ADB module's `FileEntry`.

```typescript
interface FileEntry {
  name: string;        // File/directory display name
  path: string;        // Full absolute path on the device
  is_dir: boolean;     // true for directories
  size: number;        // File size in bytes (0 for directories)
  permissions: string; // Unix permission string, e.g. "drwxrwxr-x"
  modified: string;    // Last-modified timestamp, e.g. "2024-01-15 10:30"
}
```

---

### `HilogEntry`

Represents one parsed HiLog line. Used in `hilog_lines` events and in `export_hilog`.

```typescript
interface HilogEntry {
  timestamp: string; // "MM-DD HH:MM:SS.mmm"
  pid: string;       // Process ID string
  tid: string;       // Thread ID string
  level: string;     // "D" | "I" | "W" | "E" | "F"
  tag: string;       // "DOMAIN/Tag" format, e.g. "A03200/testTag"
  message: string;   // Log message body
}
```

---

### `HilogFilter`

Input to `start_hilog`. All fields are optional — `null` means no filtering on that dimension.

```typescript
interface HilogFilter {
  level: string | null;   // Minimum level threshold: "D"|"I"|"W"|"E"|"F" or null = all
  keyword: string | null; // Substring match against tag and message; null = no filter
}
```

**Notes:**
- `level` filtering is a threshold: `"W"` passes W, E, and F; rejects D and I.
- Keyword filtering is case-insensitive and applied to the full raw log line before parsing.
- Unlike ADB logcat, HiLog has no `"V"` (Verbose) level.

---

### `BundleInfo`

Returned by `list_bundles`. Represents one installed HAP bundle.

```typescript
interface BundleInfo {
  bundle_name: string;                    // e.g. "com.huawei.hmos.browser"
  code_path: string;                      // Actual HAP file path, e.g. "/system/app/Browser/HuaweiBrowser.hap"
                                          // Empty string if path could not be resolved
  app_type: "user" | "system" | "vendor"; // Derived from isSystemApp + hapPath prefix
}
```

**App type classification:**

| `isSystemApp` | `hapPath` prefix | `app_type` |
|---------------|-----------------|------------|
| `false` | any | `"user"` |
| `true` | `/vendor/`, `/chipset/`, `/sys_prod/`, `/cust/`, `/preload/` | `"vendor"` |
| `true` | `/system/` or unrecognised | `"system"` |

**Notes:**
- `code_path` is populated from the first non-empty `"hapPath"` field in `bm dump -n` JSON output, **not** from `"codePath"` (which always points to the runtime data directory under `/data/app/`, regardless of app type).
- Classification uses `"isSystemApp"` from the JSON output as the primary signal; `hapPath` prefix is used only to distinguish `"vendor"` from `"system"` within system apps.

---

### `HdcShellOutput`

Payload of the `hdc_shell_output` event.

```typescript
interface HdcShellOutput {
  connect_key: string; // Device connect_key this output belongs to
  data: string;        // Raw text chunk (stdout, UTF-8 lossy)
}
```

---

### `HdcShellExit`

Payload of the `hdc_shell_exit` event.

```typescript
interface HdcShellExit {
  connect_key: string; // Device connect_key
  code: number;        // Process exit code; -1 if undetermined
}
```

---

## 3. Commands — Device Management

**Source**: `src-tauri/src/hdc/device.rs`

---

### `get_ohos_devices`

Returns the current list of connected OHOS devices.

```typescript
invoke("get_ohos_devices"): Promise<OhosDevice[]>
```

```typescript
// Frontend wrapper
import { getOhosDevices } from "../utils/hdc";
const devices = await getOhosDevices();
```

**Returns**: Array of `OhosDevice`. Empty array if no devices are connected or if `hdc list targets -v` fails.

**Notes**: This is a one-shot read. For live updates, subscribe to [`hdc_devices_changed`](#hdc_devices_changed). Remount status is merged in from `DEVICE_REMOUNT_STATUS` before returning.

---

### `connect_ohos_device`

Connects to an OHOS device over TCP via `hdc tconn`.

```typescript
invoke("connect_ohos_device", { addr: string }): Promise<string>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `addr` | `string` | `"IP:port"` string, e.g. `"192.168.1.100:5555"` |

**Returns**: Raw output string from `hdc tconn`.

**Errors**: Rejects if `hdc tconn` exits with a non-zero code.

---

#### Device Watcher

`start_device_watcher(app)` is started automatically on app launch (in `lib.rs::setup`). It is not a Tauri command.

**Behaviour:**
1. Polls `hdc list targets -v` every **2 seconds**.
2. When the device list changes, emits [`hdc_devices_changed`](#hdc_devices_changed).
3. For each newly seen device with `state == "Connected"`, spawns `attempt_remount()` **once per connect_key per session** (tracked in a session-local `HashSet`).
4. `attempt_remount()`:
   - Runs `hdc -t {connect_key} target mount`.
   - Inspects combined stdout+stderr for failure markers: `[Fail]`, `not user mountable`, `Operation not permitted`, `debug mode`.
   - `success = exit_status.success() && !has_failure`.
   - Stores `(is_remounted, remount_info)` in `DEVICE_REMOUNT_STATUS: Lazy<Mutex<HashMap<String, (bool, String)>>>`.
   - Re-emits `hdc_devices_changed` with the updated status.

**Notes**: The remount only succeeds on debug/engineering firmware builds. On production firmware it will fail with `[Fail][E007100] Operate need running under debug mode`, which is stored as `remount_info` and displayed in the File Manager UI.

---

## 4. Commands — File Manager

**Source**: `src-tauri/src/hdc/file.rs`

---

### `list_hdc_files`

Lists the contents of a directory on the device.

```typescript
invoke("list_hdc_files", { connectKey: string, path: string }): Promise<FileEntry[]>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `connectKey` | `string` | Device connect_key |
| `path` | `string` | Absolute path on the device, e.g. `"/data"` |

**Returns**: Array of `FileEntry`, sorted: directories first, then by name (case-insensitive).

**Implementation**: Runs `hdc -t {connectKey} shell ls -la '{path}'` and parses output with the same regex as the ADB module.

**Errors**: Rejects if the path does not exist or `ls` fails.

---

### `send_hdc_files`

Uploads one or more local files to a directory on the device.

```typescript
invoke("send_hdc_files", {
  connectKey: string,
  localPaths: string[],
  remotePath: string,
}): Promise<void>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `connectKey` | `string` | Device connect_key |
| `localPaths` | `string[]` | Absolute local file paths |
| `remotePath` | `string` | Destination directory on the device |

**Returns**: `void` on success.

**Side effects**: Emits [`transfer_progress`](#transfer_progress) events (shared with ADB module). HDC does not expose byte-level progress, so only `percent: 0` (start) and `percent: 100` (completion) are emitted per file.

**Errors**: Rejects if `hdc file send` exits with a non-zero code.

---

### `recv_hdc_file`

Downloads a single file from the device to the local machine.

```typescript
invoke("recv_hdc_file", {
  connectKey: string,
  remotePath: string,
  localPath: string,
}): Promise<void>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `connectKey` | `string` | Device connect_key |
| `remotePath` | `string` | Absolute path on the device |
| `localPath` | `string` | Destination path on the local machine (full path including filename) |

**Side effects**: Emits `transfer_progress` with `percent: 0` then `percent: 100`.

**Errors**: Rejects if `hdc file recv` exits with a non-zero code.

---

### `delete_hdc_file`

Deletes a file or directory on the device.

```typescript
invoke("delete_hdc_file", { connectKey: string, path: string }): Promise<void>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `connectKey` | `string` | Device connect_key |
| `path` | `string` | Absolute path on the device |

**Implementation**: Runs `hdc -t {connectKey} shell rm -rf '{path}'`. Recursive and non-recoverable.

**Errors**: Rejects if `rm` exits with a non-zero code.

---

## 5. Commands — Shell

**Source**: `src-tauri/src/hdc/commands.rs`

---

### `run_hdc_shell_command`

Runs a shell command synchronously and returns the full output.

```typescript
invoke("run_hdc_shell_command", { connectKey: string, command: string }): Promise<string>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `connectKey` | `string` | Device connect_key |
| `command` | `string` | Shell command string |

**Returns**: Combined stdout+stderr as a string.

**Notes**: Blocking — waits for the command to exit. Use for short-lived commands only (e.g. `cat`, `head -c`, `xxd -l`). For streaming output, use `start_hdc_shell_stream`.

**Errors**: Rejects if `hdc shell` exits with a non-zero code, with a message containing the output.

---

### `start_hdc_shell_stream`

Starts a streaming shell command. Output is emitted as [`hdc_shell_output`](#hdc_shell_output) events. Completion is signaled by [`hdc_shell_exit`](#hdc_shell_exit).

```typescript
invoke("start_hdc_shell_stream", { connectKey: string, command: string }): Promise<void>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `connectKey` | `string` | Device connect_key |
| `command` | `string` | Shell command string |

**Returns**: `void` immediately (stream runs in background).

**Side effects**:
- If a stream is already running for this `connectKey`, it is killed first.
- Emits [`hdc_shell_output`](#hdc_shell_output) with stdout chunks as they arrive.
- Emits [`hdc_shell_exit`](#hdc_shell_exit) when the process exits.

**Implementation**: Spawns `hdc -t {connectKey} shell {command}` with stdout piped, reads in 8 KB chunks. Process PID stored in `HDC_SHELL_PROCESSES` keyed by `"shell:{connectKey}"`. Process tree is killed via `taskkill /F /T /PID` on stop.

**Errors**: Rejects only if the child process fails to spawn.

---

### `stop_hdc_shell_stream`

Stops a running shell stream for a device.

```typescript
invoke("stop_hdc_shell_stream", { connectKey: string }): Promise<void>
```

**Errors**: Rejects with `"No HDC shell stream running for {connectKey}"` if no stream is active.

---

## 6. Commands — HiLog

**Source**: `src-tauri/src/hdc/hilog.rs`

---

### `start_hilog`

Starts streaming HiLog output for a device.

```typescript
invoke("start_hilog", { connectKey: string, filter: HilogFilter }): Promise<void>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `connectKey` | `string` | Device connect_key |
| `filter` | `HilogFilter` | Level and keyword filter applied in the backend |

**Returns**: `void` immediately (streaming runs in background).

**Side effects**: Emits [`hilog_lines`](#hilog_lines) batches.

**Implementation**:
- Runs `hdc -t {connectKey} shell hilog`.
- Parses lines with the regex:
  ```
  ^(\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+)\s+(\d+)\s+(\d+)\s+([DIWEF])\s+([^\s:][^:]*?):\s*(.*)
  ```
- Lines that do not match the regex are silently dropped.
- Filtering is applied in Rust before entries are added to the batch.
- Entries are batched and emitted when either: batch reaches **64 entries** or **50 ms** have elapsed since the last flush.
- PID stored in `HILOG_PROCESSES` keyed by `"hilog:{connectKey}"`.

**Errors**: Rejects with `"HiLog already running for {connectKey}"` if a stream is already active. Call `stop_hilog` first.

---

### `stop_hilog`

Stops the HiLog stream for a device.

```typescript
invoke("stop_hilog", { connectKey: string }): Promise<void>
```

**Errors**: Rejects with `"No HiLog running for {connectKey}"` if not active.

---

### `clear_hilog`

Clears the on-device HiLog ring buffer (`hilog -r`). Does not affect the frontend display buffer.

```typescript
invoke("clear_hilog", { connectKey: string }): Promise<void>
```

**Errors**: Rejects if the command exits with a non-zero code.

---

### `export_hilog`

Writes an array of `HilogEntry` objects to a text file on the local machine.

```typescript
invoke("export_hilog", { entries: HilogEntry[], path: string }): Promise<void>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `entries` | `HilogEntry[]` | Entries to export |
| `path` | `string` | Absolute local path to write |

**Output format** (one line per entry):
```
{timestamp} {pid} {tid} {level} {tag}: {message}
```

**Errors**: Rejects if the file cannot be written.

---

## 7. Commands — App Manager

**Source**: `src-tauri/src/hdc/apps.rs`

---

### `list_bundles`

Returns a list of all installed HAP bundles with resolved install paths and type classification.

```typescript
invoke("list_bundles", { connectKey: string }): Promise<BundleInfo[]>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `connectKey` | `string` | Device connect_key |

**Returns**: Array of `BundleInfo`, sorted: user apps first (alphabetically), then vendor apps, then system apps.

**Implementation (two-pass)**:
1. Runs `hdc -t {connectKey} shell bm dump -a` to get all bundle names.
   - Lines containing `:` (e.g. `ID: 100:`) or not containing `.` are filtered out.
2. For each bundle name, spawns a parallel tokio task running `hdc -t {connectKey} shell bm dump -n {name}`.
   - Waits for all tasks via `tokio::task::JoinSet`.
   - Parses the JSON output for `"isSystemApp"` (boolean) and the first non-empty `"hapPath"` string value.
   - Classifies `app_type` based on `isSystemApp` and `hapPath` prefix (see [`BundleInfo`](#bundleinfo)).

**Performance note**: Resolution is O(n) parallel shell calls. On a device with ~150 bundles, expect 1–3 seconds total. The frontend shows a loading spinner during this time.

**Errors**: Rejects if `bm dump -a` fails to execute. Individual `bm dump -n` failures are silently tolerated — those bundles will have `code_path: ""` and `app_type: "system"` as defaults.

---

### `install_hap`

Installs a HAP package from the local machine onto the device.

```typescript
invoke("install_hap", { connectKey: string, hapPath: string }): Promise<string>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `connectKey` | `string` | Device connect_key |
| `hapPath` | `string` | Absolute local path to the `.hap` file |

**Returns**: Combined stdout+stderr from `hdc install`.

**Implementation**: Runs `hdc -t {connectKey} install {hapPath}`.

**Errors**: Rejects if `hdc install` exits with a non-zero code AND the output does not contain `"success"` (case-insensitive).

---

### `uninstall_bundle`

Uninstalls a bundle from the device.

```typescript
invoke("uninstall_bundle", { connectKey: string, bundleName: string }): Promise<string>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `connectKey` | `string` | Device connect_key |
| `bundleName` | `string` | Bundle name, e.g. `"com.example.app"` |

**Returns**: Combined stdout+stderr from `hdc uninstall`.

**Implementation**: Runs `hdc -t {connectKey} uninstall {bundleName}`.

**Notes**: This command works reliably for user-installed apps. System and vendor apps will generally fail with an error on production firmware (no root-based fallback is available, unlike the ADB module's `pm uninstall -k --user 0` soft-disable path). The error message from the device is surfaced to the user via `message.error(...)`.

**Errors**: Rejects if `hdc uninstall` exits with a non-zero code AND the output does not contain `"success"`.

---

## 8. Events (Backend → Frontend)

Events are emitted by the Rust backend via `app.emit()` and subscribed to in the frontend via `listen()`.

---

### `hdc_devices_changed`

Emitted by the device watcher whenever the OHOS device list changes, or after `attempt_remount` completes for a newly connected device.

```typescript
listen("hdc_devices_changed", (event: { payload: OhosDevice[] }) => { ... })
```

**Payload**: `OhosDevice[]` — the complete current device list with remount status merged in.

**Trigger conditions**:
- Any device connects or disconnects
- A device transitions between states
- After `attempt_remount` finishes (to update `is_remounted`/`remount_info`)

---

### `hdc_shell_output`

Emitted by `start_hdc_shell_stream` for each chunk of stdout read from the running process.

```typescript
listen("hdc_shell_output", (event: { payload: HdcShellOutput }) => { ... })
```

**Payload**: `HdcShellOutput { connect_key, data }`

---

### `hdc_shell_exit`

Emitted when a shell stream process exits (naturally or after `stop_hdc_shell_stream`).

```typescript
listen("hdc_shell_exit", (event: { payload: HdcShellExit }) => { ... })
```

**Payload**: `HdcShellExit { connect_key, code }`

**Notes**: `code: -1` means the exit code could not be determined.

---

### `hilog_lines`

Emitted by `start_hilog` in batches of parsed log entries.

```typescript
listen("hilog_lines", (event: { payload: HilogEntry[] }) => { ... })
```

**Payload**: `HilogEntry[]` — 1 to 64 entries per batch.

**Notes**: Only entries passing the `HilogFilter` supplied to `start_hilog` are included. The batch is flushed at 64 entries or 50 ms, whichever comes first.

---

### `transfer_progress`

Shared with the ADB module. Emitted during `send_hdc_files` and `recv_hdc_file`.

```typescript
listen("transfer_progress", (event: { payload: TransferProgress }) => { ... })
```

**Notes**: HDC does not expose byte-level progress markers, so only `percent: 0` (start) and `percent: 100` (completion) are emitted. See the ADB Module API Reference for the `TransferProgress` type definition.

---

## 9. Frontend Utility Wrappers

All wrappers are in `src/utils/hdc.ts` and are thin `invoke()` calls with TypeScript types.

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
} from "../utils/hdc";
```

| Wrapper | Maps to command |
|---------|-----------------|
| `getOhosDevices()` | `get_ohos_devices` |
| `connectOhosDevice(addr)` | `connect_ohos_device` |
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
| `listBundles(connectKey)` | `list_bundles` |
| `installHap(connectKey, hapPath)` | `install_hap` |
| `uninstallBundle(connectKey, bundleName)` | `uninstall_bundle` |

---

## 10. Error Handling

All Tauri commands return `Result<T, String>` on the Rust side, mapping to a rejected Promise on the frontend. The rejection value is always a plain human-readable string.

**Recommended pattern:**

```typescript
try {
  await someHdcCommand(...);
} catch (e) {
  message.error(String(e));
}
```

**Common error messages:**

| Situation | Error string |
|-----------|-------------|
| `hdc` binary not found | `"Failed to run hdc: ..."` |
| `bm dump -a` fails | `"Failed to run bm dump: ..."` |
| Non-zero exit from shell command | Combined stdout+stderr as error string |
| HiLog already running | `"HiLog already running for {connectKey}"` |
| No HiLog stream active | `"No HiLog running for {connectKey}"` |
| No shell stream active | `"No HDC shell stream running for {connectKey}"` |
| File send/recv failure | Non-zero exit output from `hdc file send/recv` |

---

## 11. HDC Tool Resolution

**Source**: `src-tauri/src/hdc/commands.rs` — `hdc_path()`

The HDC binary is located at runtime by searching the following locations in order:

1. **Bundled resource** — `{app_resource_dir}/hdc/hdc.exe` (for the shipped app)
2. **DevEco Studio SDK** — `%DEVECO_SDK_HOME%/hdc.exe` (environment variable)
3. **DevEco Studio default install** — `%LOCALAPPDATA%/DevEco Studio/sdk/**/toolchains/hdc.exe` (glob search)
4. **System PATH** — `hdc` (relies on the OS to find it)

If none of the above locations yield a working binary, all HDC commands will fail with a spawn error. Users should ensure DevEco Studio is installed or `hdc` is on their PATH.

**Differences from ADB**: Unlike ADB (which uses `tauri-plugin-shell` for subprocess management), the HDC module uses `tokio::process::Command` directly. This is because HDC requires spawning interactive subprocesses with precise argument control that the shell plugin abstraction does not easily support.
