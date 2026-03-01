use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use super::commands::run_adb;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AdbDevice {
    pub serial: String,
    pub state: String,
    pub model: String,
    pub product: String,
    pub transport_id: String,
}

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
        });
    }
    devices
}

/// List currently connected ADB devices.
pub async fn list_devices() -> Result<Vec<AdbDevice>, String> {
    let output = run_adb(&["devices", "-l"]).await?;
    Ok(parse_devices_output(&output))
}

/// Connect to a network device via `adb connect host:port`.
pub async fn connect_network_device(host: &str, port: u16) -> Result<String, String> {
    let addr = format!("{}:{}", host, port);
    run_adb(&["connect", &addr]).await
}

/// Disconnect a device via `adb disconnect serial`.
pub async fn disconnect_device(serial: &str) -> Result<String, String> {
    run_adb(&["disconnect", serial]).await
}

/// Start a background task that polls `adb devices -l` every 2 seconds
/// and emits `devices_changed` when the device list changes.
pub fn start_device_watcher(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut last_devices: Vec<AdbDevice> = Vec::new();
        loop {
            if let Ok(devices) = list_devices().await {
                if devices != last_devices {
                    last_devices = devices.clone();
                    let _ = app.emit("devices_changed", &last_devices);
                }
            }
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
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
    }
}
