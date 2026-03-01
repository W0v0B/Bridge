use std::path::PathBuf;
use tokio::process::Command;

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

/// Run an ADB command with the given arguments and return stdout.
pub async fn run_adb(args: &[&str]) -> Result<String, String> {
    let output = Command::new(adb_path())
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
