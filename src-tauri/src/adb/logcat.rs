use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use crate::util::{cmd, decode_process_output};
use tokio::time::Instant;

use super::commands::adb_path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEntry {
    pub timestamp: String,
    pub pid: String,
    pub tid: String,
    pub level: String,
    pub tag: String,
    pub message: String,
}

/// Wrapper for emitting log batches with device serial info.
#[derive(Debug, Clone, Serialize)]
pub struct LogcatBatch {
    pub serial: String,
    pub entries: Vec<LogEntry>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LogcatFilter {
    pub level: Option<String>,
    pub tags: Option<Vec<String>>,
    pub keyword: Option<String>,
}

/// Store PIDs of running logcat/tlogcat processes, keyed by "{type}:{serial}"
static LOGCAT_PROCESSES: Lazy<Mutex<HashMap<String, u32>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

// Threadtime format (handles both with and without year prefix):
//   MM-DD HH:MM:SS.mmm  PID  TID LEVEL TAG     : message
//   YYYY-MM-DD HH:MM:SS.mmm  PID  TID LEVEL TAG     : message
static THREADTIME_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"^(?:\d{4}-)?(\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3})\s+(\d+)\s+(\d+)\s+([VDIWEF])\s+(.+?)\s*:\s*(.*)"
    )
    .unwrap()
});

// Brief format: L/Tag(PID): message
static BRIEF_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^([VDIWEF])/(\S+)\s*\(\s*(\d+)\)\s*:\s*(.*)").unwrap()
});

fn parse_logcat_line(line: &str) -> Option<LogEntry> {
    if let Some(caps) = THREADTIME_RE.captures(line) {
        return Some(LogEntry {
            timestamp: caps[1].to_string(),
            pid: caps[2].to_string(),
            tid: caps[3].to_string(),
            level: caps[4].to_string(),
            tag: caps[5].to_string(),
            message: caps[6].to_string(),
        });
    }
    None
}

fn parse_tlogcat_line(line: &str) -> Option<LogEntry> {
    // Try threadtime first
    if let Some(entry) = parse_logcat_line(line) {
        return Some(entry);
    }
    // Try brief format
    if let Some(caps) = BRIEF_RE.captures(line) {
        return Some(LogEntry {
            timestamp: String::new(),
            pid: caps[3].to_string(),
            tid: String::new(),
            level: caps[1].to_string(),
            tag: caps[2].to_string(),
            message: caps[4].to_string(),
        });
    }
    // Fall back: treat entire line as INFO message
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(LogEntry {
        timestamp: String::new(),
        pid: String::new(),
        tid: String::new(),
        level: "I".to_string(),
        tag: String::new(),
        message: trimmed.to_string(),
    })
}

/// Check if a log entry passes the given filter.
/// `keyword_lower` is the pre-lowercased keyword (avoids repeated `.to_lowercase()` per line).
fn passes_filter(entry: &LogEntry, filter: &LogcatFilter, keyword_lower: Option<&str>) -> bool {
    // Level threshold
    if let Some(ref min_level) = filter.level {
        let levels = ["V", "D", "I", "W", "E", "F"];
        let min_idx = levels.iter().position(|&l| l == min_level.as_str()).unwrap_or(0);
        let entry_idx = levels.iter().position(|&l| l == entry.level.as_str()).unwrap_or(0);
        if entry_idx < min_idx {
            return false;
        }
    }
    // Tag whitelist
    if let Some(ref tags) = filter.tags {
        if !tags.is_empty() && !tags.iter().any(|t| entry.tag.contains(t.as_str())) {
            return false;
        }
    }
    // Keyword search — keyword is pre-lowercased by caller
    if let Some(kw) = keyword_lower {
        if !kw.is_empty()
            && !entry.message.to_lowercase().contains(kw)
            && !entry.tag.to_lowercase().contains(kw)
        {
            return false;
        }
    }
    true
}

