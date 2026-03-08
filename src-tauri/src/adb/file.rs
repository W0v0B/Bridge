use once_cell::sync::Lazy;
use regex::Regex;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use crate::util::cmd;

use super::commands::{adb_path, run_shell};

#[derive(Debug, Clone, Serialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub permissions: String,
    pub modified: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TransferProgress {
    pub id: String,
    pub file_name: String,
    pub transferred: u64,
    pub total: u64,
    pub percent: f64,
    pub speed: String,
}

// Regex for parsing `ls -la` output lines
// Example: drwxrwxr-x  3 root root  4096 2024-01-15 10:30 dirname
static LS_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"^([drwxlsStT\-]+)\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\s+(.+)$",
    )
    .unwrap()
});

// Regex for parsing adb push/pull progress: [ 42%] /path/to/file
static PROGRESS_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\[\s*(\d+)%\]").unwrap()
});

fn parse_ls_line(line: &str, parent_path: &str) -> Option<FileEntry> {
    let line = line.trim();
    let caps = LS_REGEX.captures(line)?;

    let permissions = caps[1].to_string();
    let size: u64 = caps[2].parse().unwrap_or(0);
    let modified = caps[3].to_string();
    let name = caps[4].to_string();

    // Skip . and .. and total line
    if name == "." || name == ".." {
        return None;
    }

    let is_dir = permissions.starts_with('d');
    let path = if parent_path.ends_with('/') {
        format!("{}{}", parent_path, name)
    } else {
        format!("{}/{}", parent_path, name)
    };

    // For symlinks, strip the " -> target" suffix from the name
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

/// List directory contents on the device.
pub async fn list_directory(serial: &str, path: &str) -> Result<Vec<FileEntry>, String> {
    let output = run_shell(serial, &format!("ls -la '{}'", path)).await?;

    let mut entries: Vec<FileEntry> = output
        .lines()
        .filter_map(|line| parse_ls_line(line, path))
        .collect();

    // Sort: directories first, then by name
    entries.sort_by(|a, b| {
        b.is_dir.cmp(&a.is_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(entries)
}

/// Push local files to the device, emitting `transfer_progress` events.
pub async fn push_files(
    serial: &str,
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

        let mut child = cmd(adb_path())
            .args(["-s", serial, "push", local_path, remote_path])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to start adb push: {}", e))?;

        // ADB push progress is written to stderr
        if let Some(stderr) = child.stderr.take() {
            let reader = BufReader::new(stderr);
            let mut lines = reader.lines();
            let app_clone = app.clone();
            let file_name_clone = file_name.clone();
            let id_clone = id.clone();

            while let Ok(Some(line)) = lines.next_line().await {
                if let Some(caps) = PROGRESS_REGEX.captures(&line) {
                    let percent: f64 = caps[1].parse().unwrap_or(0.0);
                    let _ = app_clone.emit(
                        "transfer_progress",
                        TransferProgress {
                            id: id_clone.clone(),
                            file_name: file_name_clone.clone(),
                            transferred: 0,
                            total: 0,
                            percent,
                            speed: String::new(),
                        },
                    );
                }
            }
        }

        let status = child
            .wait()
            .await
            .map_err(|e| format!("adb push failed: {}", e))?;

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
            return Err(format!("adb push failed for {}", file_name));
        }
    }
    Ok(())
}

/// Pull a file from the device, emitting `transfer_progress` events.
pub async fn pull_file(
    serial: &str,
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

    let mut child = cmd(adb_path())
        .args(["-s", serial, "pull", remote_path, local_path])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start adb pull: {}", e))?;

    if let Some(stderr) = child.stderr.take() {
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();
        let app_clone = app.clone();
        let file_name_clone = file_name.clone();
        let id_clone = id.clone();

        while let Ok(Some(line)) = lines.next_line().await {
            if let Some(caps) = PROGRESS_REGEX.captures(&line) {
                let percent: f64 = caps[1].parse().unwrap_or(0.0);
                let _ = app_clone.emit(
                    "transfer_progress",
                    TransferProgress {
                        id: id_clone.clone(),
                        file_name: file_name_clone.clone(),
                        transferred: 0,
                        total: 0,
                        percent,
                        speed: String::new(),
                    },
                );
            }
        }
    }

    let status = child
        .wait()
        .await
        .map_err(|e| format!("adb pull failed: {}", e))?;

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
        return Err(format!("adb pull failed for {}", file_name));
    }

    Ok(())
}

/// Delete a file or directory on the device.
pub async fn delete_file(serial: &str, path: &str) -> Result<(), String> {
    run_shell(serial, &format!("rm -rf '{}'", path)).await?;
    Ok(())
}
