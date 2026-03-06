use std::collections::HashSet;

use serde::Serialize;
use tokio::process::Command;

use super::commands::adb_path;

#[derive(Debug, Clone, Serialize)]
pub struct PackageInfo {
    pub package_name: String,
    pub apk_path: String,
    pub is_system: bool,
}

/// List all installed packages on the device, with APK paths and system/user classification.
pub async fn list_packages(serial: &str) -> Result<Vec<PackageInfo>, String> {
    // Get all packages with their APK file paths
    let all_output = run_pm(serial, &["list", "packages", "-f"]).await?;

    // Get only third-party (non-system) package names to classify each entry
    let user_output = run_pm(serial, &["list", "packages", "-3"]).await?;

    let user_set: HashSet<String> = user_output
        .lines()
        .filter_map(|line| {
            // Format: "package:com.example.app"
            line.trim().strip_prefix("package:").map(|s| s.trim().to_string())
        })
        .collect();

    let mut packages: Vec<PackageInfo> = all_output
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            // Format: "package:/data/app/com.example-1/base.apk=com.example"
            let without_prefix = line.strip_prefix("package:")?;
            // Split on the last '=' to handle APK paths that may contain '='
            let eq_pos = without_prefix.rfind('=')?;
            let apk_path = without_prefix[..eq_pos].trim().to_string();
            let package_name = without_prefix[eq_pos + 1..].trim().to_string();
            if package_name.is_empty() || apk_path.is_empty() {
                return None;
            }
            let is_system = !user_set.contains(&package_name);
            Some(PackageInfo { package_name, apk_path, is_system })
        })
        .collect();

    // Sort: user apps first, then system apps; alphabetically within each group
    packages.sort_by(|a, b| {
        a.is_system
            .cmp(&b.is_system)
            .then_with(|| a.package_name.cmp(&b.package_name))
    });

    Ok(packages)
}

/// Uninstall a package from the device.
/// - User app: standard `adb uninstall`
/// - System app + root: `pm uninstall` (full permanent removal)
/// - System app + no root: `pm uninstall -k --user 0` (soft disable for current user)
pub async fn uninstall_package(
    serial: &str,
    package: &str,
    is_system: bool,
    is_root: bool,
) -> Result<String, String> {
    let output = if !is_system {
        // Standard uninstall for user-installed apps
        Command::new(adb_path())
            .args(["-s", serial, "uninstall", package])
            .output()
            .await
            .map_err(|e| format!("Failed to run adb uninstall: {}", e))?
    } else if is_root {
        // Full removal of system app (requires root)
        Command::new(adb_path())
            .args(["-s", serial, "shell", &format!("pm uninstall {}", package)])
            .output()
            .await
            .map_err(|e| format!("Failed to run pm uninstall: {}", e))?
    } else {
        // Soft disable for current user (no root required)
        Command::new(adb_path())
            .args([
                "-s",
                serial,
                "shell",
                &format!("pm uninstall -k --user 0 {}", package),
            ])
            .output()
            .await
            .map_err(|e| format!("Failed to run pm uninstall --user 0: {}", e))?
    };

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let combined = format!("{}{}", stdout, stderr);

    if output.status.success() || combined.to_lowercase().contains("success") {
        Ok(combined)
    } else {
        Err(combined)
    }
}

/// Run a `pm` subcommand via `adb shell pm <args>` and return the stdout.
async fn run_pm(serial: &str, pm_args: &[&str]) -> Result<String, String> {
    let mut args = vec!["-s", serial, "shell", "pm"];
    args.extend_from_slice(pm_args);

    let output = Command::new(adb_path())
        .args(&args)
        .output()
        .await
        .map_err(|e| format!("Failed to run pm: {}", e))?;

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}
