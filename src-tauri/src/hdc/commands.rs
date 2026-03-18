use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use once_cell::sync::Lazy;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncReadExt;
use crate::util::cmd;

/// Resolve the path to the HDC executable.
/// Search order:
/// 1. Bundled copy under resources/hdc/hdc.exe
/// 2. DEVECO_SDK_HOME/toolchains/hdc.exe
/// 3. LOCALAPPDATA/DevEco Studio/sdk/default/openharmony/toolchains/hdc.exe
/// 4. Fall back to "hdc" on PATH
pub fn hdc_path() -> String {
    // 1. Bundled copy
    if let Ok(exe_dir) = std::env::current_exe() {
        let bundled = exe_dir
            .parent()
            .unwrap_or(&PathBuf::from("."))
            .join("resources")
            .join("hdc")
            .join("hdc.exe");
        if bundled.exists() {
            return bundled.to_string_lossy().to_string();
        }
    }

    // 2. DEVECO_SDK_HOME env var
    if let Ok(sdk) = std::env::var("DEVECO_SDK_HOME") {
        let hdc = PathBuf::from(&sdk).join("toolchains").join("hdc.exe");
        if hdc.exists() {
            return hdc.to_string_lossy().to_string();
        }
    }

    // 3. Default DevEco Studio install locations on Windows
    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        for studio_subdir in &[
            "DevEco Studio",
            r"Huawei\DevEco Studio",
        ] {
            let hdc = PathBuf::from(&local_app_data)
                .join(studio_subdir)
                .join("sdk")
                .join("default")
                .join("openharmony")
                .join("toolchains")
                .join("hdc.exe");
            if hdc.exists() {
                return hdc.to_string_lossy().to_string();
            }
        }
    }

    // 4. Fall back to PATH
    "hdc".to_string()
}

/// Store PIDs of running hdc shell stream processes, keyed by "hdc_shell:{connect_key}"
static HDC_SHELL_PROCESSES: Lazy<Mutex<HashMap<String, u32>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

#[derive(Debug, Clone, Serialize)]
pub struct HdcShellOutput {
    pub connect_key: String,
    pub data: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct HdcShellExit {
    pub connect_key: String,
    pub code: i32,
}

/// Run an HDC command with the given arguments and return stdout.
/// Returns Err on non-zero exit or spawn failure.
pub async fn run_hdc(args: &[&str]) -> Result<String, String> {
    let output = cmd(hdc_path())
        .args(args)
        .output()
        .await
        .map_err(|e| format!("Failed to run hdc: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        return Err(format!(
            "hdc {} failed: {}{}",
            args.join(" "),
            stderr,
            stdout
        ));
    }

    Ok(stdout)
}

/// Run `hdc -t <connect_key> shell <command>` and return stdout.
pub async fn run_hdc_shell(connect_key: &str, command: &str) -> Result<String, String> {
    run_hdc(&["-t", connect_key, "shell", command]).await
}

/// Start a streaming shell command for an OHOS device.
/// Emits `hdc_shell_output` and `hdc_shell_exit` Tauri events.
pub async fn start_shell_stream(
    connect_key: &str,
    command: &str,
    app: AppHandle,
) -> Result<(), String> {
    let key = format!("hdc_shell:{}", connect_key);

    // Stop any existing stream for this device
    let old_pid = {
        let mut procs = HDC_SHELL_PROCESSES.lock().map_err(|e| e.to_string())?;
        procs.remove(&key)
    };
    if let Some(pid) = old_pid {
        let _ = cmd("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .output()
            .await;
    }

    let mut child = cmd(hdc_path())
        .args(["-t", connect_key, "shell", command])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("Failed to start hdc shell stream: {}", e))?;

    let pid = child.id().ok_or("Failed to get hdc shell process PID")?;

    {
        let mut procs = HDC_SHELL_PROCESSES.lock().map_err(|e| e.to_string())?;
        procs.insert(key.clone(), pid);
    }

    let connect_key_owned = connect_key.to_string();

    // Forward stderr as shell output
    let stderr_handle = child.stderr.take();
    let ck_stderr = connect_key_owned.clone();
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
                            "hdc_shell_output",
                            HdcShellOutput {
                                connect_key: ck_stderr.clone(),
                                data,
                            },
                        );
                    }
                }
            }
        }
    });

    tokio::spawn(async move {
        if let Some(mut stdout) = child.stdout.take() {
            let mut buf = vec![0u8; 8192];
            loop {
                match stdout.read(&mut buf).await {
                    Ok(0) => break,
                    Ok(n) => {
                        let data = String::from_utf8_lossy(&buf[..n]).to_string();
                        let _ = app.emit(
                            "hdc_shell_output",
                            HdcShellOutput {
                                connect_key: connect_key_owned.clone(),
                                data,
                            },
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
            "hdc_shell_exit",
            HdcShellExit {
                connect_key: connect_key_owned.clone(),
                code,
            },
        );

        let mut procs = HDC_SHELL_PROCESSES.lock().unwrap();
        procs.remove(&format!("hdc_shell:{}", connect_key_owned));
    });

    Ok(())
}

/// Stop a running shell stream for an OHOS device.
pub async fn stop_shell_stream(connect_key: &str) -> Result<(), String> {
    let key = format!("hdc_shell:{}", connect_key);
    let pid = {
        let mut procs = HDC_SHELL_PROCESSES.lock().map_err(|e| e.to_string())?;
        procs.remove(&key)
    };

    if let Some(pid) = pid {
        let _ = cmd("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .output()
            .await;
        Ok(())
    } else {
        Err("No hdc shell stream running for this device".to_string())
    }
}

/// Kill any running shell stream for the given device (best-effort, no error on missing).
pub async fn kill_shell_stream(connect_key: &str) {
    let key = format!("hdc_shell:{}", connect_key);
    let pid = {
        let mut procs = HDC_SHELL_PROCESSES.lock().ok();
        procs.as_mut().and_then(|p| p.remove(&key))
    };
    if let Some(pid) = pid {
        let _ = cmd("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .output()
            .await;
    }
}
