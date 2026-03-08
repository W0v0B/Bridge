use once_cell::sync::Lazy;
use regex::Regex;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use crate::util::cmd;

use super::commands::{hdc_path, run_hdc_shell};
use crate::adb::file::TransferProgress;

#[derive(Debug, Clone, Serialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub permissions: String,
    pub modified: String,
}

// Regex for parsing `ls -la` output lines (same format as ADB)
static LS_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"^([drwxlsStT\-]+)\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\s+(.+)$",
    )
    .unwrap()
});

fn parse_ls_line(line: &str, parent_path: &str) -> Option<FileEntry> {
    let line = line.trim();
    let caps = LS_REGEX.captures(line)?;

    let permissions = caps[1].to_string();
    let size: u64 = caps[2].parse().unwrap_or(0);
    let modified = caps[3].to_string();
    let name = caps[4].to_string();

    if name == "." || name == ".." {
        return None;
    }

    let is_dir = permissions.starts_with('d');
    let path = if parent_path.ends_with('/') {
        format!("{}{}", parent_path, name)
    } else {
        format!("{}/{}", parent_path, name)
    };

    let display_name = if permissions.starts_with('l') {
        name.split(" -> ").next().unwrap_or(&name).to_string()
    } else {
        name
    };

    Some(FileEntry {
        name: display_name,
        path,
        is_dir,
        size,
        permissions,
        modified,
    })
}

/// List directory contents on an OHOS device via `hdc shell ls -la <path>`.
pub async fn list_directory(connect_key: &str, path: &str) -> Result<Vec<FileEntry>, String> {
    let output = run_hdc_shell(connect_key, &format!("ls -la '{}'", path)).await?;

    let mut entries: Vec<FileEntry> = output
        .lines()
        .filter_map(|line| parse_ls_line(line, path))
        .collect();

    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(entries)
}

/// Send local files to an OHOS device via `hdc file send`.
/// Emits `transfer_progress` events (0% → 100% per file).
pub async fn send_files(
    connect_key: &str,
    local_paths: Vec<String>,
    remote_path: &str,
    app: AppHandle,
) -> Result<(), String> {
    for local_path in &local_paths {
        let file_name = std::path::Path::new(local_path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| local_path.clone());

        let id = uuid::Uuid::new_v4().to_string();

        // Emit 0% at start
        let _ = app.emit(
            "transfer_progress",
            TransferProgress {
                id: id.clone(),
                file_name: file_name.clone(),
                transferred: 0,
                total: 0,
                percent: 0.0,
                speed: String::new(),
            },
        );

        let status = cmd(hdc_path())
            .args(["-t", connect_key, "file", "send", local_path, remote_path])
            .output()
            .await
            .map_err(|e| format!("Failed to run hdc file send: {}", e))?
            .status;

        // Emit 100% on completion
        let _ = app.emit(
            "transfer_progress",
            TransferProgress {
                id: id.clone(),
                file_name: file_name.clone(),
                transferred: 0,
                total: 0,
                percent: 100.0,
                speed: String::new(),
            },
        );

        if !status.success() {
            return Err(format!("hdc file send failed for {}", file_name));
        }
    }
    Ok(())
}

/// Receive a file from an OHOS device via `hdc file recv`.
/// Emits `transfer_progress` events (0% → 100%).
pub async fn recv_file(
    connect_key: &str,
    remote_path: &str,
    local_path: &str,
    app: AppHandle,
) -> Result<(), String> {
    let file_name = remote_path
        .rsplit('/')
        .next()
        .unwrap_or(remote_path)
        .to_string();

    let id = uuid::Uuid::new_v4().to_string();

    let _ = app.emit(
        "transfer_progress",
        TransferProgress {
            id: id.clone(),
            file_name: file_name.clone(),
            transferred: 0,
            total: 0,
            percent: 0.0,
            speed: String::new(),
        },
    );

    let status = cmd(hdc_path())
        .args(["-t", connect_key, "file", "recv", remote_path, local_path])
        .output()
        .await
        .map_err(|e| format!("Failed to run hdc file recv: {}", e))?
        .status;

    let _ = app.emit(
        "transfer_progress",
        TransferProgress {
            id,
            file_name: file_name.clone(),
            transferred: 0,
            total: 0,
            percent: 100.0,
            speed: String::new(),
        },
    );

    if !status.success() {
        return Err(format!("hdc file recv failed for {}", file_name));
    }

    Ok(())
}

/// Delete a file or directory on an OHOS device.
pub async fn delete_file(connect_key: &str, path: &str) -> Result<(), String> {
    run_hdc_shell(connect_key, &format!("rm -rf '{}'", path)).await?;
    Ok(())
}
