use serde::Serialize;
use tokio::process::Command;

use super::commands::hdc_path;

#[derive(Debug, Clone, Serialize)]
pub struct BundleInfo {
    pub bundle_name: String,
    pub code_path: String,
    /// "user" | "system" | "vendor"
    pub app_type: String,
}

/// List all installed bundles, resolving install paths in parallel via `bm dump -n`.
pub async fn list_bundles(connect_key: &str) -> Result<Vec<BundleInfo>, String> {
    // Step 1: fast list of names
    let output = Command::new(hdc_path())
        .args(["-t", connect_key, "shell", "bm", "dump", "-a"])
        .output()
        .await
        .map_err(|e| format!("Failed to run bm dump: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let names: Vec<String> = stdout
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty() && !l.contains(':') && l.contains('.'))
        .collect();

    // Step 2: resolve details for all bundles in parallel
    let ck = connect_key.to_string();
    let mut set = tokio::task::JoinSet::new();
    for name in names {
        let ck = ck.clone();
        set.spawn(async move { fetch_bundle_detail(&ck, &name).await });
    }

    let mut bundles = Vec::new();
    while let Some(res) = set.join_next().await {
        if let Ok(info) = res {
            bundles.push(info);
        }
    }

    // Sort: user → product → vendor → system, alphabetically within each group
    bundles.sort_by(|a, b| {
        type_order(&a.app_type)
            .cmp(&type_order(&b.app_type))
            .then(a.bundle_name.cmp(&b.bundle_name))
    });

    Ok(bundles)
}

fn type_order(t: &str) -> u8 {
    match t {
        "user" => 0,
        "product" => 1,
        "vendor" => 2,
        _ => 3,
    }
}

async fn fetch_bundle_detail(connect_key: &str, bundle_name: &str) -> BundleInfo {
    let result = Command::new(hdc_path())
        .args(["-t", connect_key, "shell", "bm", "dump", "-n", bundle_name])
        .output()
        .await;

    let (code_path, app_type) = if let Ok(out) = result {
        let text = String::from_utf8_lossy(&out.stdout).to_string();
        parse_bundle_detail(&text)
    } else {
        (String::new(), "system".to_string())
    };

    BundleInfo {
        bundle_name: bundle_name.to_string(),
        code_path,
        app_type,
    }
}

/// Parse `bm dump -n` JSON output into (hap_path, app_type).
/// Uses `"isSystemApp"` for type and the first non-empty `"hapPath"` for the path.
fn parse_bundle_detail(text: &str) -> (String, String) {
    let mut is_system = false;
    let mut hap_path = String::new();

    for line in text.lines() {
        let trimmed = line.trim();

        if trimmed.starts_with("\"isSystemApp\":") {
            is_system = trimmed.contains("true");
        }

        if hap_path.is_empty() && trimmed.starts_with("\"hapPath\":") {
            if let Some(val) = extract_json_string(trimmed) {
                if !val.is_empty() {
                    hap_path = val;
                }
            }
        }
    }

    let app_type = if !is_system {
        "user".to_string()
    } else if hap_path.starts_with("/sys_prod/") || hap_path.starts_with("/cust/") {
        "product".to_string() // device-specific customisations (≈ Android /product/)
    } else if hap_path.starts_with("/vendor/") || hap_path.starts_with("/chipset/") {
        "vendor".to_string() // hardware vendor (≈ Android /vendor/)
    } else {
        "system".to_string() // /system/, /preload/, and anything unrecognised
    };

    (hap_path, app_type)
}

/// Extract the string value from a JSON line like `"key": "value",`.
fn extract_json_string(line: &str) -> Option<String> {
    let after_colon = line.splitn(2, ':').nth(1)?.trim();
    let inner = after_colon.trim_matches(',').trim().trim_matches('"');
    Some(inner.to_string())
}

/// Force-stop a running bundle via `aa force-stop <bundle_name>`.
pub async fn force_stop_bundle(connect_key: &str, bundle_name: &str) -> Result<(), String> {
    let output = Command::new(hdc_path())
        .args(["-t", connect_key, "shell", "aa", "force-stop", bundle_name])
        .output()
        .await
        .map_err(|e| format!("Failed to run aa force-stop: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if output.status.success() || stdout.contains("successfully") {
        Ok(())
    } else {
        Err(stdout)
    }
}

/// Clear bundle data via `bm clean -n <bundle_name> -d`.
pub async fn clear_bundle_data(connect_key: &str, bundle_name: &str) -> Result<(), String> {
    let output = Command::new(hdc_path())
        .args(["-t", connect_key, "shell", "bm", "clean", "-n", bundle_name, "-d"])
        .output()
        .await
        .map_err(|e| format!("Failed to run bm clean: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if output.status.success() || stdout.contains("successfully") {
        Ok(())
    } else {
        Err(stdout)
    }
}

/// Install a HAP package on an OHOS device via `hdc install <path>`.
pub async fn install_hap(connect_key: &str, hap_path: &str) -> Result<String, String> {
    let output = Command::new(hdc_path())
        .args(["-t", connect_key, "install", hap_path])
        .output()
        .await
        .map_err(|e| format!("Failed to run hdc install: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let combined = format!("{}{}", stdout, stderr);

    if output.status.success() || combined.to_lowercase().contains("success") {
        Ok(combined)
    } else {
        Err(combined)
    }
}

/// Uninstall a bundle from an OHOS device via `hdc uninstall <bundleName>`.
pub async fn uninstall_bundle(connect_key: &str, bundle_name: &str) -> Result<String, String> {
    let output = Command::new(hdc_path())
        .args(["-t", connect_key, "uninstall", bundle_name])
        .output()
        .await
        .map_err(|e| format!("Failed to run hdc uninstall: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let combined = format!("{}{}", stdout, stderr);

    if output.status.success() || combined.to_lowercase().contains("success") {
        Ok(combined)
    } else {
        Err(combined)
    }
}
