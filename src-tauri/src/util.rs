use std::collections::HashMap;
use std::sync::Mutex;

use once_cell::sync::Lazy;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
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

fn script_key(id: &str) -> String {
    format!("script:{}", id)
}

/// Store PIDs of running script processes, keyed by `script_key(id)`
static SCRIPT_PROCESSES: Lazy<Mutex<HashMap<String, u32>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

static SCRIPT_STDIN: Lazy<Mutex<HashMap<String, tokio::process::ChildStdin>>> =
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
    let key = script_key(id);

    // Stop any existing script with the same id
    let old_pid = {
        let mut procs = SCRIPT_PROCESSES.lock().map_err(|e| e.to_string())?;
        procs.remove(&key)
    };
    {
        let mut stdinmap = SCRIPT_STDIN.lock().map_err(|e| e.to_string())?;
        stdinmap.remove(&key);
    }
    if let Some(pid) = old_pid {
        let _ = cmd("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .output()
            .await;
    }

    let ext = std::path::Path::new(script_path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    let mut builder = if ext == "ps1" {
        let mut c = cmd("powershell");
        c.args(["-ExecutionPolicy", "Bypass", "-File", script_path]);
        c
    } else {
        let mut c = cmd("cmd");
        c.args(["/C", script_path]);
        c
    };

    let mut child = builder
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("Failed to start script: {}", e))?;

    let pid = child.id().ok_or("Failed to get script process PID")?;
    let stdin = child.stdin.take().ok_or("Failed to get script stdin")?;

    {
        let mut procs = SCRIPT_PROCESSES.lock().map_err(|e| e.to_string())?;
        procs.insert(key.clone(), pid);
    }
    {
        let mut stdinmap = SCRIPT_STDIN.lock().map_err(|e| e.to_string())?;
        stdinmap.insert(key.clone(), stdin);
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
        let key = script_key(&id_owned);
        if let Ok(mut procs) = SCRIPT_PROCESSES.lock() {
            procs.remove(&key);
        }
        if let Ok(mut stdinmap) = SCRIPT_STDIN.lock() {
            stdinmap.remove(&key);
        }
    });

    Ok(())
}

/// Read a local script file and return its contents as a UTF-8 string.
pub fn read_script_file(path: &str) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|e| e.to_string())
}

/// Stop a running script by id.
pub async fn stop_script(id: &str) -> Result<(), String> {
    let key = script_key(id);
    let pid = {
        let mut procs = SCRIPT_PROCESSES.lock().map_err(|e| e.to_string())?;
        procs.remove(&key)
    };
    {
        let mut stdinmap = SCRIPT_STDIN.lock().map_err(|e| e.to_string())?;
        stdinmap.remove(&key);
    }

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

/// Write data to a running script's stdin (e.g. to respond to interactive prompts).
pub async fn send_script_input(id: &str, data: &str) -> Result<(), String> {
    let key = script_key(id);
    // Remove stdin from the map so the lock is not held across the await.
    let mut stdin = {
        let mut stdinmap = SCRIPT_STDIN.lock().map_err(|e| e.to_string())?;
        stdinmap.remove(&key).ok_or_else(|| "No script running with this id".to_string())?
    };
    let result = stdin.write_all(data.as_bytes()).await.map_err(|e| e.to_string());
    // Put stdin back so subsequent writes still work.
    if let Ok(mut stdinmap) = SCRIPT_STDIN.lock() {
        stdinmap.insert(key, stdin);
    }
    result
}
