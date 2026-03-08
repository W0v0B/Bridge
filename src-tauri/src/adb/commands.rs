use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use once_cell::sync::Lazy;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncReadExt;
use crate::util::cmd;

/// Resolve the path to the ADB executable.
/// Search order:
/// 1. Bundled copy under resources/adb/adb.exe (for distributed builds)
/// 2. ANDROID_HOME/platform-tools/adb.exe
/// 3. ANDROID_SDK_ROOT/platform-tools/adb.exe
/// 4. LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe (Android Studio default on Windows)
/// 5. Fall back to "adb" on PATH
pub fn adb_path() -> String {
    // 1. Check for bundled ADB relative to the executable
    if let Ok(exe_dir) = std::env::current_exe() {
        let bundled = exe_dir
            .parent()
            .unwrap_or(&PathBuf::from("."))
            .join("resources")
            .join("adb")
            .join("adb.exe");
        if bundled.exists() {
            return bundled.to_string_lossy().to_string();
        }
    }

    // 2–3. Check ANDROID_HOME and ANDROID_SDK_ROOT env vars
    for var in &["ANDROID_HOME", "ANDROID_SDK_ROOT"] {
        if let Ok(sdk) = std::env::var(var) {
            let adb = PathBuf::from(&sdk).join("platform-tools").join("adb.exe");
            if adb.exists() {
                return adb.to_string_lossy().to_string();
            }
        }
    }

    // 4. Check Android Studio default install location on Windows
    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        let adb = PathBuf::from(&local_app_data)
            .join("Android")
            .join("Sdk")
            .join("platform-tools")
            .join("adb.exe");
        if adb.exists() {
            return adb.to_string_lossy().to_string();
        }
    }

    // 5. Fall back to PATH
    "adb".to_string()
}

/// Store PIDs of running shell stream processes, keyed by "shell:{serial}"
static SHELL_PROCESSES: Lazy<Mutex<HashMap<String, u32>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

#[derive(Debug, Clone, Serialize)]
pub struct ShellOutput {
    pub serial: String,
    pub data: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ShellExit {
    pub serial: String,
    pub code: i32,
}

/// Run an ADB command with the given arguments and return stdout.
pub async fn run_adb(args: &[&str]) -> Result<String, String> {
    let output = cmd(adb_path())
        .args(args)
        .output()
        .await
        .map_err(|e| format!("Failed to run adb: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        return Err(format!(
            "adb {} failed: {}{}",
            args.join(" "),
            stderr,
            stdout
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Run `adb -s <serial> shell <command>` and return stdout.
pub async fn run_shell(serial: &str, command: &str) -> Result<String, String> {
    run_adb(&["-s", serial, "shell", command]).await
}

/// Reboot the device. `mode` can be None (normal), "bootloader", or "recovery".
pub async fn reboot(serial: &str, mode: Option<&str>) -> Result<(), String> {
    let mut args = vec!["-s", serial, "reboot"];
    if let Some(m) = mode {
        args.push(m);
    }
    run_adb(&args).await?;
    Ok(())
}

/// Install an APK on the device.
pub async fn install_apk(serial: &str, apk_path: &str) -> Result<(), String> {
    run_adb(&["-s", serial, "install", "-r", apk_path]).await?;
    Ok(())
}

/// Start a streaming shell command, emitting `shell_output` and `shell_exit` events.
pub async fn start_shell_stream(
    serial: &str,
    command: &str,
    app: AppHandle,
) -> Result<(), String> {
    let key = format!("shell:{}", serial);

    // Stop any existing stream for this device
    let old_pid = {
        let mut procs = SHELL_PROCESSES.lock().map_err(|e| e.to_string())?;
        procs.remove(&key)
    };
    if let Some(pid) = old_pid {
        let _ = cmd("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .output()
            .await;
    }

    let mut child = cmd(adb_path())
        .args(["-s", serial, "shell", command])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("Failed to start shell stream: {}", e))?;

    let pid = child.id().ok_or("Failed to get shell process PID")?;

    {
        let mut procs = SHELL_PROCESSES.lock().map_err(|e| e.to_string())?;
        procs.insert(key.clone(), pid);
    }

    let serial_owned = serial.to_string();

    // Spawn a task to forward stderr to the terminal output
    let stderr_handle = child.stderr.take();
    let serial_stderr = serial_owned.clone();
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
                            "shell_output",
                            ShellOutput {
                                serial: serial_stderr.clone(),
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
                            "shell_output",
                            ShellOutput {
                                serial: serial_owned.clone(),
                                data,
                            },
                        );
                    }
                    Err(_) => break,
                }
            }
        }

        // Wait for exit status
        let code = match child.wait().await {
            Ok(status) => status.code().unwrap_or(-1),
            Err(_) => -1,
        };

        let _ = app.emit(
            "shell_exit",
            ShellExit {
                serial: serial_owned.clone(),
                code,
            },
        );

        // Clean up
        let mut procs = SHELL_PROCESSES.lock().unwrap();
        procs.remove(&format!("shell:{}", serial_owned));
    });

    Ok(())
}

/// Stop a running shell stream for a device.
pub async fn stop_shell_stream(serial: &str) -> Result<(), String> {
    let key = format!("shell:{}", serial);
    let pid = {
        let mut procs = SHELL_PROCESSES.lock().map_err(|e| e.to_string())?;
        procs.remove(&key)
    };

    if let Some(pid) = pid {
        let _ = cmd("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .output()
            .await;
        Ok(())
    } else {
        Err("No shell stream running for this device".to_string())
    }
}
