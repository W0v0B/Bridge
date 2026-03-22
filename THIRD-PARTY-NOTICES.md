# Third-Party Notices

Bridge includes or depends on the following third-party software. Each component is used under the terms of its respective license, as noted below.

---

## Rust Crates

### serialport

- **Version**: 4.x
- **License**: Mozilla Public License 2.0 (MPL-2.0)
- **Source**: https://github.com/serialport/serialport-rs
- **Usage**: Serial port enumeration and I/O (`src-tauri/src/serial/`)

MPL-2.0 is a file-level copyleft license. Bridge uses this crate as an unmodified dependency; no Bridge source files are subject to MPL-2.0 terms. If you modify any source files of the `serialport` crate itself (e.g., when vendoring), those modified files must remain available under MPL-2.0.

The full MPL-2.0 license text is available at: https://www.mozilla.org/en-US/MPL/2.0/

---

### Tauri and Tauri Plugins

The following crates are licensed under **MIT OR Apache-2.0** (dual-licensed). Bridge uses them under the MIT option.

| Crate | Version | Source |
|-------|---------|--------|
| `tauri` | 2.x | https://github.com/tauri-apps/tauri |
| `tauri-build` | 2.x | https://github.com/tauri-apps/tauri |
| `tauri-plugin-shell` | 2.x | https://github.com/tauri-apps/plugins-workspace |
| `tauri-plugin-dialog` | 2.x | https://github.com/tauri-apps/plugins-workspace |
| `tauri-plugin-fs` | 2.x | https://github.com/tauri-apps/plugins-workspace |
| `tauri-plugin-store` | 2.x | https://github.com/tauri-apps/plugins-workspace |

Apache-2.0 license text: https://www.apache.org/licenses/LICENSE-2.0

---

### Other Rust Crates (MIT or MIT/Apache-2.0)

The following crates are MIT-licensed or MIT/Apache-2.0 dual-licensed, fully compatible with this project's MIT license:

| Crate | License |
|-------|---------|
| `tokio` | MIT |
| `serde` / `serde_json` | MIT OR Apache-2.0 |
| `once_cell` | MIT OR Apache-2.0 |
| `uuid` | MIT OR Apache-2.0 |
| `base64` | MIT OR Apache-2.0 |
| `regex` | MIT OR Apache-2.0 |

---

## npm Packages

All npm dependencies are MIT-licensed. Key packages:

| Package | License | Source |
|---------|---------|--------|
| `react` / `react-dom` | MIT | https://github.com/facebook/react |
| `antd` | MIT | https://github.com/ant-design/ant-design |
| `zustand` | MIT | https://github.com/pmndrs/zustand |
| `xterm` / `xterm-addon-fit` | MIT | https://github.com/xtermjs/xterm.js |
| `@dnd-kit/core` | MIT | https://github.com/clauderic/dnd-kit |
| `react-resizable-panels` | MIT | https://github.com/bvaughn/react-resizable-panels |
| `@tauri-apps/api` | MIT OR Apache-2.0 | https://github.com/tauri-apps/tauri |

---

## Bundled Binaries

### Android Debug Bridge (ADB)

- **License**: Apache License 2.0
- **Source**: https://android.googlesource.com/platform/packages/modules/adb/
- **Part of**: Android SDK Platform Tools — https://developer.android.com/tools/releases/platform-tools

When the release build bundles the ADB binary, it is redistributed under the terms of the Apache License 2.0. The full Apache 2.0 license text is available at: https://www.apache.org/licenses/LICENSE-2.0

> **Note**: Redistribution of ADB is also subject to Google's Android SDK Terms of Service: https://developer.android.com/studio/terms

---

## External Tools (not bundled)

The following tools are detected at runtime if installed by the user. They are **not** distributed with Bridge.

- **scrcpy** — Apache-2.0 — https://github.com/Genymobile/scrcpy
- **HDC (hdc.exe)** — part of DevEco Studio / OpenHarmony SDK — https://developer.huawei.com/consumer/cn/deveco-studio/