/// Start logcat streaming for a device, emitting `logcat_line` events.
pub async fn start(
    serial: &str,
    filter: LogcatFilter,
    app: AppHandle,
) -> Result<(), String> {
    let key = format!("logcat:{}", serial);

    // Stop existing if running
    {
        let procs = LOGCAT_PROCESSES.lock().map_err(|e| e.to_string())?;
        if procs.contains_key(&key) {
            return Err("Logcat already running for this device".to_string());
        }
    }

    let mut child = cmd(adb_path())
        .args(["-s", serial, "logcat", "-v", "threadtime"])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to start logcat: {}", e))?;

    let pid = child.id().ok_or("Failed to get logcat PID")?;

    {
        let mut procs = LOGCAT_PROCESSES.lock().map_err(|e| e.to_string())?;
        procs.insert(key.clone(), pid);
    }

    let serial_owned = serial.to_string();
    // Pre-lowercase keyword once so passes_filter doesn't re-allocate per line
    let keyword_lower: Option<String> = filter.keyword.as_ref()
        .filter(|k| !k.is_empty())
        .map(|k| k.to_lowercase());

    tokio::spawn(async move {
        if let Some(stdout) = child.stdout.take() {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();
            let mut batch: Vec<LogEntry> = Vec::with_capacity(64);
            let mut last_flush = Instant::now();
            let flush_interval = Duration::from_millis(50);
            let kw = keyword_lower.as_deref();

            loop {
                // Use a timeout so we flush partial batches promptly
                let maybe_line = tokio::time::timeout(flush_interval, lines.next_line()).await;

                match maybe_line {
                    Ok(Ok(Some(line))) => {
                        if let Some(entry) = parse_logcat_line(&line) {
                            if passes_filter(&entry, &filter, kw) {
                                batch.push(entry);
                            }
                        }
                        // Flush when batch is large enough or interval elapsed
                        if batch.len() >= 64 || last_flush.elapsed() >= flush_interval {
                            if !batch.is_empty() {
                                let _ = app.emit("logcat_lines", LogcatBatch {
                                    serial: serial_owned.clone(),
                                    entries: std::mem::take(&mut batch),
                                });
                            }
                            last_flush = Instant::now();
                        }
                    }
                    Ok(Ok(None)) => {
                        // EOF
                        if !batch.is_empty() {
                            let _ = app.emit("logcat_lines", LogcatBatch {
                                serial: serial_owned.clone(),
                                entries: batch,
                            });
                        }
                        break;
                    }
                    Ok(Err(_)) => {
                        if !batch.is_empty() {
                            let _ = app.emit("logcat_lines", LogcatBatch {
                                serial: serial_owned.clone(),
                                entries: batch,
                            });
                        }
                        break;
                    }
                    Err(_) => {
                        // Timeout — flush whatever we have
                        if !batch.is_empty() {
                            let _ = app.emit("logcat_lines", LogcatBatch {
                                serial: serial_owned.clone(),
                                entries: std::mem::take(&mut batch),
                            });
                            last_flush = Instant::now();
                        }
                    }
                }
            }
        }

        // Clean up when process exits
        if let Ok(mut procs) = LOGCAT_PROCESSES.lock() {
            procs.remove(&format!("logcat:{}", serial_owned));
        }
    });

    Ok(())
}

