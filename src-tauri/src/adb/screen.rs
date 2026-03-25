use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use base64::Engine as _;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use super::commands::adb_path;
use crate::util::cmd;

/// Active screen capture sessions. Key = device serial, value = cancellation flag.
static SCREEN_SESSIONS: Lazy<Mutex<HashMap<String, Arc<AtomicBool>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenCaptureConfig {
    /// Capture interval in milliseconds (clamped to 333–5000 ms).
    pub interval_ms: u64,
}

#[derive(Clone, Serialize)]
pub struct ScreenFrame {
    pub serial: String,
    pub data: String, // base64-encoded PNG
}

#[derive(Clone, Serialize)]
pub struct ScreenCaptureState {
    pub serial: String,
    pub running: bool,
}

pub async fn start(serial: &str, config: ScreenCaptureConfig, app: AppHandle) -> Result<(), String> {
    // Stop any existing session for this device first
    stop(serial).await?;

    let cancelled = Arc::new(AtomicBool::new(false));
    {
        let mut map = SCREEN_SESSIONS.lock().map_err(|e| e.to_string())?;
        map.insert(serial.to_string(), Arc::clone(&cancelled));
    }

    let _ = app.emit("adb_screen_state", ScreenCaptureState {
        serial: serial.to_string(),
        running: true,
    });

    let s = serial.to_string();
    let interval_ms = config.interval_ms.clamp(333, 5000);
    let adb = adb_path();

    tokio::spawn(async move {
        let mut consecutive_failures: u32 = 0;

        loop {
            if cancelled.load(Ordering::Relaxed) {
                break;
            }

            let result = cmd(&adb)
                .args(["-s", &s, "exec-out", "screencap", "-p"])
                .output()
                .await;

            match result {
                Ok(output) if output.status.success() && !output.stdout.is_empty() => {
                    consecutive_failures = 0;
                    let b64 = base64::engine::general_purpose::STANDARD.encode(&output.stdout);
                    let _ = app.emit("adb_screen_frame", ScreenFrame {
                        serial: s.clone(),
                        data: b64,
                    });
                }
                _ => {
                    consecutive_failures += 1;
                    if consecutive_failures >= 5 {
                        break;
                    }
                }
            }

            tokio::time::sleep(std::time::Duration::from_millis(interval_ms)).await;
        }

        // Cleanup: remove from sessions map
        if let Ok(mut map) = SCREEN_SESSIONS.lock() {
            map.remove(&s);
        }

        let _ = app.emit("adb_screen_state", ScreenCaptureState {
            serial: s,
            running: false,
        });
    });

    Ok(())
}

pub async fn stop(serial: &str) -> Result<(), String> {
    let cancelled = {
        let mut map = SCREEN_SESSIONS.lock().map_err(|e| e.to_string())?;
        map.remove(serial)
    };
    if let Some(flag) = cancelled {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(())
}

pub fn is_running(serial: &str) -> bool {
    SCREEN_SESSIONS
        .lock()
        .map(|m| m.contains_key(serial))
        .unwrap_or(false)
}

/// Best-effort stop — called from device watcher on disconnect.
pub async fn kill_session(serial: &str) {
    let _ = stop(serial).await;
}
