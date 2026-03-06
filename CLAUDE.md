# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**DevBridge** — a Windows desktop tool that unifies ADB device management and serial port debugging in a single interface. Built with Tauri 2 (Rust backend) + React + TypeScript frontend.

## Development Commands

```bash
# Run in dev mode (starts both Vite dev server and Tauri window)
npm run tauri dev

# Build the frontend only
npm run build

# Build the full Tauri app for distribution
npm run tauri build

# Type-check the frontend
npx tsc --noEmit

# Check/build Rust backend only
cd src-tauri && cargo check
cd src-tauri && cargo build
```

## Architecture

### IPC Pattern

The frontend communicates with the Rust backend exclusively through two Tauri mechanisms:
- **`invoke()`** — request/response for commands (defined in `src/utils/adb.ts` and `src/utils/serial.ts`)
- **`listen()`** — event subscriptions for async push events (e.g., `"adb-devices"` event in `src/hooks/useAdbEvents.ts`)

All Tauri commands are registered in `src-tauri/src/lib.rs` via `tauri::generate_handler![]`. Adding a new command requires: implementing it in the appropriate module, registering it in `lib.rs`, and creating a typed wrapper in the corresponding `src/utils/*.ts` file.

### Frontend (`src/`)

- **`App.tsx`** — top-level layout: Ant Design `Layout` with `Sider` (Sidebar) + `Content` (Tabs) + `StatusBar`. Dark theme via `ConfigProvider`.
- **`components/layout/`** — `Sidebar`, `Toolbar`, `StatusBar`
- **`components/adb/`** — `DeviceList`, `FileManager`, `LogcatPanel`, `TransferQueue`
- **`components/serial/`** — `SerialTerminal` (xterm.js), `QuickCommandPanel`, `SerialConfig`, `CommandEditor`
- **`store/`** — Zustand stores: `deviceStore.ts` (selected ADB device), `serialStore.ts` (active port + baud rate), `configStore.ts`
- **`hooks/`** — `useAdbEvents.ts`, `useSerialEvents.ts` — subscribe to Tauri events and sync into stores
- **`utils/`** — thin wrappers around `invoke()`: `adb.ts` and `serial.ts`

### Backend (`src-tauri/src/`)

- **`lib.rs`** — entry point; registers all Tauri plugins and commands
- **`adb/`** — `device.rs` (device listing), `file.rs` (push/pull), `logcat.rs` (start/stop), `commands.rs` (shell stream, reboot), `apps.rs` (package list, install/uninstall)
- **`serial/`** — `manager.rs` (port open/close/write using a `Lazy<Mutex<HashMap>>` to track open ports), `state.rs`
- **`config.rs`** — persistent configuration

The ADB implementation calls the `adb` CLI binary. The binary is expected to be bundled under `src-tauri/resources/adb/` for the shipped app (no user install required).

### Key Dependencies

| Layer | Key Libraries |
|---|---|
| Frontend | React 18, Ant Design 5 (dark theme), Zustand, xterm.js + xterm-addon-fit, @dnd-kit/core, react-resizable-panels |
| Tauri plugins | tauri-plugin-shell, tauri-plugin-dialog, tauri-plugin-fs, tauri-plugin-store |
| Rust | tokio (async runtime), serialport 4 (serial I/O), once_cell (global state), serde/serde_json, uuid |

## Key Design Decisions

- **ADB via subprocess**: The Rust backend shells out to `adb` CLI via `tauri-plugin-shell`; it does not use a native Rust ADB library.
- **Serial port state**: Open serial ports are held in a process-global `Lazy<Mutex<HashMap<String, Box<dyn SerialPort>>>>` in `serial/manager.rs`.
- **Non-blocking UI**: Long-running operations (file transfer, logcat streaming) must use async Rust and Tauri events to push results to the frontend without blocking.
- **Design spec**: Full feature and UI design is in `docs/ADB & Serial Port Debugging Tools — Design Document(EN).md` — consult it for intended behavior before implementing features.
