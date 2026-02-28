use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceInfo {
    pub serial: String,
    pub model: String,
    pub status: String,
}

pub async fn list_devices() -> Result<Vec<DeviceInfo>, String> {
    // TODO: Implement actual ADB device listing
    Ok(vec![])
}

pub async fn get_device_info(serial: &str) -> Result<DeviceInfo, String> {
    // TODO: Implement device info retrieval
    Err(format!("Device {} not found", serial))
}
