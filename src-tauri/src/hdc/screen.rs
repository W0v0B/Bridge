use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use base64::Engine as _;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::util::cmd;
use super::commands::hdc_path;

/// Active screen mirror sessions. Key = connect_key, value = cancellation flag.
static SCREEN_SESSIONS: Lazy<Mutex<HashMap<String, Arc<AtomicBool>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenMirrorConfig {
    /// Capture interval in milliseconds (clamped to 333–5000 ms).
    pub interval_ms: u64,
}

#[derive(Clone, Serialize)]
pub struct ScreenFrame {
    pub connect_key: String,
    pub data: String, // base64-encoded JPEG
}

#[derive(Clone, Serialize)]
pub struct ScreenMirrorState {
    pub connect_key: String,
    pub running: bool,
}

pub async fn start(connect_key: &str, config: ScreenMirrorConfig, app: AppHandle) -> Result<(), String> {
    // Stop any existing session for this device first
    stop(connect_key).await?;

    let cancelled = Arc::new(AtomicBool::new(false));
    {
        let mut map = SCREEN_SESSIONS.lock().map_err(|e| e.to_string())?;
        map.insert(connect_key.to_string(), Arc::clone(&cancelled));
    }

    let _ = app.emit("hdc_screen_state", ScreenMirrorState {
        connect_key: connect_key.to_string(),
        running: true,
    });

    let ck = connect_key.to_string();
    let interval_ms = config.interval_ms.clamp(333, 5000);

    tokio::spawn(async move {
        let remote_path = "/data/local/tmp/devbridge_screen.jpeg";
        let sanitized_key = ck.replace(':', "_");
        let local_path = std::env::temp_dir()
            .join(format!("devbridge_screen_{}.jpeg", sanitized_key));
        let local_path_str = local_path.to_string_lossy().to_string();

        let mut consecutive_failures: u32 = 0;

        loop {
            if cancelled.load(Ordering::Relaxed) {
                break;
            }

            // Capture screenshot on device
            let snap_ok = cmd(hdc_path())
                .args(["-t", &ck, "shell", "snapshot_display", "-f", remote_path])
                .output()
                .await
                .map(|o| o.status.success())
                .unwrap_or(false);

            if !snap_ok {
                consecutive_failures += 1;
                if consecutive_failures >= 5 {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(interval_ms)).await;
                continue;
            }

            // Transfer screenshot to host
            let recv_ok = cmd(hdc_path())
                .args(["-t", &ck, "file", "recv", remote_path, &local_path_str])
                .output()
                .await
                .map(|o| o.status.success())
                .unwrap_or(false);

            if !recv_ok {
                consecutive_failures += 1;
                if consecutive_failures >= 5 {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(interval_ms)).await;
                continue;
            }

            // Read file and emit frame event
            match tokio::fs::read(&local_path).await {
                Ok(bytes) => {
                    consecutive_failures = 0;
                    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
                    let _ = app.emit("hdc_screen_frame", ScreenFrame {
                        connect_key: ck.clone(),
                        data: b64,
                    });
                }
                Err(_) => {
                    consecutive_failures += 1;
                    if consecutive_failures >= 5 {
                        break;
                    }
                }
            }

            // Remove local temp file after emitting
            let _ = tokio::fs::remove_file(&local_path).await;

            tokio::time::sleep(std::time::Duration::from_millis(interval_ms)).await;
        }

        // Cleanup: remove from sessions map
        if let Ok(mut map) = SCREEN_SESSIONS.lock() {
            map.remove(&ck);
        }

        // Best-effort cleanup of temp files
        let _ = tokio::fs::remove_file(&local_path).await;
        let _ = cmd(hdc_path())
            .args(["-t", &ck, "shell", &format!("rm -f {}", remote_path)])
            .output()
            .await;

        let _ = app.emit("hdc_screen_state", ScreenMirrorState {
            connect_key: ck,
            running: false,
        });
    });

    Ok(())
}

pub async fn stop(connect_key: &str) -> Result<(), String> {
    let cancelled = {
        let mut map = SCREEN_SESSIONS.lock().map_err(|e| e.to_string())?;
        map.remove(connect_key)
    };
    if let Some(flag) = cancelled {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(())
}

pub fn is_running(connect_key: &str) -> bool {
    SCREEN_SESSIONS
        .lock()
        .map(|m| m.contains_key(connect_key))
        .unwrap_or(false)
}

/// Best-effort stop — called from device watcher on disconnect.
pub async fn kill_session(connect_key: &str) {
    let _ = stop(connect_key).await;
}
