use std::collections::HashMap;
use std::sync::Mutex;

use once_cell::sync::Lazy;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncReadExt;
use tokio::process::Command;

/// Create a `Command` that won't spawn a visible console window on Windows.
///
/// In production (GUI app with no attached console), every `Command::new()`
/// call creates a brief console window flash.  The `CREATE_NO_WINDOW` flag
/// suppresses this.
pub fn cmd(program: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut c = Command::new(program);
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        c.creation_flags(CREATE_NO_WINDOW);
    }
    c
}

// ── Local Script Execution ──

/// Store PIDs of running script processes, keyed by "script:{id}"
static SCRIPT_PROCESSES: Lazy<Mutex<HashMap<String, u32>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

#[derive(Debug, Clone, Serialize)]
pub struct ScriptOutput {
    pub id: String,
    pub data: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ScriptExit {
    pub id: String,
    pub code: i32,
}

/// Run a local script (.bat / .cmd / .ps1 / .sh) and stream its output via
/// `script_output` / `script_exit` events.
///
/// `id` is a caller-provided identifier so the frontend can correlate output
/// with the correct device/panel.
pub async fn run_script(
    id: &str,
    script_path: &str,
    app: AppHandle,
) -> Result<(), String> {
    let key = format!("script:{}", id);

    // Stop any existing script with the same id
    let old_pid = {
        let mut procs = SCRIPT_PROCESSES.lock().map_err(|e| e.to_string())?;
        procs.remove(&key)
    };
    if let Some(pid) = old_pid {
        let _ = cmd("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .output()
            .await;
    }

    let mut child = cmd("cmd")
        .args(["/C", script_path])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("Failed to start script: {}", e))?;

    let pid = child.id().ok_or("Failed to get script process PID")?;

    {
        let mut procs = SCRIPT_PROCESSES.lock().map_err(|e| e.to_string())?;
        procs.insert(key.clone(), pid);
    }

    let id_owned = id.to_string();

    // Forward stderr
    let stderr_handle = child.stderr.take();
    let id_stderr = id_owned.clone();
    let app_stderr = app.clone();
    tokio::spawn(async move {
        if let Some(mut stderr) = stderr_handle {
            let mut buf = vec![0u8; 4096];
            loop {
                match stderr.read(&mut buf).await {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let data = String::from_utf8_lossy(&buf[..n]).to_string();
                        let _ = app_stderr.emit(
                            "script_output",
                            ScriptOutput { id: id_stderr.clone(), data },
                        );
                    }
                }
            }
        }
    });

    // Forward stdout and wait for exit
    tokio::spawn(async move {
        if let Some(mut stdout) = child.stdout.take() {
            let mut buf = vec![0u8; 8192];
            loop {
                match stdout.read(&mut buf).await {
                    Ok(0) => break,
                    Ok(n) => {
                        let data = String::from_utf8_lossy(&buf[..n]).to_string();
                        let _ = app.emit(
                            "script_output",
                            ScriptOutput { id: id_owned.clone(), data },
                        );
                    }
                    Err(_) => break,
                }
            }
        }

        let code = match child.wait().await {
            Ok(status) => status.code().unwrap_or(-1),
            Err(_) => -1,
        };

        let _ = app.emit(
            "script_exit",
            ScriptExit { id: id_owned.clone(), code },
        );

        // Clean up
        if let Ok(mut procs) = SCRIPT_PROCESSES.lock() {
            procs.remove(&format!("script:{}", id_owned));
        }
    });

    Ok(())
}

/// Stop a running script by id.
pub async fn stop_script(id: &str) -> Result<(), String> {
    let key = format!("script:{}", id);
    let pid = {
        let mut procs = SCRIPT_PROCESSES.lock().map_err(|e| e.to_string())?;
        procs.remove(&key)
    };

    if let Some(pid) = pid {
        let _ = cmd("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .output()
            .await;
        Ok(())
    } else {
        Err("No script running with this id".to_string())
    }
}
