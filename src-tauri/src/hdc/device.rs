use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::time::Duration;

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::process::Command;

use super::commands::{hdc_path, run_hdc};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct OhosDevice {
    pub connect_key: String,
    pub conn_type: String, // "USB" | "TCP"
    pub state: String,     // "Connected" | "Offline" | "Unauthorized"
    pub name: String,
    /// Whether `hdc target mount` succeeded for this device this session.
    pub is_remounted: bool,
    /// The output from the remount attempt (empty = attempt still in progress).
    pub remount_info: String,
}

/// Cached remount results per connect_key: (is_remounted, info_message)
static DEVICE_REMOUNT_STATUS: Lazy<Mutex<HashMap<String, (bool, String)>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// Parse `hdc list targets -v` output.
///
/// Example:
/// ```
/// connect-key1            USB     Connected       localhost       hdc
/// 127.0.0.1:5555          TCP     Offline         localhost       hdc
/// ```
fn parse_devices_output(output: &str) -> Vec<OhosDevice> {
    let mut devices = Vec::new();
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('[') {
            continue;
        }
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 3 {
            continue;
        }
        let connect_key = parts[0].to_string();
        let state = parts.get(2).unwrap_or(&"Unknown").to_string();

        // HDC always emits a "127.0.0.1:5555 TCP Offline localhost" loopback
        // entry for its local emulator listener even when no device is attached.
        // Hide it unless it actually becomes Connected (real emulator).
        if connect_key == "127.0.0.1:5555" && state.eq_ignore_ascii_case("offline") {
            continue;
        }

        devices.push(OhosDevice {
            connect_key,
            conn_type: parts.get(1).unwrap_or(&"USB").to_string(),
            state,
            name: parts.get(3).unwrap_or(&"").to_string(),
            is_remounted: false,
            remount_info: String::new(),
        });
    }
    devices
}

/// List currently connected OHOS devices, merging in cached remount status.
pub async fn list_devices() -> Result<Vec<OhosDevice>, String> {
    match run_hdc(&["list", "targets", "-v"]).await {
        Ok(output) => {
            let mut devices = parse_devices_output(&output);
            if let Ok(status_map) = DEVICE_REMOUNT_STATUS.lock() {
                for device in &mut devices {
                    if let Some((is_remounted, info)) = status_map.get(&device.connect_key) {
                        device.is_remounted = *is_remounted;
                        device.remount_info = info.clone();
                    }
                }
            }
            Ok(devices)
        }
        Err(_) => Ok(Vec::new()),
    }
}

/// Connect to an OHOS device over TCP: `hdc tconn <addr>`.
pub async fn connect_device(addr: &str) -> Result<String, String> {
    run_hdc(&["tconn", addr]).await
}

/// Attempt `hdc target mount` for a device.
/// Updates DEVICE_REMOUNT_STATUS and re-emits hdc_devices_changed.
async fn attempt_remount(connect_key: String, app: AppHandle) {
    let output = Command::new(hdc_path())
        .args(["-t", &connect_key, "target", "mount"])
        .output()
        .await;

    let (is_remounted, info) = match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
            let combined = format!("{}{}", stdout, stderr);
            let trimmed = combined.trim().to_string();

            // Treat as success only when exit code is 0 AND output contains no failure markers.
            let has_failure = trimmed.contains("[Fail]")
                || trimmed.contains("not user mountable")
                || trimmed.contains("Operation not permitted")
                || trimmed.contains("debug mode");
            let success = out.status.success() && !has_failure;

            let info = if trimmed.is_empty() {
                if success {
                    "Mount successful".to_string()
                } else {
                    "Mount failed (no output)".to_string()
                }
            } else {
                trimmed
            };

            (success, info)
        }
        Err(e) => (false, format!("Failed to run hdc target mount: {}", e)),
    };

    if let Ok(mut map) = DEVICE_REMOUNT_STATUS.lock() {
        map.insert(connect_key.clone(), (is_remounted, info));
    }

    // Re-emit with updated remount status
    if let Ok(devices) = list_devices().await {
        let _ = app.emit("hdc_devices_changed", &devices);
    }
}

/// Start a background task that polls `hdc list targets -v` every 2 seconds,
/// emits `hdc_devices_changed` when the list changes, and auto-attempts
/// `hdc target mount` for newly connected devices.
pub fn start_device_watcher(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut last_devices: Vec<OhosDevice> = Vec::new();
        let mut attempted_remounts: HashSet<String> = HashSet::new();

        loop {
            if let Ok(devices) = list_devices().await {
                // Attempt remount for any newly connected device (once per session)
                for device in &devices {
                    if device.state.eq_ignore_ascii_case("connected")
                        && !attempted_remounts.contains(&device.connect_key)
                    {
                        attempted_remounts.insert(device.connect_key.clone());
                        let ck = device.connect_key.clone();
                        let app_clone = app.clone();
                        tokio::spawn(async move {
                            attempt_remount(ck, app_clone).await;
                        });
                    }
                }

                if devices != last_devices {
                    last_devices = devices.clone();
                    let _ = app.emit("hdc_devices_changed", &last_devices);
                }
            }
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
    });
}
