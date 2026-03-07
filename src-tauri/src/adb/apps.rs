use std::collections::HashSet;

use serde::Serialize;
use tokio::process::Command;

use super::commands::adb_path;

#[derive(Debug, Clone, Serialize)]
pub struct PackageInfo {
    pub package_name: String,
    pub apk_path: String,
    pub is_system: bool,
    pub is_disabled: bool,
    /// true when the package was soft-removed via `pm uninstall -k --user 0`:
    /// the APK still exists on a protected partition but is invisible to the user.
    /// Recoverable via `pm install-existing --user 0`.
    pub is_hidden: bool,
    /// "user" | "system" | "product" | "vendor" — derived from apk_path partition prefix.
    pub app_type: String,
}

/// List all packages on the device, including those hidden via `pm uninstall -k --user 0`.
/// Runs four `pm list packages` queries in parallel.
pub async fn list_packages(serial: &str) -> Result<Vec<PackageInfo>, String> {
    let (all_with_hidden, installed_output, user_output, disabled_output) = tokio::try_join!(
        // -u includes packages that are installed=false for the current user
        run_pm(serial, &["list", "packages", "-u", "-f"]),
        // without -u: only currently installed packages — used to detect hidden ones
        run_pm(serial, &["list", "packages", "-f"]),
        run_pm(serial, &["list", "packages", "-3"]),
        run_pm(serial, &["list", "packages", "-d"]),
    )?;

    let installed_set: HashSet<String> = parse_package_names_from_paths(&installed_output);
    let user_set: HashSet<String> = parse_package_list(&user_output);
    let disabled_set: HashSet<String> = parse_package_list(&disabled_output);

    let mut packages: Vec<PackageInfo> = all_with_hidden
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            // Format: "package:/path/to/base.apk=com.example"
            let without_prefix = line.strip_prefix("package:")?;
            let eq_pos = without_prefix.rfind('=')?;
            let apk_path = without_prefix[..eq_pos].trim().to_string();
            let package_name = without_prefix[eq_pos + 1..].trim().to_string();
            if package_name.is_empty() || apk_path.is_empty() {
                return None;
            }
            let is_hidden = !installed_set.contains(&package_name);
            let is_system = !user_set.contains(&package_name);
            let is_disabled = disabled_set.contains(&package_name);
            let app_type = classify_partition(&apk_path).to_string();
            Some(PackageInfo { package_name, apk_path, is_system, is_disabled, is_hidden, app_type })
        })
        .collect();

    // Sort: user → product → vendor → system; alphabetically within each group.
    // Hidden packages follow the same order but sort after visible ones within each group.
    packages.sort_by(|a, b| {
        partition_order(&a.app_type)
            .cmp(&partition_order(&b.app_type))
            .then_with(|| a.is_hidden.cmp(&b.is_hidden))
            .then_with(|| a.package_name.cmp(&b.package_name))
    });

    Ok(packages)
}

/// Re-enable a package that was hidden via `pm uninstall -k --user 0`.
pub async fn re_enable_package(serial: &str, package: &str) -> Result<String, String> {
    let output = Command::new(adb_path())
        .args(["-s", serial, "shell", "pm", "install-existing", "--user", "0", package])
        .output()
        .await
        .map_err(|e| format!("Failed to run pm install-existing: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if output.status.success() || stdout.contains("installed for user") {
        Ok(stdout)
    } else {
        Err(stdout)
    }
}

/// Parse package names from `pm list packages -f` output (extracts only the names, not paths).
fn parse_package_names_from_paths(output: &str) -> HashSet<String> {
    output
        .lines()
        .filter_map(|line| {
            let without_prefix = line.trim().strip_prefix("package:")?;
            let eq_pos = without_prefix.rfind('=')?;
            Some(without_prefix[eq_pos + 1..].trim().to_string())
        })
        .collect()
}

/// Force-stop a running app via `adb shell am force-stop`.
pub async fn force_stop_package(serial: &str, package: &str) -> Result<(), String> {
    let output = Command::new(adb_path())
        .args(["-s", serial, "shell", "am", "force-stop", package])
        .output()
        .await
        .map_err(|e| format!("Failed to run am force-stop: {}", e))?;

    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

/// Clear all data for an app via `adb shell pm clear`.
pub async fn clear_package_data(serial: &str, package: &str) -> Result<String, String> {
    let output = Command::new(adb_path())
        .args(["-s", serial, "shell", "pm", "clear", package])
        .output()
        .await
        .map_err(|e| format!("Failed to run pm clear: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if output.status.success() || stdout.to_lowercase().contains("success") {
        Ok(stdout)
    } else {
        Err(stdout)
    }
}

/// Classify an APK path into a partition category.
fn classify_partition(apk_path: &str) -> &str {
    if apk_path.starts_with("/data/") {
        "user"
    } else if apk_path.starts_with("/product/") {
        "product"
    } else if apk_path.starts_with("/vendor/") {
        "vendor"
    } else {
        "system" // /system/, /system_ext/, /apex/, and anything unrecognised
    }
}

fn partition_order(t: &str) -> u8 {
    match t {
        "user" => 0,
        "product" => 1,
        "vendor" => 2,
        _ => 3, // system
    }
}

/// Parse a `pm list packages` output into a set of package name strings.
fn parse_package_list(output: &str) -> HashSet<String> {
    output
        .lines()
        .filter_map(|line| {
            line.trim().strip_prefix("package:").map(|s| s.trim().to_string())
        })
        .collect()
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
