<p align="right"><a href="README_CN.md">中文文档</a></p>

<h1 align="center">Bridge</h1>
<p align="center">A unified desktop debugging toolkit for Android (ADB), OpenHarmony (HDC), and Serial devices</p>

<p align="center">
  <img src="src-tauri/icons/icon.png" width="96" alt="Bridge icon" />
</p>

<p align="center">
  <img alt="Version" src="https://img.shields.io/badge/version-0.3.2-blue" />
  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows-lightgrey" />
  <img alt="Tauri" src="https://img.shields.io/badge/Tauri-2-24C8DB" />
  <img alt="Rust" src="https://img.shields.io/badge/Rust-stable-orange" />
  <img alt="React" src="https://img.shields.io/badge/React-18-61DAFB" />
</p>

---

Bridge is a Windows desktop application that brings ADB Android device management, OHOS (HarmonyOS / OpenHarmony) device management, and serial port / Telnet debugging into a single unified interface — so you never have to juggle multiple terminal windows again.

---

## Features

### Android (ADB)

| Feature | Description |
|---------|-------------|
| **Device Management** | Real-time device list with connection status, auto root/remount detection |
| **File Manager** | Browse device filesystem, upload/download files with progress, delete, inline file viewer (text & hex) |
| **Logcat** | Live logcat streaming with tag/level/keyword filtering, export to file |
| **App Manager** | List installed packages (user + system), install APK, uninstall/disable, force-stop, clear data |
| **Screen Mirror** | Launch [scrcpy](https://github.com/Genymobile/scrcpy) with configurable options (resolution, bitrate, orientation, recording…) + in-panel D-pad/key remote control |
| **Shell** | Streaming interactive shell with output buffer, log-to-file, and quick-command panel |

### OHOS / HarmonyOS (HDC)

| Feature | Description |
|---------|-------------|
| **Device Management** | Real-time device list (USB + TCP), auto-remount on connect, remount status per device |
| **File Manager** | Browse, upload, download, delete — same UX as ADB |
| **HiLog / tlogcat** | Dual-mode log streaming (HiLog and tlogcat) with level/keyword filtering and export |
| **App Manager** | List all HAP bundles with type classification (user/product/vendor/system), install HAP, uninstall, force-stop, clear data |
| **Screen Mirror** | In-app screen capture at configurable frame rates (0.2–3 fps) via `snapshot_display`; JPEG frames rendered directly in the panel |
| **Shell** | Same unified shell as ADB |

### Serial / Telnet

| Feature | Description |
|---------|-------------|
| **Terminal** | Full xterm.js terminal with configurable baud rate; supports ANSI colors and escape codes |
| **Telnet** | Connect to any host:port with Telnet protocol; IAC sequences stripped |
| **Quick Commands** | Persistent command panel — save, organize, and send commands with one click |
| **Sequence Runner** | Run an ordered list of quick commands on a loop with a configurable interval |
| **Log Export** | Snapshot the current buffer or stream logs continuously to a file |

### Shared

- **Unified device sidebar** — all ADB, OHOS, and serial devices in one list; switch context instantly
- **Shared remote control panel** — D-pad, Home/Back/Menu, Vol+/Vol−/Power buttons work on both ADB and OHOS screen mirror
- **Per-device output buffers** — switching devices never loses terminal or log history
- **Persistent config** — themes, connection defaults, quick commands, and settings survive restarts
- **Dark theme** — built on Ant Design 5 with a dark token set throughout

---

## Requirements

| Dependency | Notes |
|------------|-------|
| **Windows 10/11** | Only platform supported |
| **ADB** | Bundled in `src-tauri/resources/adb/` for the release build; must be on PATH for dev |
| **HDC (hdc.exe)** | Required for OHOS features — install [DevEco Studio](https://developer.huawei.com/consumer/cn/deveco-studio/) or place `hdc` on PATH |
| **scrcpy** | Required for ADB Screen Mirror — install via [scrcpy releases](https://github.com/Genymobile/scrcpy/releases) and ensure it is on PATH |

---

## Installation

> **Pre-built installers are not yet published.** Build from source using the instructions below.

---

## Building from Source

### Prerequisites

- [Node.js](https://nodejs.org/) ≥ 18
- [Rust](https://www.rust-lang.org/tools/install) stable toolchain
- [Tauri CLI](https://tauri.app/v2/start/prerequisites/): `cargo install tauri-cli`

### Steps

```bash
# Clone the repository
git clone https://github.com/your-org/bridge.git
cd bridge

# Install frontend dependencies
npm install

# Run in development mode (Vite dev server + Tauri window)
npm run tauri dev

# Build a production installer
npm run tauri build
```

### Useful Dev Commands

```bash
# Type-check the frontend only
npx tsc --noEmit

# Check/build Rust backend only
cd src-tauri && cargo check
cd src-tauri && cargo build
```

---

## Tech Stack

| Layer | Technologies |
|-------|-------------|
| **Frontend** | React 18, TypeScript, Ant Design 5 (dark theme), Zustand, xterm.js, react-resizable-panels |
| **Backend** | Rust, Tokio (async runtime), serialport 4, once_cell |
| **Bridge** | Tauri 2 (`tauri-plugin-shell`, `tauri-plugin-dialog`, `tauri-plugin-fs`, `tauri-plugin-store`) |
| **Build** | Vite, Cargo |

---

## Documentation

Full API reference and design documentation is in the [`docs/`](docs/) directory:

| Document | Description |
|----------|-------------|
| [Design Document](docs/EN/Bridge%20%E2%80%94%20Design%20Document.md) | Architecture, module design, feature spec, UI layout |
| [ADB Module API Reference](docs/EN/ADB%20Module%20API%20Reference.md) | All ADB Tauri commands, events, and data types |
| [OHOS Module API Reference](docs/EN/OHOS%20Module%20API%20Reference.md) | All HDC/OHOS Tauri commands, events, and data types |
| [Serial Module API Reference](docs/EN/Serial%20Module%20API%20Reference.md) | Serial port and Telnet commands, events, and state model |

Chinese translations are available in [`docs/CN/`](docs/CN/).

---

## Project Structure

```
Bridge/
├── src-tauri/          # Rust backend
│   ├── src/
│   │   ├── adb/        # ADB device, file, logcat, apps, scrcpy
│   │   ├── hdc/        # OHOS device, file, hilog, apps, screen mirror
│   │   ├── serial/     # Serial port + Telnet manager
│   │   └── lib.rs      # Command registration and app setup
│   └── resources/      # Bundled ADB binary
├── src/                # React frontend
│   ├── components/
│   │   ├── adb/        # ADB-specific panels
│   │   ├── hdc/        # OHOS-specific panels
│   │   ├── shared/     # Shared components (RemoteControlPanel, UploadModal)
│   │   └── layout/     # Sidebar, StatusBar, ConnectModal
│   ├── hooks/          # Tauri event subscriptions
│   ├── store/          # Zustand state stores
│   └── utils/          # invoke() wrappers
└── docs/
    ├── EN/             # English documentation
    └── CN/             # Chinese documentation (中文文档)
```

---

## License

This project is licensed under the [MIT License](LICENSE).

Copyright (c) 2026 W0v0B

Third-party dependency attributions are listed in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
