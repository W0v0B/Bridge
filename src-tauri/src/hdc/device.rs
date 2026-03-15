use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::time::Duration;

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use crate::util::cmd;

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

/// Parse `hdc list targets` (non-verbose) output into a set of real connect keys.
///
/// Returns only keys that HDC considers genuine devices — phantoms (UART ports,
/// loopback listeners) are excluded by HDC itself.
fn parse_real_keys(output: &str) -> HashSet<String> {
    output
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty() && !l.starts_with('['))
        .collect()
}

/// Parse `hdc list targets -v` output into a map of connect_key → metadata.
///
/// Example line:
/// ```text
/// 127.0.0.1:5557          TCP     Connected       localhost       hdc
/// ```
fn parse_verbose_output(output: &str) -> HashMap<String, OhosDevice> {
    let mut map = HashMap::new();
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
        map.insert(
            connect_key.clone(),
            OhosDevice {
                connect_key,
                conn_type: parts.get(1).unwrap_or(&"USB").to_string(),
                state: parts.get(2).unwrap_or(&"Unknown").to_string(),
                name: parts.get(3).unwrap_or(&"").to_string(),
                is_remounted: false,
                remount_info: String::new(),
            },
        );
    }
    map
}

/// List currently connected OHOS devices, merging in cached remount status.
///
/// Uses `hdc list targets` as the authoritative source of real devices and
/// `hdc list targets -v` to enrich each entry with metadata (conn_type, state,
/// name). This eliminates all phantom entries (UART/COM port scans, loopback
/// listeners) without any special-case filters.
pub async fn list_devices() -> Result<Vec<OhosDevice>, String> {
    let (brief, verbose) = tokio::try_join!(
        run_hdc(&["list", "targets"]),
        run_hdc(&["list", "targets", "-v"]),
    )
    .map_err(|e| e.to_string())?;

    let real_keys = parse_real_keys(&brief);
    let verbose_map = parse_verbose_output(&verbose);

    let mut devices: Vec<OhosDevice> = real_keys
        .iter()
        .filter_map(|key| {
            verbose_map.get(key).cloned().or_else(|| {
                // Key appeared in non-verbose but not verbose (race); build minimal entry
                Some(OhosDevice {
                    connect_key: key.clone(),
                    conn_type: if key.contains(':') { "TCP".into() } else { "USB".into() },
                    state: "Connected".into(),
                    name: String::new(),
                    is_remounted: false,
                    remount_info: String::new(),
                })
            })
        })
        .collect();

    // Merge cached remount status
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

/// Connect to an OHOS device over TCP: `hdc tconn <addr>`.
pub async fn connect_device(addr: &str) -> Result<String, String> {
    run_hdc(&["tconn", addr]).await
}

/// Disconnect an OHOS device: `hdc tconn <addr> -remove`.
pub async fn disconnect_device(addr: &str) -> Result<String, String> {
    let result = run_hdc(&["tconn", addr, "-remove"]).await;

    // Clean up cached remount status for this device
    if let Ok(mut map) = DEVICE_REMOUNT_STATUS.lock() {
        map.remove(addr);
    }

    result
}

/// Try a single remount command and return (success, output_message).
async fn try_remount_cmd(_connect_key: &str, args: &[&str]) -> (bool, String) {
    match cmd(hdc_path()).args(args).output().await {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
            let combined = format!("{}{}", stdout, stderr);
            let trimmed = combined.trim().to_string();

            let has_failure = trimmed.contains("[Fail]")
                || trimmed.contains("not user mountable")
                || trimmed.contains("Operation not permitted")
                || trimmed.contains("debug mode")
                || trimmed.contains("Read-only file system");
            let success = out.status.success() && !has_failure;

            let info = if trimmed.is_empty() {
                if success { "Mount successful".to_string() }
                else { "Mount failed (no output)".to_string() }
            } else {
                trimmed
            };

            (success, info)
        }
        Err(e) => (false, format!("Failed to run hdc: {}", e)),
    }
}

/// Attempt to remount a device by running both commands sequentially:
/// 1. `hdc -t <key> shell mount -o rw,remount /`
/// 2. `hdc -t <key> target mount`
/// Both are required for a successful remount.
/// Updates DEVICE_REMOUNT_STATUS and re-emits hdc_devices_changed.
async fn attempt_remount(connect_key: String, app: AppHandle) {
    // Step 1: shell mount -o rw,remount /
    let (ok1, info1) = try_remount_cmd(
        &connect_key,
        &["-t", &connect_key, "shell", "mount", "-o", "rw,remount", "/"],
    ).await;

    // Step 2: hdc target mount
    let (ok2, info2) = try_remount_cmd(
        &connect_key,
        &["-t", &connect_key, "target", "mount"],
    ).await;

    let is_remounted = ok1 && ok2;
    let info = if is_remounted {
        info2
    } else if !ok1 {
        info1
    } else {
        info2
    };

    if let Ok(mut map) = DEVICE_REMOUNT_STATUS.lock() {
        map.insert(connect_key.clone(), (is_remounted, info));
    }

    // Re-emit with updated remount status
    if let Ok(devices) = list_devices().await {
        let _ = app.emit("hdc_devices_changed", &devices);
    }
}

/// Start a background task that polls `hdc list targets` every 2 seconds,
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
