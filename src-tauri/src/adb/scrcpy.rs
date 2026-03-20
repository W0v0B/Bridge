use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use once_cell::sync::Lazy;
use serde::Deserialize;
use tauri::{AppHandle, Emitter};

use crate::util::cmd;

/// Resolve the path to the scrcpy executable.
/// Search order:
/// 1. Bundled copy under resources/scrcpy/scrcpy.exe
/// 2. Common install locations (Scoop, Chocolatey)
/// 3. Fall back to bare "scrcpy" and let the OS resolve it at spawn time
///
/// Unlike adb_path() which always falls back to "adb", we eagerly resolve
/// the full path so we can give a clear error when scrcpy is genuinely missing.
pub fn scrcpy_path() -> String {
    // 1. Check for bundled scrcpy relative to the executable
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let p = dir.join("resources").join("scrcpy").join("scrcpy.exe");
            if p.exists() {
                return p.to_string_lossy().to_string();
            }
        }
    }

    // 2. Check well-known install locations on Windows
    #[cfg(target_os = "windows")]
    {
        // Scoop: ~/scoop/shims/scrcpy.exe or ~/scoop/apps/scrcpy/current/scrcpy.exe
        if let Ok(profile) = std::env::var("USERPROFILE") {
            let scoop_shim = PathBuf::from(&profile).join("scoop").join("shims").join("scrcpy.exe");
            if scoop_shim.exists() {
                return scoop_shim.to_string_lossy().to_string();
            }
            let scoop_app = PathBuf::from(&profile).join("scoop").join("apps")
                .join("scrcpy").join("current").join("scrcpy.exe");
            if scoop_app.exists() {
                return scoop_app.to_string_lossy().to_string();
            }
        }
        // Chocolatey: C:\ProgramData\chocolatey\bin\scrcpy.exe
        let choco = PathBuf::from(r"C:\ProgramData\chocolatey\bin\scrcpy.exe");
        if choco.exists() {
            return choco.to_string_lossy().to_string();
        }
    }

    // 3. Fall back to bare "scrcpy" — let the OS resolve via PATH at spawn time
    "scrcpy".to_string()
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScrcpyConfig {
    pub max_size: Option<u16>,
    pub video_bitrate: Option<String>,
    pub max_fps: Option<u8>,
    pub stay_awake: Option<bool>,
    pub show_touches: Option<bool>,
    pub borderless: Option<bool>,
    pub always_on_top: Option<bool>,
    pub turn_screen_off: Option<bool>,
    pub power_off_on_close: Option<bool>,
    pub crop: Option<String>,
    pub lock_orientation: Option<u8>,
    pub record_path: Option<String>,
    pub no_audio: Option<bool>,
    pub keyboard_mode: Option<String>,
    pub mouse_mode: Option<String>,
}

/// Store PIDs of running scrcpy processes, keyed by device serial.
static SCRCPY_PROCESSES: Lazy<Mutex<HashMap<String, u32>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// Start scrcpy for a device.
pub async fn start(serial: &str, config: ScrcpyConfig, app: AppHandle) -> Result<(), String> {
    let scrcpy = scrcpy_path();

    // Kill any existing scrcpy for this serial
    let _ = stop(serial, &app).await;

    // Build argument list
    let mut args = vec![
        "-s".to_string(),
        serial.to_string(),
        "--window-title".to_string(),
        format!("DevBridge - {}", serial),
    ];

    if let Some(v) = config.max_size {
        args.push("--max-size".into());
        args.push(v.to_string());
    }
    if let Some(ref v) = config.video_bitrate {
        if !v.is_empty() {
            args.push("--video-bit-rate".into());
            args.push(v.clone());
        }
    }
    if let Some(v) = config.max_fps {
        args.push("--max-fps".into());
        args.push(v.to_string());
    }
    if config.stay_awake == Some(true) {
        args.push("--stay-awake".into());
    }
    if config.show_touches == Some(true) {
        args.push("--show-touches".into());
    }
    if config.borderless == Some(true) {
        args.push("--window-borderless".into());
    }
    if config.always_on_top == Some(true) {
        args.push("--always-on-top".into());
    }
    if config.turn_screen_off == Some(true) {
        args.push("--turn-screen-off".into());
    }
    if config.power_off_on_close == Some(true) {
        args.push("--power-off-on-close".into());
    }
    if let Some(ref v) = config.crop {
        if !v.is_empty() {
            args.push("--crop".into());
            args.push(v.clone());
        }
    }
    if let Some(v) = config.lock_orientation {
        args.push("--lock-video-orientation".into());
        args.push(v.to_string());
    }
    if let Some(ref v) = config.record_path {
        if !v.is_empty() {
            args.push("--record".into());
            args.push(v.clone());
        }
    }
    if config.no_audio == Some(true) {
        args.push("--no-audio".into());
    }
    if let Some(ref v) = config.keyboard_mode {
        if !v.is_empty() {
            args.push("--keyboard".into());
            args.push(v.clone());
        }
    }
    if let Some(ref v) = config.mouse_mode {
        if !v.is_empty() {
            args.push("--mouse".into());
            args.push(v.clone());
        }
    }

    // Spawn scrcpy process (no console window on Windows)
    let mut child = cmd(&scrcpy)
        .args(&args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "scrcpy not found. Install from https://github.com/Genymobile/scrcpy and ensure it is on PATH, then restart DevBridge.".to_string()
            } else {
                format!("Failed to start scrcpy: {}", e)
            }
        })?;

    let pid = child.id().ok_or("Failed to get scrcpy PID")?;

    {
        let mut procs = SCRCPY_PROCESSES.lock().map_err(|e| e.to_string())?;
        procs.insert(serial.to_string(), pid);
    }

    let _ = app.emit("scrcpy_state", serde_json::json!({
        "serial": serial,
        "running": true,
    }));

    // Spawn background task to watch for process exit
    let serial_owned = serial.to_string();
    tokio::spawn(async move {
        let _ = child.wait().await;

        // Remove from registry (may already be removed by stop())
        if let Ok(mut procs) = SCRCPY_PROCESSES.lock() {
            procs.remove(&serial_owned);
        }

        let _ = app.emit("scrcpy_state", serde_json::json!({
            "serial": serial_owned,
            "running": false,
        }));
    });

    Ok(())
}

/// Stop scrcpy for a device.
pub async fn stop(serial: &str, app: &AppHandle) -> Result<(), String> {
    let pid = {
        let mut procs = SCRCPY_PROCESSES.lock().map_err(|e| e.to_string())?;
        procs.remove(serial)
    };

    if let Some(pid) = pid {
        let _ = cmd("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .output()
            .await;

        let _ = app.emit("scrcpy_state", serde_json::json!({
            "serial": serial,
            "running": false,
        }));

        Ok(())
    } else {
        Ok(()) // Not running — no error
    }
}

/// Check if scrcpy is running for a device.
pub fn is_running(serial: &str) -> bool {
    SCRCPY_PROCESSES
        .lock()
        .map(|procs| procs.contains_key(serial))
        .unwrap_or(false)
}
