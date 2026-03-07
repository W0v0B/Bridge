use serialport::available_ports;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use once_cell::sync::Lazy;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

// ── Serial port state ──────────────────────────────────────────────────────

static OPEN_PORTS: Lazy<Mutex<HashMap<String, Box<dyn serialport::SerialPort + Send>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

static READER_FLAGS: Lazy<Mutex<HashMap<String, Arc<AtomicBool>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

// ── Telnet session state ───────────────────────────────────────────────────

static TELNET_SESSIONS: Lazy<Mutex<HashMap<String, Arc<Mutex<TcpStream>>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

static TELNET_FLAGS: Lazy<Mutex<HashMap<String, Arc<AtomicBool>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

// ── Shared event type ──────────────────────────────────────────────────────

#[derive(Clone, Serialize)]
pub struct SerialDataEvent {
    pub port: String,
    pub data: String,
}

// ── COM port functions ─────────────────────────────────────────────────────

pub fn list_ports() -> Result<Vec<String>, String> {
    let ports = available_ports().map_err(|e| e.to_string())?;
    let mut names: Vec<String> = ports.iter().map(|p| p.port_name.clone()).collect();
    // Sort numerically for COM ports (COM3 < COM10), lexically otherwise
    names.sort_by(|a, b| {
        let num = |s: &str| -> Option<u32> {
            s.to_uppercase()
                .strip_prefix("COM")
                .and_then(|n| n.parse().ok())
        };
        match (num(a), num(b)) {
            (Some(na), Some(nb)) => na.cmp(&nb),
            _ => a.cmp(b),
        }
    });
    Ok(names)
}

pub fn open_port(port_name: &str, baud_rate: u32, app: AppHandle) -> Result<(), String> {
    let port = serialport::new(port_name, baud_rate)
        .timeout(std::time::Duration::from_millis(100))
        .open()
        .map_err(|e| e.to_string())?;

    let reader = port.try_clone().map_err(|e| e.to_string())?;

    {
        let mut ports = OPEN_PORTS.lock().map_err(|e| e.to_string())?;
        ports.insert(port_name.to_string(), port);
    }

    let stop_flag = Arc::new(AtomicBool::new(false));
    {
        let mut flags = READER_FLAGS.lock().map_err(|e| e.to_string())?;
        flags.insert(port_name.to_string(), stop_flag.clone());
    }

    let name = port_name.to_string();
    std::thread::spawn(move || {
        serial_read_loop(reader, name, stop_flag, app);
    });

    Ok(())
}

fn serial_read_loop(
    mut reader: Box<dyn serialport::SerialPort + Send>,
    port_name: String,
    stop_flag: Arc<AtomicBool>,
    app: AppHandle,
) {
    let mut buf = [0u8; 1024];
    loop {
        if stop_flag.load(Ordering::Relaxed) {
            break;
        }
        match reader.read(&mut buf) {
            Ok(n) if n > 0 => {
                let text = String::from_utf8_lossy(&buf[..n]).to_string();
                let _ = app.emit("serial_data", SerialDataEvent {
                    port: port_name.clone(),
                    data: text,
                });
            }
            Ok(_) => {}
            Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => {}
            Err(_) => {
                let _ = app.emit("serial_disconnected", port_name.clone());
                break;
            }
        }
    }
}

// ── Telnet functions ───────────────────────────────────────────────────────

pub fn open_telnet(host: &str, port: u16, app: AppHandle) -> Result<(), String> {
    let addr = format!("{}:{}", host, port);
    let stream = TcpStream::connect(&addr)
        .map_err(|e| format!("Failed to connect to {}: {}", addr, e))?;
    stream
        .set_read_timeout(Some(std::time::Duration::from_millis(100)))
        .map_err(|e| e.to_string())?;

    let reader = stream.try_clone().map_err(|e| e.to_string())?;
    let writer = Arc::new(Mutex::new(stream));

    {
        let mut sessions = TELNET_SESSIONS.lock().map_err(|e| e.to_string())?;
        sessions.insert(addr.clone(), writer);
    }

    let stop_flag = Arc::new(AtomicBool::new(false));
    {
        let mut flags = TELNET_FLAGS.lock().map_err(|e| e.to_string())?;
        flags.insert(addr.clone(), stop_flag.clone());
    }

    std::thread::spawn(move || {
        telnet_read_loop(reader, addr, stop_flag, app);
    });

    Ok(())
}

