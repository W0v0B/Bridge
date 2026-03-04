use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::time::Duration;

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::process::Command;

use super::commands::adb_path;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AdbDevice {
    pub serial: String,
    pub state: String,
    pub model: String,
    pub product: String,
    pub transport_id: String,
    pub is_root: bool,
    pub is_remounted: bool,
}

/// Tracks root/remount status per device serial, persisted for the session.
static DEVICE_ROOT_STATUS: Lazy<Mutex<HashMap<String, (bool, bool)>>> =
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
            is_remounted: false,
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
            if let Some(&(is_root, is_remounted)) = root_status.get(&device.serial) {
                device.is_root = is_root;
                device.is_remounted = is_remounted;
            }
        }
    }

    Ok(devices)
}

/// Connect to a network device via `adb connect host:port`.
pub async fn connect_network_device(host: &str, port: u16) -> Result<String, String> {
    use super::commands::run_adb;
    let addr = format!("{}:{}", host, port);
    run_adb(&["connect", &addr]).await
}

/// Disconnect a device via `adb disconnect serial`.
pub async fn disconnect_device(serial: &str) -> Result<String, String> {
    use super::commands::run_adb;
    run_adb(&["disconnect", serial]).await
}

/// Attempt `adb root` then `adb remount` for a device.
/// Updates DEVICE_ROOT_STATUS and re-emits devices_changed.
async fn attempt_root_and_remount(serial: String, app: AppHandle) {
    let mut is_root = false;
    let mut is_remounted = false;

    // Try adb root — use Command directly so non-zero exit doesn't become an error
    if let Ok(output) = Command::new(adb_path())
        .args(["-s", &serial, "root"])
        .output()
        .await
    {
        let text = format!(
            "{}{}",
            String::from_utf8_lossy(&output.stdout).to_lowercase(),
            String::from_utf8_lossy(&output.stderr).to_lowercase()
        );

        if text.contains("already running as root") {
            is_root = true;
        } else if text.contains("restarting adbd as root") {
            // Daemon is restarting — poll whoami until confirmed or timeout
            for _ in 0..6 {
                tokio::time::sleep(Duration::from_secs(1)).await;
                if let Ok(out) = Command::new(adb_path())
                    .args(["-s", &serial, "shell", "whoami"])
                    .output()
                    .await
                {
                    if String::from_utf8_lossy(&out.stdout).trim() == "root" {
                        is_root = true;
                        break;
                    }
                }
            }
        }
        // else: "cannot run as root in production builds" or other error → is_root stays false
    }

    if is_root {
        if let Ok(output) = Command::new(adb_path())
            .args(["-s", &serial, "remount"])
            .output()
            .await
        {
            is_remounted = output.status.success();
        }
    }

    // Cache the result for this serial
    if let Ok(mut map) = DEVICE_ROOT_STATUS.lock() {
        map.insert(serial.clone(), (is_root, is_remounted));
    }

    // Re-emit the device list with updated root status
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
