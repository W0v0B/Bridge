use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::time::Duration;

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use crate::util::cmd;

use super::commands::adb_path;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AdbDevice {
    pub serial: String,
    pub state: String,
    pub model: String,
    pub product: String,
    pub transport_id: String,
    pub is_root: bool,
    /// Output from the `adb root` attempt; empty = attempt still in progress.
    pub root_info: String,
    pub is_remounted: bool,
    /// Output from the `adb remount` attempt; empty = attempt still in progress.
    pub remount_info: String,
}

/// Tracks (is_root, root_info, is_remounted, remount_info) per serial for the session.
static DEVICE_ROOT_STATUS: Lazy<Mutex<HashMap<String, (bool, String, bool, String)>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// Parse the output of `adb devices -l` into a list of AdbDevice.
fn parse_devices_output(output: &str) -> Vec<AdbDevice> {
    let mut devices = Vec::new();
    for line in output.lines().skip(1) {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 2 {
            continue;
        }
        let serial = parts[0].to_string();
        let state = parts[1].to_string();

        let mut model = String::new();
        let mut product = String::new();
        let mut transport_id = String::new();

        for part in &parts[2..] {
            if let Some(val) = part.strip_prefix("model:") {
                model = val.to_string();
            } else if let Some(val) = part.strip_prefix("product:") {
                product = val.to_string();
            } else if let Some(val) = part.strip_prefix("transport_id:") {
                transport_id = val.to_string();
            }
        }

        devices.push(AdbDevice {
            serial,
            state,
            model,
            product,
            transport_id,
            is_root: false,
            root_info: String::new(),
            is_remounted: false,
            remount_info: String::new(),
        });
    }
    devices
}

/// List currently connected ADB devices, merged with cached root/remount status.
pub async fn list_devices() -> Result<Vec<AdbDevice>, String> {
    use super::commands::run_adb;
    let output = run_adb(&["devices", "-l"]).await?;
    let mut devices = parse_devices_output(&output);

    if let Ok(root_status) = DEVICE_ROOT_STATUS.lock() {
        for device in &mut devices {
            if let Some((is_root, root_info, is_remounted, remount_info)) =
                root_status.get(&device.serial)
            {
                device.is_root = *is_root;
                device.root_info = root_info.clone();
                device.is_remounted = *is_remounted;
                device.remount_info = remount_info.clone();
            }
        }
    }

    Ok(devices)
}

/// Connect to a network device via `adb connect host:port`.
///
/// `adb connect` returns exit code 0 even when the connection fails,
/// putting "failed to connect" or "cannot connect" in stdout.  We check
/// for these and convert them into `Err` so the frontend can show a
/// proper error message instead of a green checkmark.
pub async fn connect_network_device(host: &str, port: u16) -> Result<String, String> {
    use super::commands::run_adb;
    let addr = format!("{}:{}", host, port);
    let result = run_adb(&["connect", &addr]).await?;
    let lower = result.to_lowercase();
    if lower.contains("failed to connect")
        || lower.contains("cannot connect")
        || lower.contains("unable to connect")
    {
        return Err(result.trim().to_string());
    }
    Ok(result)
}

/// Disconnect a device via `adb disconnect serial`.
pub async fn disconnect_device(serial: &str) -> Result<String, String> {
    use super::commands::run_adb;
    run_adb(&["disconnect", serial]).await
}

