use std::collections::HashMap;
use std::sync::Mutex;

use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

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

#[derive(Debug, Clone, Deserialize)]
pub struct LogcatFilter {
    pub level: Option<String>,
    pub tags: Option<Vec<String>>,
    pub keyword: Option<String>,
}

/// Store PIDs of running logcat/tlogcat processes, keyed by "{type}:{serial}"
static LOGCAT_PROCESSES: Lazy<Mutex<HashMap<String, u32>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

// Threadtime format: MM-DD HH:MM:SS.mmm  PID  TID LEVEL TAG     : message
static THREADTIME_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"^(\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3})\s+(\d+)\s+(\d+)\s+([VDIWEF])\s+(\S+)\s*:\s*(.*)"
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
fn passes_filter(entry: &LogEntry, filter: &LogcatFilter) -> bool {
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
    // Keyword search
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

    let mut child = Command::new(adb_path())
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

    tokio::spawn(async move {
        if let Some(stdout) = child.stdout.take() {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();

            while let Ok(Some(line)) = lines.next_line().await {
                if let Some(entry) = parse_logcat_line(&line) {
                    if passes_filter(&entry, &filter) {
                        let _ = app.emit("logcat_line", &entry);
                    }
                }
            }
        }

        // Clean up when process exits
        let mut procs = LOGCAT_PROCESSES.lock().unwrap();
        procs.remove(&format!("logcat:{}", serial_owned));
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
        // On Windows, use taskkill
        let _ = tokio::process::Command::new("taskkill")
            .args(["/F", "/PID", &pid.to_string()])
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

    let mut child = Command::new(adb_path())
        .args(["-s", serial, "shell", "tlogcat"])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to start tlogcat: {}", e))?;

    let pid = child.id().ok_or("Failed to get tlogcat PID")?;

    {
        let mut procs = LOGCAT_PROCESSES.lock().map_err(|e| e.to_string())?;
        procs.insert(key.clone(), pid);
    }

    let serial_owned = serial.to_string();

    tokio::spawn(async move {
        if let Some(stdout) = child.stdout.take() {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();

            while let Ok(Some(line)) = lines.next_line().await {
                if let Some(entry) = parse_tlogcat_line(&line) {
                    let _ = app.emit("tlogcat_line", &entry);
                }
            }
        }

        let mut procs = LOGCAT_PROCESSES.lock().unwrap();
        procs.remove(&format!("tlogcat:{}", serial_owned));
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
        let _ = tokio::process::Command::new("taskkill")
            .args(["/F", "/PID", &pid.to_string()])
            .output()
            .await;
        Ok(())
    } else {
        Err("No tlogcat running for this device".to_string())
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
