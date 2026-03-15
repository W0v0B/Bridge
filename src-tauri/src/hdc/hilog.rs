use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use crate::util::cmd;
use tokio::time::Instant;

use super::commands::hdc_path;

/// HiLog entry — same field shape as ADB LogEntry so the same UI components can render it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HilogEntry {
    pub timestamp: String,
    pub pid: String,
    pub tid: String,
    pub level: String,
    /// Combined "DOMAIN/Tag" field, e.g. "A03200/testTag"
    pub tag: String,
    pub message: String,
}

/// Wrapper for emitting hilog batches with device connect_key info.
#[derive(Debug, Clone, Serialize)]
pub struct HilogBatch {
    pub connect_key: String,
    pub entries: Vec<HilogEntry>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct HilogFilter {
    pub level: Option<String>,
    pub keyword: Option<String>,
}

/// Store PIDs of running hilog processes, keyed by "hilog:{connect_key}"
static HILOG_PROCESSES: Lazy<Mutex<HashMap<String, u32>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

// HiLog line format:
//   MM-DD HH:MM:SS.mmm  PID  TID L DOMAIN/Tag: message
// Example:
//   04-19 17:02:14.735  5394  5394 I A03200/testTag: this is a info level hilog
static HILOG_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"^(\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+)\s+(\d+)\s+(\d+)\s+([DIWEF])\s+([^\s:][^:]*?):\s*(.*)"
    )
    .unwrap()
});

fn parse_hilog_line(line: &str) -> Option<HilogEntry> {
    let caps = HILOG_RE.captures(line.trim())?;
    Some(HilogEntry {
        timestamp: caps[1].to_string(),
        pid: caps[2].to_string(),
        tid: caps[3].to_string(),
        level: caps[4].to_string(),
        tag: caps[5].trim().to_string(),
        message: caps[6].to_string(),
    })
}

fn passes_filter(entry: &HilogEntry, filter: &HilogFilter) -> bool {
    if let Some(ref min_level) = filter.level {
        let levels = ["D", "I", "W", "E", "F"];
        let min_idx = levels.iter().position(|&l| l == min_level.as_str()).unwrap_or(0);
        let entry_idx = levels.iter().position(|&l| l == entry.level.as_str()).unwrap_or(0);
        if entry_idx < min_idx {
            return false;
        }
    }
    if let Some(ref keyword) = filter.keyword {
        if !keyword.is_empty()
            && !entry.message.to_lowercase().contains(&keyword.to_lowercase())
            && !entry.tag.to_lowercase().contains(&keyword.to_lowercase())
        {
            return false;
        }
    }
    true
}

/// Start hilog streaming for an OHOS device, emitting `hilog_lines` events.
pub async fn start(
    connect_key: &str,
    filter: HilogFilter,
    app: AppHandle,
) -> Result<(), String> {
    let key = format!("hilog:{}", connect_key);

    {
        let procs = HILOG_PROCESSES.lock().map_err(|e| e.to_string())?;
        if procs.contains_key(&key) {
            return Err("Hilog already running for this device".to_string());
        }
    }

    let mut child = cmd(hdc_path())
        .args(["-t", connect_key, "shell", "hilog"])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to start hilog: {}", e))?;

    let pid = child.id().ok_or("Failed to get hilog PID")?;

    {
        let mut procs = HILOG_PROCESSES.lock().map_err(|e| e.to_string())?;
        procs.insert(key.clone(), pid);
    }

    let connect_key_owned = connect_key.to_string();

    tokio::spawn(async move {
        if let Some(stdout) = child.stdout.take() {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();
            let mut batch: Vec<HilogEntry> = Vec::with_capacity(64);
            let mut last_flush = Instant::now();
            let flush_interval = Duration::from_millis(50);

            loop {
                let maybe_line = tokio::time::timeout(flush_interval, lines.next_line()).await;

                match maybe_line {
                    Ok(Ok(Some(line))) => {
                        if let Some(entry) = parse_hilog_line(&line) {
                            if passes_filter(&entry, &filter) {
                                batch.push(entry);
                            }
                        }
                        if batch.len() >= 64 || last_flush.elapsed() >= flush_interval {
                            if !batch.is_empty() {
                                let _ = app.emit("hilog_lines", HilogBatch {
                                    connect_key: connect_key_owned.clone(),
                                    entries: batch.clone(),
                                });
                                batch.clear();
                            }
                            last_flush = Instant::now();
                        }
                    }
                    Ok(Ok(None)) => {
                        if !batch.is_empty() {
                            let _ = app.emit("hilog_lines", HilogBatch {
                                connect_key: connect_key_owned.clone(),
                                entries: batch.clone(),
                            });
                        }
                        break;
                    }
                    Ok(Err(_)) => {
                        if !batch.is_empty() {
                            let _ = app.emit("hilog_lines", HilogBatch {
                                connect_key: connect_key_owned.clone(),
                                entries: batch.clone(),
                            });
                        }
                        break;
                    }
                    Err(_) => {
                        // Timeout — flush partial batch
                        if !batch.is_empty() {
                            let _ = app.emit("hilog_lines", HilogBatch {
                                connect_key: connect_key_owned.clone(),
                                entries: batch.clone(),
                            });
                            batch.clear();
                            last_flush = Instant::now();
                        }
                    }
                }
            }
        }

        let mut procs = HILOG_PROCESSES.lock().unwrap();
        procs.remove(&format!("hilog:{}", connect_key_owned));
    });

    Ok(())
}

