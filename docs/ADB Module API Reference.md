# ADB Module — API Reference

> **Project**: DevBridge
> **Module**: ADB (`src-tauri/src/adb/`, `src/utils/adb.ts`)
> **Last Updated**: 2026-03

This document is the complete API reference for the ADB module. It covers every Tauri command exposed to the frontend, every backend-to-frontend event, and all shared data types. Internal Rust helpers that are not exposed over IPC are not listed here.

---

## Table of Contents

1. [IPC Mechanism](#1-ipc-mechanism)
2. [Data Types](#2-data-types)
3. [Commands — Device Management](#3-commands--device-management)
4. [Commands — File Manager](#4-commands--file-manager)
5. [Commands — Shell](#5-commands--shell)
6. [Commands — Logcat](#6-commands--logcat)
7. [Commands — App Manager](#7-commands--app-manager)
8. [Events (Backend → Frontend)](#8-events-backend--frontend)
9. [Frontend Utility Wrappers](#9-frontend-utility-wrappers)
10. [Error Handling](#10-error-handling)

---

## 1. IPC Mechanism

All ADB commands follow the Tauri IPC pattern:

- **Frontend → Backend**: `invoke("command_name", { ...args })` — returns a `Promise` that resolves with the command's return value or rejects with an error string.
- **Backend → Frontend**: `app.emit("event_name", payload)` — push events that the frontend subscribes to via `listen()`.

All commands are `async` on the Rust side (tokio) and return `Result<T, String>`. The error variant always carries a human-readable message.

---

## 2. Data Types

### `AdbDevice`

Represents a connected ADB device. Returned by `get_devices` and emitted in `devices_changed`.

```typescript
interface AdbDevice {
  serial: string;        // Device serial number or "host:port" for network devices
  state: string;         // "device" | "offline" | "unauthorized" | "recovery" | ...
  model: string;         // e.g. "Pixel_6_Pro" (empty string if not reported)
  product: string;       // e.g. "raven" (empty string if not reported)
  transport_id: string;  // Internal ADB transport ID
  is_root: boolean;      // true if adbd is running as root on this device
  is_remounted: boolean; // true if the system partition was successfully remounted rw
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
    pub is_remounted: bool,
}
```

**Notes:**
- `is_root` and `is_remounted` are determined once per session when the device first comes online (see [Device Watcher](#device-watcher)). They are cached in `DEVICE_ROOT_STATUS` and merged into every subsequent `list_devices()` call.
- `state == "device"` means the device is fully connected and authorized.

---

### `FileEntry`

Represents a single file or directory entry returned by `list_files`.

```typescript
interface FileEntry {
  name: string;        // File/directory display name (symlinks strip the "-> target" suffix)
  path: string;        // Full absolute path on the device
  is_dir: boolean;     // true for directories and symlinks pointing to directories
  size: number;        // File size in bytes (0 for directories)
  permissions: string; // Unix permission string, e.g. "drwxrwxr-x"
  modified: string;    // Last-modified timestamp, e.g. "2024-01-15 10:30"
}
```

---

### `TransferProgress`

Emitted during `push_files` and `pull_file` operations.

```typescript
interface TransferProgress {
  id: string;        // UUID identifying this specific transfer operation
  file_name: string; // Base filename being transferred
  transferred: number; // Currently always 0 (byte-level tracking not yet implemented)
  total: number;       // Currently always 0
  percent: number;     // 0.0–100.0, parsed from adb stderr output
  speed: string;       // Currently always "" (speed not yet parsed)
}
```

**Notes:**
- Progress is parsed from `adb push`/`pull` stderr output via the regex `\[\s*(\d+)%\]`.
- A final event with `percent: 100.0` is always emitted when a transfer completes, even if no intermediate events were received.

---

### `LogEntry`

Represents one parsed log line. Used in `logcat_lines` and `tlogcat_lines` events and in `export_logs`.

```typescript
interface LogEntry {
  timestamp: string; // "MM-DD HH:MM:SS.mmm" or "" for tlogcat brief-format lines
  pid: string;       // Process ID string, e.g. "1234"
  tid: string;       // Thread ID string, e.g. "5678" (may be "" for tlogcat)
  level: string;     // "V" | "D" | "I" | "W" | "E" | "F"
  tag: string;       // Log tag, e.g. "ActivityManager"
  message: string;   // Log message body
}
```

---

### `LogcatFilter`

Input to `start_logcat`. All fields are optional — `null` means no filtering on that dimension.

```typescript
interface LogcatFilter {
  level: string | null;    // Minimum level threshold: "V"|"D"|"I"|"W"|"E"|"F" or null = all
  tags: string[] | null;   // Whitelist of tag substrings; null or [] = no tag filter
  keyword: string | null;  // Substring match against both tag and message; null = no filter
}
```

**Notes:**
- `level` filtering is a threshold: setting `"W"` passes W, E, and F; it rejects V, D, and I.
- Tag filtering checks if any whitelisted string is a substring of the entry's tag (`entry.tag.contains(t)`).
- Keyword filtering is case-insensitive.
- Filtering is applied in the Rust backend before emitting; non-matching entries never reach the frontend.

---

### `ShellOutput`

Payload of the `shell_output` event.

```typescript
interface ShellOutput {
  serial: string; // Device serial this output belongs to
  data: string;   // Raw text chunk (stdout or stderr, UTF-8 lossy)
}
```

---

### `ShellExit`

Payload of the `shell_exit` event.

```typescript
interface ShellExit {
  serial: string; // Device serial
  code: number;   // Process exit code; -1 if the code could not be determined
}
```

---

### `PackageInfo`

Returned by `list_packages`. Represents one installed package.

```typescript
interface PackageInfo {
  package_name: string; // e.g. "com.android.settings"
  apk_path: string;     // Full path to the base APK, e.g. "/system/app/Settings/Settings.apk"
  is_system: boolean;   // true if the package is NOT in "pm list packages -3" (third-party list)
}
```

---

## 3. Commands — Device Management

**Source**: `src-tauri/src/adb/device.rs`

---

### `get_devices`

Returns the current list of connected ADB devices.

```typescript
invoke("get_devices"): Promise<AdbDevice[]>
```

```typescript
// Frontend wrapper
import { getDevices } from "../utils/adb";
const devices = await getDevices();
```

**Returns**: Array of `AdbDevice`. Empty array if no devices are connected.

**Notes**: This is a one-shot read of the current state. For live updates, subscribe to the [`devices_changed`](#devices_changed) event instead. `is_root` and `is_remounted` are already merged in by the time this call returns.

---

### `connect_network_device`

Connects to an Android device over the network via `adb connect`.

```typescript
invoke("connect_network_device", { host: string, port: number }): Promise<string>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `host` | `string` | IP address or hostname, e.g. `"192.168.1.100"` |
| `port` | `number` | TCP port, typically `5555` |

**Returns**: Raw output string from `adb connect`, e.g. `"connected to 192.168.1.100:5555"` or `"already connected"`.

**Errors**: Rejects if `adb connect` exits with a non-zero code.

---

### `disconnect_device`

Disconnects a network-connected device via `adb disconnect`.

```typescript
invoke("disconnect_device", { serial: string }): Promise<string>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `serial` | `string` | Device serial, e.g. `"192.168.1.100:5555"` |

**Returns**: Raw output string from `adb disconnect`.

---

#### Device Watcher

`start_device_watcher(app)` is started automatically on app launch (in `lib.rs::setup`). It is not a Tauri command and cannot be called from the frontend directly.

**Behaviour:**
1. Polls `adb devices -l` every **2 seconds**.
2. When the device list changes, emits [`devices_changed`](#devices_changed).
3. For each newly seen device with `state == "device"`, spawns `attempt_root_and_remount()` **once per serial per session** (tracked in a session-local `HashSet`).
4. `attempt_root_and_remount()`:
   - Runs `adb -s {serial} root` and inspects output:
     - `"already running as root"` → `is_root = true`
     - `"restarting adbd as root"` → polls `adb -s {serial} shell whoami` every 1 s for up to 6 s; `is_root = true` when `"root"` is confirmed
     - Other output (e.g. `"cannot run as root in production builds"`) → `is_root = false`
   - If `is_root == true`, runs `adb -s {serial} remount`; `is_remounted = exit_status.success()`
   - Stores `(is_root, is_remounted)` in `DEVICE_ROOT_STATUS: Lazy<Mutex<HashMap<String, (bool, bool)>>>`
   - Re-emits `devices_changed` with the updated status

---

## 4. Commands — File Manager

**Source**: `src-tauri/src/adb/file.rs`

---

### `list_files`

Lists the contents of a directory on the device.

```typescript
invoke("list_files", { serial: string, path: string }): Promise<FileEntry[]>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `serial` | `string` | Device serial |
| `path` | `string` | Absolute path on the device, e.g. `"/sdcard"` |

**Returns**: Array of `FileEntry`, sorted: directories first, then by name (case-insensitive). Entries `.` and `..` are excluded.

**Implementation**: Runs `adb shell ls -la '{path}'` and parses each line with a regex matching the `ls -la` format. Symlink display names strip the `" -> target"` suffix.

**Errors**: Rejects if the path does not exist, is not readable (permission denied), or the `ls` command fails.

---

### `push_files`

Uploads one or more local files to a directory on the device.

```typescript
invoke("push_files", { serial: string, localPaths: string[], remotePath: string }): Promise<void>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `serial` | `string` | Device serial |
| `localPaths` | `string[]` | Absolute local paths to upload |
| `remotePath` | `string` | Destination directory on the device |

**Returns**: `void` on success.

**Side effects**: Emits [`transfer_progress`](#transfer_progress) events during the operation (one per progress line parsed from `adb push` stderr, plus a final `percent: 100` event per file).

**Notes**: Files are uploaded sequentially (one at a time). If any file fails, the command rejects immediately and subsequent files are not processed.

**Errors**: Rejects with `"adb push failed for {filename}"` on non-zero exit.

---

### `pull_file`

Downloads a single file from the device to the local machine.

```typescript
invoke("pull_file", { serial: string, remotePath: string, localPath: string }): Promise<void>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `serial` | `string` | Device serial |
| `remotePath` | `string` | Absolute path on the device |
| `localPath` | `string` | Destination path on the local machine (full path including filename) |

**Returns**: `void` on success.

**Side effects**: Emits [`transfer_progress`](#transfer_progress) events during the operation.

**Errors**: Rejects with `"adb pull failed for {filename}"` on non-zero exit.

---

### `delete_file`

Deletes a file or directory on the device.

```typescript
invoke("delete_file", { serial: string, path: string }): Promise<void>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `serial` | `string` | Device serial |
| `path` | `string` | Absolute path on the device |

**Returns**: `void` on success.

**Implementation**: Runs `adb shell rm -rf '{path}'`. This is recursive and non-recoverable — use with care.

**Errors**: Rejects if `rm` exits with a non-zero code (e.g. permission denied).

---

## 5. Commands — Shell

**Source**: `src-tauri/src/adb/commands.rs`

---

### `run_shell_command`

Runs a shell command synchronously and returns the full stdout output.

```typescript
invoke("run_shell_command", { serial: string, command: string }): Promise<string>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `serial` | `string` | Device serial |
| `command` | `string` | Shell command string passed to `adb -s {serial} shell` |

**Returns**: Complete stdout as a string.

**Notes**: This is a blocking call — it waits for the command to exit before returning. Use for short-lived commands only (e.g. `whoami`, `cat /proc/version`, `head -c 8192 /path`). For long-running or interactive commands, use `start_shell_stream` instead.

**Errors**: Rejects if `adb shell` exits with a non-zero code, with a message combining stderr and stdout.

---

### `start_shell_stream`

Starts a streaming shell command. Output (stdout and stderr) is emitted as [`shell_output`](#shell_output) events in real time. Completion is signaled by a [`shell_exit`](#shell_exit) event.

```typescript
invoke("start_shell_stream", { serial: string, command: string }): Promise<void>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `serial` | `string` | Device serial |
| `command` | `string` | Shell command string |

**Returns**: `void` immediately (the stream runs in the background).

**Side effects**:
- If a stream is already running for this `serial`, it is killed first (auto-stop previous).
- Emits [`shell_output`](#shell_output) events with stdout and stderr chunks as they arrive.
- Emits [`shell_exit`](#shell_exit) when the process exits.

**Implementation details**:
- Spawns `adb -s {serial} shell {command}` with both stdout and stderr piped.
- Stdout is read in **8KB chunks** by one tokio task.
- Stderr is read in **4KB chunks** by a second parallel tokio task.
- Both tasks emit `shell_output` events, so command-not-found errors (exit 127) and other stderr messages appear in the terminal output.
- The process PID is stored in `SHELL_PROCESSES: Lazy<Mutex<HashMap<String, u32>>>` keyed by `"shell:{serial}"`.
- `kill_on_drop(true)` ensures the child is killed if the task is aborted.

**Errors**: Rejects only if the child process fails to spawn (e.g. `adb` not found).

---

### `stop_shell_stream`

Stops a running shell stream for a device.

```typescript
invoke("stop_shell_stream", { serial: string }): Promise<void>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `serial` | `string` | Device serial |

**Returns**: `void`.

**Implementation**: Removes the PID from `SHELL_PROCESSES` and runs `taskkill /F /T /PID` to kill the full process tree.

**Errors**: Rejects with `"No shell stream running for this device"` if no stream is active.

---

## 6. Commands — Logcat

**Source**: `src-tauri/src/adb/logcat.rs`

---

### `start_logcat`

Starts streaming logcat output for a device.

```typescript
invoke("start_logcat", { serial: string, filter: LogcatFilter }): Promise<void>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `serial` | `string` | Device serial |
| `filter` | `LogcatFilter` | Level/tag/keyword filter applied in the backend |

**Returns**: `void` immediately (streaming runs in background).

**Side effects**: Emits [`logcat_lines`](#logcat_lines) batches.

**Implementation**:
- Runs `adb -s {serial} logcat -v threadtime`.
- Parses lines with a lenient threadtime regex that handles both `MM-DD` and `YYYY-MM-DD` timestamp prefixes.
- Filtering (`passes_filter`) is applied in Rust before entries are added to the batch.
- Entries are batched and emitted when either: batch reaches **64 entries** or **50ms** have elapsed since the last flush (whichever comes first). This balances latency and IPC overhead.
- PID stored in `LOGCAT_PROCESSES` keyed by `"logcat:{serial}"`.

**Errors**: Rejects with `"Logcat already running for this device"` if a logcat stream is active. Call `stop_logcat` first.

---

### `stop_logcat`

Stops the logcat stream for a device.

```typescript
invoke("stop_logcat", { serial: string }): Promise<void>
```

**Implementation**: Removes PID from `LOGCAT_PROCESSES` and kills the process tree via `taskkill /F /T /PID`.

**Errors**: Rejects with `"No logcat running for this device"` if not active.

---

### `start_tlogcat`

Starts streaming TEE log (`tlogcat`) output for a device.

```typescript
invoke("start_tlogcat", { serial: string }): Promise<void>
```

**Returns**: `void` immediately.

**Side effects**: Emits [`tlogcat_lines`](#tlogcat_lines) batches.

**Implementation**:
- Runs `adb -s {serial} shell tlogcat`.
- Parsing is more permissive than logcat — tries threadtime regex first, then brief format (`L/Tag(PID): message`), then falls back to treating the entire line as an `INFO` message with an empty tag. This ensures no lines are silently dropped.
- No filter is applied (tlogcat does not support server-side level filtering).
- Same 64-entry / 50ms batch model as `start_logcat`.
- PID stored in `LOGCAT_PROCESSES` keyed by `"tlogcat:{serial}"`.

**Notes**: logcat and tlogcat are independent streams. Both can run simultaneously for the same device.

**Errors**: Rejects with `"tlogcat already running for this device"` if a tlogcat stream is active.

---

### `stop_tlogcat`

Stops the tlogcat stream for a device.

```typescript
invoke("stop_tlogcat", { serial: string }): Promise<void>
```

**Errors**: Rejects with `"No tlogcat running for this device"` if not active.

---

### `clear_device_log`

Clears the on-device logcat ring buffer (`adb logcat -c`). Does not affect the frontend display buffer.

```typescript
invoke("clear_device_log", { serial: string }): Promise<void>
```

**Errors**: Rejects if `logcat -c` exits with a non-zero code.

---

### `export_logs`

Writes an array of `LogEntry` objects to a text file on the local machine.

```typescript
invoke("export_logs", { logs: LogEntry[], path: string }): Promise<void>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `logs` | `LogEntry[]` | Entries to export (the caller applies any display-side filtering before passing) |
| `path` | `string` | Absolute local path to write, e.g. `"C:\\Users\\user\\Desktop\\log.txt"` |

**Output format** (one line per entry):
```
{timestamp} {pid} {tid} {level}/{tag}: {message}
```

**Errors**: Rejects if the file cannot be written.

---

## 7. Commands — App Manager

**Source**: `src-tauri/src/adb/apps.rs`

---

### `list_packages`

Returns a list of all packages installed on the device.

```typescript
invoke("list_packages", { serial: string }): Promise<PackageInfo[]>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `serial` | `string` | Device serial |

**Returns**: Array of `PackageInfo`, sorted: user apps first (alphabetically), then system apps (alphabetically).

**Implementation**:
1. Runs `adb -s {serial} shell pm list packages -f` — all packages with APK paths.
   - Each line format: `package:/data/app/com.example-1/base.apk=com.example`
   - Parsed by splitting on the **last** `=` character (APK paths may contain `=`).
2. Runs `adb -s {serial} shell pm list packages -3` — third-party (non-system) package names only.
3. Cross-references: `is_system = package_name NOT IN third_party_set`.

**Errors**: Rejects if either `pm` command fails to execute.

---

### `uninstall_package`

Uninstalls or disables a package from the device.

```typescript
invoke("uninstall_package", {
  serial: string,
  package: string,
  isSystem: boolean,
  isRoot: boolean,
}): Promise<string>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `serial` | `string` | Device serial |
| `package` | `string` | Package name, e.g. `"com.example.app"` |
| `isSystem` | `boolean` | Whether this is a system app (determines uninstall method) |
| `isRoot` | `boolean` | Whether the device is running adbd as root |

**Returns**: Combined stdout+stderr from the uninstall command (e.g. `"Success"`, `"Deleted 1 APKs"`).

**Method selection**:

| Condition | Command | Effect |
|-----------|---------|--------|
| `!isSystem` | `adb -s {serial} uninstall {package}` | Fully removes the user-installed app and its data |
| `isSystem && isRoot` | `adb -s {serial} shell pm uninstall {package}` | Fully removes the system app (permanent, requires root) |
| `isSystem && !isRoot` | `adb -s {serial} shell pm uninstall -k --user 0 {package}` | Soft-disables the app for the current user; does not remove APK |

**Errors**: Rejects if the command exits with a non-zero code AND the output does not contain `"success"` (case-insensitive). Some device firmwares return non-zero but include `"success"` in output — those are treated as success.

---

### `install_apk`

Installs an APK file from the local machine onto the device.

```typescript
invoke("install_apk", { serial: string, apkPath: string }): Promise<void>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `serial` | `string` | Device serial |
| `apkPath` | `string` | Absolute local path to the APK file |

**Returns**: `void` on success.

**Implementation**: Runs `adb -s {serial} install -r {apkPath}`. The `-r` flag allows reinstall/upgrade of an existing app.

**Errors**: Rejects if `adb install` exits with a non-zero code.

---

## 8. Events (Backend → Frontend)

Events are emitted by the Rust backend via `app.emit()` and subscribed to in the frontend via `listen()`.

---

### `devices_changed`

Emitted by the device watcher whenever the device list changes, or after `attempt_root_and_remount` completes for a newly connected device.

```typescript
listen("devices_changed", (event: { payload: AdbDevice[] }) => { ... })
```

**Payload**: `AdbDevice[]` — the complete current device list.

**Trigger conditions**:
- Any device connects or disconnects
- A device transitions between states (e.g. `"offline"` → `"device"`)
- After `attempt_root_and_remount` finishes (to update `is_root`/`is_remounted`)

---

### `shell_output`

Emitted by `start_shell_stream` for each chunk of stdout or stderr read from the running process.

```typescript
listen("shell_output", (event: { payload: ShellOutput }) => { ... })
```

**Payload**: `ShellOutput { serial, data }`

**Notes**: Multiple events may be emitted per second for high-throughput commands. The frontend uses `requestAnimationFrame`-based batching to coalesce updates into at most one React state update per frame (~60fps).

---

### `shell_exit`

Emitted when a shell stream process exits (naturally or after `stop_shell_stream`).

```typescript
listen("shell_exit", (event: { payload: ShellExit }) => { ... })
```

**Payload**: `ShellExit { serial, code }`

**Notes**: `code: -1` means the exit code could not be determined (e.g. the process was force-killed). Common codes: `0` = success, `127` = command not found.

---

### `logcat_lines`

Emitted by `start_logcat` in batches of parsed log entries.

```typescript
listen("logcat_lines", (event: { payload: LogEntry[] }) => { ... })
```

**Payload**: `LogEntry[]` — 1 to 64 entries per batch.

**Notes**: Only entries that pass the `LogcatFilter` supplied to `start_logcat` are included. The batch is flushed when it reaches 64 entries or 50ms have elapsed, whichever comes first.

---

### `tlogcat_lines`

Emitted by `start_tlogcat` in batches. Same semantics as `logcat_lines` but with no server-side level filtering.

```typescript
listen("tlogcat_lines", (event: { payload: LogEntry[] }) => { ... })
```

**Payload**: `LogEntry[]`

---

### `transfer_progress`

Emitted during `push_files` and `pull_file` operations.

```typescript
listen("transfer_progress", (event: { payload: TransferProgress }) => { ... })
```

**Payload**: `TransferProgress`

**Notes**: Progress is parsed from `adb` stderr lines matching `[ 42%]`. A final event with `percent: 100.0` is always emitted on completion. Multiple files in a `push_files` call each get their own UUID `id`.

---

## 9. Frontend Utility Wrappers

All wrappers are in `src/utils/adb.ts` and are thin `invoke()` calls with TypeScript types.

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
} from "../utils/adb";
```

| Wrapper | Maps to command |
|---------|-----------------|
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

---

## 10. Error Handling

All Tauri commands return `Result<T, String>` on the Rust side, which maps to a rejected Promise on the frontend. The rejection value is always a plain string with a human-readable message.

**Recommended pattern:**

```typescript
try {
  await someAdbCommand(...);
} catch (e) {
  message.error(String(e));
}
```

**Common error messages:**

| Situation | Error string |
|-----------|-------------|
| `adb` binary not found or crashes | `"Failed to run adb: ..."` |
| Non-zero exit from shell command | `"adb shell {cmd} failed: {stderr}{stdout}"` |
| Logcat already running | `"Logcat already running for this device"` |
| tlogcat already running | `"tlogcat already running for this device"` |
| No shell stream active | `"No shell stream running for this device"` |
| No logcat active | `"No logcat running for this device"` |
| File push/pull failure | `"adb push/pull failed for {filename}"` |
| Log export write failure | `"Failed to write log file: ..."` |

**Note on `run_shell_command`**: This command rejects on non-zero exit. For commands where exit code is expected to be non-zero but output is still useful (e.g. `grep` finding nothing), use `run_shell_command` with a try/catch and inspect the error string for the output.
