use std::collections::HashMap;
use std::sync::Mutex;

use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use crate::log_stream::batch_stream_loop;
use crate::util::{cmd, decode_process_output};

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

/// Emitted when a hilog or tlogcat process exits.
#[derive(Debug, Clone, Serialize)]
pub struct HilogExit {
    pub connect_key: String,
    pub mode: String,
    pub code: Option<i32>,
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

/// Parse a tlogcat line with fallback: unparseable non-empty lines become INFO entries.
fn parse_tlogcat_line(line: &str) -> Option<HilogEntry> {
    if let Some(entry) = parse_hilog_line(line) {
        return Some(entry);
    }
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(HilogEntry {
        timestamp: String::new(),
        pid: String::new(),
        tid: String::new(),
        level: "I".to_string(),
        tag: String::new(),
        message: trimmed.to_string(),
    })
}

/// Check if a hilog entry passes the given filter.
fn passes_filter(entry: &HilogEntry, filter: &HilogFilter, keyword_lower: Option<&str>) -> bool {
    if let Some(ref min_level) = filter.level {
        let levels = ["D", "I", "W", "E", "F"];
        let min_idx = levels.iter().position(|&l| l == min_level.as_str()).unwrap_or(0);
        let entry_idx = levels.iter().position(|&l| l == entry.level.as_str()).unwrap_or(0);
        if entry_idx < min_idx {
            return false;
        }
    }
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
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start hilog: {}", e))?;

    let pid = child.id().ok_or("Failed to get hilog PID")?;

    {
        let mut procs = HILOG_PROCESSES.lock().map_err(|e| e.to_string())?;
        procs.insert(key.clone(), pid);
    }

    let connect_key_owned = connect_key.to_string();
    let keyword_lower: Option<String> = filter.keyword.as_ref()
        .filter(|k| !k.is_empty())
        .map(|k| k.to_lowercase());

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
                    tag: "hilog-stderr".to_string(),
                    message: trimmed.to_string(),
                };
                let _ = stderr_app.emit("hilog_lines", HilogBatch {
                    connect_key: stderr_key.clone(),
                    entries: vec![entry],
                });
            }
        });
    }

    tokio::spawn(async move {
        if let Some(stdout) = child.stdout.take() {
            let reader = BufReader::new(stdout);
            let kw = keyword_lower.as_deref();
            let ck_ref = &connect_key_owned;

            batch_stream_loop(
                reader,
                parse_hilog_line,
                Some(move |entry: &HilogEntry| passes_filter(entry, &filter, kw)),
                |entries| {
                    let _ = app.emit("hilog_lines", HilogBatch {
                        connect_key: ck_ref.clone(),
                        entries,
                    });
                },
            ).await;
        }

        let exit_status = child.wait().await.ok();
        let code = exit_status.and_then(|s| s.code());

        if let Ok(mut procs) = HILOG_PROCESSES.lock() {
            procs.remove(&format!("hilog:{}", connect_key_owned));
        }

        let _ = app.emit("hilog_exit", HilogExit {
            connect_key: connect_key_owned,
            mode: "hilog".to_string(),
            code,
        });
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
        Err(format!("hilog -r failed: {}", decode_process_output(&output.stderr)))
    }
}

/// Start tlogcat streaming for an OHOS device, emitting `hdc_tlogcat_lines` events.
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
            let ck_ref = &connect_key_owned;

            batch_stream_loop(
                reader,
                parse_tlogcat_line,
                None::<fn(&HilogEntry) -> bool>,
                |entries| {
                    let _ = app.emit("hdc_tlogcat_lines", HilogBatch {
                        connect_key: ck_ref.clone(),
                        entries,
                    });
                },
            ).await;
        }

        let exit_status = child.wait().await.ok();
        let code = exit_status.and_then(|s| s.code());

        if let Ok(mut procs) = HILOG_PROCESSES.lock() {
            procs.remove(&format!("tlogcat:{}", connect_key_owned));
        }

        let _ = app.emit("hilog_exit", HilogExit {
            connect_key: connect_key_owned,
            mode: "tlogcat".to_string(),
            code,
        });
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

/// Kill any running hilog and tlogcat streams for the given device (best-effort).
pub async fn kill_streams_for_device(connect_key: &str) {
    let hilog_key = format!("hilog:{}", connect_key);
    let tlogcat_key = format!("tlogcat:{}", connect_key);
    let pids: Vec<u32> = {
        let mut procs = match HILOG_PROCESSES.lock() {
            Ok(p) => p,
            Err(_) => return,
        };
        let mut found = Vec::new();
        if let Some(pid) = procs.remove(&hilog_key) {
            found.push(pid);
        }
        if let Some(pid) = procs.remove(&tlogcat_key) {
            found.push(pid);
        }
        found
    };
    for pid in pids {
        let _ = cmd("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .output()
            .await;
    }
}

/// Export hilog entries to a text file.
pub async fn export(entries: Vec<HilogEntry>, path: String) -> Result<(), String> {
    let content: String = entries
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
        .map_err(|e| format!("Failed to write hilog file: {}", e))
}