/// Stop logcat for a device.
pub async fn stop(serial: &str) -> Result<(), String> {
    let key = format!("logcat:{}", serial);
    let pid = {
        let mut procs = LOGCAT_PROCESSES.lock().map_err(|e| e.to_string())?;
        procs.remove(&key)
    };

    if let Some(pid) = pid {
        // On Windows, use taskkill with /T to kill the process tree
        let _ = cmd("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .output()
            .await;
        Ok(())
    } else {
        Err("No logcat running for this device".to_string())
    }
}

/// Start tlogcat (TEE log) streaming for a device, emitting `tlogcat_line` events.
pub async fn start_tlogcat(
    serial: &str,
    app: AppHandle,
) -> Result<(), String> {
    let key = format!("tlogcat:{}", serial);

    {
        let procs = LOGCAT_PROCESSES.lock().map_err(|e| e.to_string())?;
        if procs.contains_key(&key) {
            return Err("tlogcat already running for this device".to_string());
        }
    }

    let mut child = cmd(adb_path())
        .args(["-s", serial, "shell", "tlogcat"])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start tlogcat: {}", e))?;

    let pid = child.id().ok_or("Failed to get tlogcat PID")?;

    {
        let mut procs = LOGCAT_PROCESSES.lock().map_err(|e| e.to_string())?;
        procs.insert(key.clone(), pid);
    }

    let serial_owned = serial.to_string();

    // Spawn a task to read stderr and emit as error-level log entries
    if let Some(stderr) = child.stderr.take() {
        let stderr_serial = serial_owned.clone();
        let stderr_app = app.clone();
        tokio::spawn(async move {
            let reader = BufReader::new(stderr);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                let entry = LogEntry {
                    timestamp: String::new(),
                    pid: String::new(),
                    tid: String::new(),
                    level: "E".to_string(),
                    tag: "tlogcat".to_string(),
                    message: trimmed.to_string(),
                };
                let _ = stderr_app.emit("tlogcat_lines", LogcatBatch {
                    serial: stderr_serial.clone(),
                    entries: vec![entry],
                });
            }
        });
    }

    tokio::spawn(async move {
        if let Some(stdout) = child.stdout.take() {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();
            let mut batch: Vec<LogEntry> = Vec::with_capacity(64);
            let mut last_flush = Instant::now();
            let flush_interval = Duration::from_millis(50);

            loop {
                let maybe_line = tokio::time::timeout(flush_interval, lines.next_line()).await;

                match maybe_line {
                    Ok(Ok(Some(line))) => {
                        if let Some(entry) = parse_tlogcat_line(&line) {
                            batch.push(entry);
                        }
                        if batch.len() >= 64 || last_flush.elapsed() >= flush_interval {
                            if !batch.is_empty() {
                                let _ = app.emit("tlogcat_lines", LogcatBatch {
                                    serial: serial_owned.clone(),
                                    entries: std::mem::take(&mut batch),
                                });
                            }
                            last_flush = Instant::now();
                        }
                    }
                    Ok(Ok(None)) => {
                        if !batch.is_empty() {
                            let _ = app.emit("tlogcat_lines", LogcatBatch {
                                serial: serial_owned.clone(),
                                entries: batch,
                            });
                        }
                        break;
                    }
                    Ok(Err(_)) => {
                        if !batch.is_empty() {
                            let _ = app.emit("tlogcat_lines", LogcatBatch {
                                serial: serial_owned.clone(),
                                entries: batch,
                            });
                        }
                        break;
                    }
                    Err(_) => {
                        if !batch.is_empty() {
                            let _ = app.emit("tlogcat_lines", LogcatBatch {
                                serial: serial_owned.clone(),
                                entries: std::mem::take(&mut batch),
                            });
                            last_flush = Instant::now();
                        }
                    }
                }
            }
        }

        if let Ok(mut procs) = LOGCAT_PROCESSES.lock() {
            procs.remove(&format!("tlogcat:{}", serial_owned));
        }
    });

    Ok(())
}

/// Stop tlogcat for a device.
pub async fn stop_tlogcat(serial: &str) -> Result<(), String> {
    let key = format!("tlogcat:{}", serial);
    let pid = {
        let mut procs = LOGCAT_PROCESSES.lock().map_err(|e| e.to_string())?;
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

/// Clear the on-device logcat ring buffer via `adb logcat -c`.
pub async fn clear_device_log(serial: &str) -> Result<(), String> {
    let output = cmd(adb_path())
        .args(["-s", serial, "logcat", "-c"])
        .output()
        .await
        .map_err(|e| format!("Failed to run logcat -c: {}", e))?;

    if output.status.success() {
        Ok(())
    } else {
        Err(format!("logcat -c failed: {}", decode_process_output(&output.stderr)))
    }
}

/// Export log entries to a text file.
pub async fn export_logs(logs: Vec<LogEntry>, path: String) -> Result<(), String> {
    let content: String = logs
        .iter()
        .map(|e| {
            format!(
                "{} {} {} {}/{}: {}",
                e.timestamp, e.pid, e.tid, e.level, e.tag, e.message
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    tokio::fs::write(&path, content)
        .await
        .map_err(|e| format!("Failed to write log file: {}", e))
}