/// Attempt `adb root` then `adb remount` for a device.
/// Captures output text for both steps so the UI can show failure reasons.
async fn attempt_root_and_remount(serial: String, app: AppHandle) {
    // ── Step 1: adb root ──
    let (is_root, root_info) = match cmd(adb_path())
        .args(["-s", &serial, "root"])
        .output()
        .await
    {
        Err(e) => (false, format!("Failed to run adb root: {}", e)),
        Ok(output) => {
            let text = format!(
                "{}{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            let lower = text.to_lowercase();
            if lower.contains("already running as root") {
                (true, "Already running as root".to_string())
            } else if lower.contains("restarting adbd as root") {
                // Poll whoami until root is confirmed or timeout
                let mut rooted = false;
                for _ in 0..6 {
                    tokio::time::sleep(Duration::from_secs(1)).await;
                    if let Ok(out) = cmd(adb_path())
                        .args(["-s", &serial, "shell", "whoami"])
                        .output()
                        .await
                    {
                        if String::from_utf8_lossy(&out.stdout).trim() == "root" {
                            rooted = true;
                            break;
                        }
                    }
                }
                if rooted {
                    (true, "Restarted adbd as root".to_string())
                } else {
                    (false, "adbd restart timed out".to_string())
                }
            } else {
                (false, text.trim().to_string())
            }
        }
    };

    // ── Step 2: adb remount (only if root succeeded) ──
    let (is_remounted, remount_info) = if is_root {
        match cmd(adb_path())
            .args(["-s", &serial, "remount"])
            .output()
            .await
        {
            Err(e) => (false, format!("Failed to run adb remount: {}", e)),
            Ok(output) => {
                let text = format!(
                    "{}{}",
                    String::from_utf8_lossy(&output.stdout),
                    String::from_utf8_lossy(&output.stderr)
                )
                .trim()
                .to_string();
                let success = output.status.success();
                let info = if text.is_empty() {
                    if success {
                        "Remount successful".to_string()
                    } else {
                        "Remount failed (no output)".to_string()
                    }
                } else {
                    text
                };
                (success, info)
            }
        }
    } else {
        (false, "Remount requires root access".to_string())
    };

    if let Ok(mut map) = DEVICE_ROOT_STATUS.lock() {
        map.insert(serial.clone(), (is_root, root_info, is_remounted, remount_info));
    }

    if let Ok(devices) = list_devices().await {
        let _ = app.emit("devices_changed", &devices);
    }
}

/// Start a background task that polls `adb devices -l` every 2 seconds,
/// emits `devices_changed` when the list changes, and attempts root on new devices.
pub fn start_device_watcher(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut last_devices: Vec<AdbDevice> = Vec::new();
        // Track which serials we've already attempted root for this session
        let mut attempted_roots: HashSet<String> = HashSet::new();

        loop {
            if let Ok(devices) = list_devices().await {
                // Attempt root for any newly seen online device
                for device in &devices {
                    if device.state == "device" && !attempted_roots.contains(&device.serial) {
                        attempted_roots.insert(device.serial.clone());
                        let serial = device.serial.clone();
                        let app_clone = app.clone();
                        tokio::spawn(async move {
                            attempt_root_and_remount(serial, app_clone).await;
                        });
                    }
                }

                // Stop scrcpy for any device that disappeared
                if !last_devices.is_empty() {
                    let current_serials: HashSet<&str> =
                        devices.iter().map(|d| d.serial.as_str()).collect();
                    for prev in &last_devices {
                        if !current_serials.contains(prev.serial.as_str()) {
                            let serial = prev.serial.clone();
                            let app_clone = app.clone();
                            tokio::spawn(async move {
                                let _ = super::scrcpy::stop(&serial, &app_clone).await;
                            });
                        }
                    }
                }

                if devices != last_devices {
                    last_devices = devices.clone();
                    let _ = app.emit("devices_changed", &last_devices);
                }
            }
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_devices_output() {
        let output = "List of devices attached\n\
            emulator-5554          device product:sdk_gphone64_x86_64 model:sdk_gphone64_x86_64 transport_id:1\n\
            192.168.1.100:5555     device product:raven model:Pixel_6_Pro transport_id:2\n\
            \n";
        let devices = parse_devices_output(output);
        assert_eq!(devices.len(), 2);
        assert_eq!(devices[0].serial, "emulator-5554");
        assert_eq!(devices[0].state, "device");
        assert_eq!(devices[0].model, "sdk_gphone64_x86_64");
        assert_eq!(devices[1].serial, "192.168.1.100:5555");
        assert_eq!(devices[1].model, "Pixel_6_Pro");
        assert!(!devices[0].is_root);
        assert!(!devices[0].is_remounted);
    }
}