/// Stop hilog for a device.
pub async fn stop(connect_key: &str) -> Result<(), String> {
    let key = format!("hilog:{}", connect_key);
    let pid = {
        let mut procs = HILOG_PROCESSES.lock().map_err(|e| e.to_string())?;
        procs.remove(&key)
    };

    if let Some(pid) = pid {
        let _ = cmd("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .output()
            .await;
        Ok(())
    } else {
        Err("No hilog running for this device".to_string())
    }
}

/// Clear the on-device hilog ring buffer via `hilog -r`.
pub async fn clear(connect_key: &str) -> Result<(), String> {
    let output = cmd(hdc_path())
        .args(["-t", connect_key, "shell", "hilog", "-r"])
        .output()
        .await
        .map_err(|e| format!("Failed to run hilog -r: {}", e))?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("hilog -r failed: {}", stderr))
    }
}

/// Start tlogcat streaming for an OHOS device, emitting `hdc_tlogcat_lines` events.
/// tlogcat on OHOS is accessed via `hdc -t <key> shell tlogcat`.
pub async fn start_tlogcat(
    connect_key: &str,
    app: AppHandle,
) -> Result<(), String> {
    let key = format!("tlogcat:{}", connect_key);

    {
        let procs = HILOG_PROCESSES.lock().map_err(|e| e.to_string())?;
        if procs.contains_key(&key) {
            return Err("tlogcat already running for this device".to_string());
        }
    }

    let mut child = cmd(hdc_path())
        .args(["-t", connect_key, "shell", "tlogcat"])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start tlogcat: {}", e))?;

    let pid = child.id().ok_or("Failed to get tlogcat PID")?;

    {
        let mut procs = HILOG_PROCESSES.lock().map_err(|e| e.to_string())?;
        procs.insert(key.clone(), pid);
    }

    let connect_key_owned = connect_key.to_string();

    // Spawn a task to read stderr and emit as error-level log entries
    if let Some(stderr) = child.stderr.take() {
        let stderr_key = connect_key_owned.clone();
        let stderr_app = app.clone();
        tokio::spawn(async move {
            let reader = BufReader::new(stderr);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                let entry = HilogEntry {
                    timestamp: String::new(),
                    pid: String::new(),
                    tid: String::new(),
                    level: "E".to_string(),
                    tag: "tlogcat-stderr".to_string(),
                    message: trimmed.to_string(),
                };
                let _ = stderr_app.emit("hdc_tlogcat_lines", HilogBatch {
                    connect_key: stderr_key.clone(),
                    entries: vec![entry],
                });
            }
        });
    }

    tokio::spawn(async move {
        if let Some(stdout) = child.stdout.take() {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();
            let mut batch: Vec<HilogEntry> = Vec::with_capacity(64);
            let mut last_flush = Instant::now();
            let flush_interval = Duration::from_millis(50);

            loop {
                let maybe_line = tokio::time::timeout(flush_interval, lines.next_line()).await;

                match maybe_line {
                    Ok(Ok(Some(line))) => {
                        if let Some(entry) = parse_hilog_line(&line) {
                            batch.push(entry);
                        }
                        if batch.len() >= 64 || last_flush.elapsed() >= flush_interval {
                            if !batch.is_empty() {
                                let _ = app.emit("hdc_tlogcat_lines", HilogBatch {
                                    connect_key: connect_key_owned.clone(),
                                    entries: batch.clone(),
                                });
                                batch.clear();
                            }
                            last_flush = Instant::now();
                        }
                    }
                    Ok(Ok(None)) => {
                        if !batch.is_empty() {
                            let _ = app.emit("hdc_tlogcat_lines", HilogBatch {
                                connect_key: connect_key_owned.clone(),
                                entries: batch.clone(),
                            });
                        }
                        break;
                    }
                    Ok(Err(_)) => {
                        if !batch.is_empty() {
                            let _ = app.emit("hdc_tlogcat_lines", HilogBatch {
                                connect_key: connect_key_owned.clone(),
                                entries: batch.clone(),
                            });
                        }
                        break;
                    }
                    Err(_) => {
                        // Timeout — flush partial batch
                        if !batch.is_empty() {
                            let _ = app.emit("hdc_tlogcat_lines", HilogBatch {
                                connect_key: connect_key_owned.clone(),
                                entries: batch.clone(),
                            });
                            batch.clear();
                            last_flush = Instant::now();
                        }
                    }
                }
            }
        }

        let mut procs = HILOG_PROCESSES.lock().unwrap();
        procs.remove(&format!("tlogcat:{}", connect_key_owned));
    });

    Ok(())
}

/// Stop tlogcat for an OHOS device.
pub async fn stop_tlogcat(connect_key: &str) -> Result<(), String> {
    let key = format!("tlogcat:{}", connect_key);
    let pid = {
        let mut procs = HILOG_PROCESSES.lock().map_err(|e| e.to_string())?;
        procs.remove(&key)
    };

    if let Some(pid) = pid {
        let _ = cmd("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .output()
            .await;
        Ok(())
    } else {
        Err("No tlogcat running for this device".to_string())
    }
}

/// Export hilog entries to a text file.
pub async fn export(entries: Vec<HilogEntry>, path: String) -> Result<(), String> {
    let content: String = entries
        .iter()
        .map(|e| {
            format!(
                "{} {} {} {}: {}",
                e.timestamp, e.pid, e.tid, e.tag, e.message
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    tokio::fs::write(&path, content)
        .await
        .map_err(|e| format!("Failed to write hilog file: {}", e))
}