/// Strips Telnet IAC control sequences from incoming data and returns
/// the printable bytes plus any IAC responses that should be sent back.
///
/// Telnet negotiation (RFC 854):
///   IAC WILL x → respond IAC DONT x  (we decline all offered options)
///   IAC DO   x → respond IAC WONT x  (we refuse all requested options)
///   IAC WONT x / IAC DONT x → ignore (acknowledgements)
///   IAC SB … IAC SE → skip entire subnegotiation block
///   IAC IAC → literal 0xFF byte
fn strip_iac(input: &[u8]) -> (Vec<u8>, Vec<u8>) {
    let mut output = Vec::new();
    let mut responses = Vec::new();
    let mut i = 0;
    while i < input.len() {
        if input[i] != 0xFF {
            output.push(input[i]);
            i += 1;
            continue;
        }
        // IAC byte
        if i + 1 >= input.len() {
            i += 1;
            continue;
        }
        match input[i + 1] {
            0xFF => {
                // IAC IAC → literal 0xFF
                output.push(0xFF);
                i += 2;
            }
            0xFB => {
                // IAC WILL x → IAC DONT x
                if i + 2 < input.len() {
                    responses.extend_from_slice(&[0xFF, 0xFE, input[i + 2]]);
                    i += 3;
                } else {
                    i += 2;
                }
            }
            0xFD => {
                // IAC DO x → IAC WONT x
                if i + 2 < input.len() {
                    responses.extend_from_slice(&[0xFF, 0xFC, input[i + 2]]);
                    i += 3;
                } else {
                    i += 2;
                }
            }
            0xFC | 0xFE => {
                // IAC WONT x / IAC DONT x → ignore
                i += if i + 2 < input.len() { 3 } else { 2 };
            }
            0xFA => {
                // IAC SB … IAC SE → skip subnegotiation
                i += 2;
                while i + 1 < input.len() {
                    if input[i] == 0xFF && input[i + 1] == 0xF0 {
                        i += 2;
                        break;
                    }
                    i += 1;
                }
            }
            _ => {
                // Other 2-byte IAC command → skip
                i += 2;
            }
        }
    }
    (output, responses)
}

fn telnet_read_loop(
    mut reader: TcpStream,
    session_id: String,
    stop_flag: Arc<AtomicBool>,
    app: AppHandle,
) {
    let mut buf = [0u8; 1024];
    loop {
        if stop_flag.load(Ordering::Relaxed) {
            break;
        }
        match reader.read(&mut buf) {
            Ok(n) if n > 0 => {
                let (filtered, responses) = strip_iac(&buf[..n]);

                // Send IAC responses (clone Arc first to avoid holding outer lock while locking inner)
                if !responses.is_empty() {
                    let writer = TELNET_SESSIONS
                        .lock()
                        .ok()
                        .and_then(|s| s.get(&session_id).cloned());
                    if let Some(arc) = writer {
                        if let Ok(mut w) = arc.lock() {
                            let _ = w.write_all(&responses);
                        }
                    }
                }

                if !filtered.is_empty() {
                    let text = String::from_utf8_lossy(&filtered).to_string();
                    let _ = app.emit("serial_data", SerialDataEvent {
                        port: session_id.clone(),
                        data: text,
                    });
                }
            }
            Ok(_) => {}
            Err(ref e)
                if e.kind() == std::io::ErrorKind::TimedOut
                    || e.kind() == std::io::ErrorKind::WouldBlock =>
            {}
            Err(_) => {
                let _ = app.emit("serial_disconnected", session_id.clone());
                break;
            }
        }
    }
}

// ── Shared write / close (routes to serial or telnet) ─────────────────────

pub fn write_data(port_name: &str, data: &str) -> Result<(), String> {
    // Try serial port first
    {
        let mut ports = OPEN_PORTS.lock().map_err(|e| e.to_string())?;
        if let Some(port) = ports.get_mut(port_name) {
            return port.write_all(data.as_bytes()).map_err(|e| e.to_string());
        }
    }
    // Try telnet session — clone Arc before releasing outer lock to avoid potential deadlock
    let session = {
        let sessions = TELNET_SESSIONS.lock().map_err(|e| e.to_string())?;
        sessions.get(port_name).cloned()
    };
    if let Some(arc) = session {
        let mut w = arc.lock().map_err(|e| e.to_string())?;
        return w.write_all(data.as_bytes()).map_err(|e| e.to_string());
    }
    Err("Port not open".to_string())
}

pub fn close_port(port_name: &str) -> Result<(), String> {
    // Signal stop flags for both serial and telnet
    if let Ok(mut flags) = READER_FLAGS.lock() {
        if let Some(flag) = flags.remove(port_name) {
            flag.store(true, Ordering::Relaxed);
        }
    }
    if let Ok(mut flags) = TELNET_FLAGS.lock() {
        if let Some(flag) = flags.remove(port_name) {
            flag.store(true, Ordering::Relaxed);
        }
    }
    // Remove from whichever map holds it
    if let Ok(mut ports) = OPEN_PORTS.lock() {
        ports.remove(port_name);
    }
    if let Ok(mut sessions) = TELNET_SESSIONS.lock() {
        sessions.remove(port_name);
    }
    Ok(())
}
