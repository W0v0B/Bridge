use serialport::available_ports;
use std::collections::HashMap;
use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use once_cell::sync::Lazy;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

static OPEN_PORTS: Lazy<Mutex<HashMap<String, Box<dyn serialport::SerialPort + Send>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

static READER_FLAGS: Lazy<Mutex<HashMap<String, Arc<AtomicBool>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

#[derive(Clone, Serialize)]
pub struct SerialDataEvent {
    pub port: String,
    pub data: String,
}

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

    // Clone port for reading; original goes into OPEN_PORTS for writing
    let reader = port.try_clone().map_err(|e| e.to_string())?;

    {
        let mut ports = OPEN_PORTS.lock().map_err(|e| e.to_string())?;
        ports.insert(port_name.to_string(), port);
    }

    // Create stop flag and store it
    let stop_flag = Arc::new(AtomicBool::new(false));
    {
        let mut flags = READER_FLAGS.lock().map_err(|e| e.to_string())?;
        flags.insert(port_name.to_string(), stop_flag.clone());
    }

    // Spawn background read thread
    let name = port_name.to_string();
    std::thread::spawn(move || {
        read_loop(reader, name, stop_flag, app);
    });

    Ok(())
}

fn read_loop(
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
            Ok(_) => {
                // Zero bytes read, just continue
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => {
                // Timeout is expected with 100ms timeout, just loop
            }
            Err(_) => {
                // I/O error — port likely disconnected
                let _ = app.emit("serial_disconnected", port_name.clone());
                break;
            }
        }
    }
}

pub fn close_port(port_name: &str) -> Result<(), String> {
    // Signal stop flag first
    if let Ok(mut flags) = READER_FLAGS.lock() {
        if let Some(flag) = flags.remove(port_name) {
            flag.store(true, Ordering::Relaxed);
        }
    }
    // Then remove the port
    let mut ports = OPEN_PORTS.lock().map_err(|e| e.to_string())?;
    ports.remove(port_name);
    Ok(())
}

pub fn write_data(port_name: &str, data: &str) -> Result<(), String> {
    let mut ports = OPEN_PORTS.lock().map_err(|e| e.to_string())?;
    let port = ports.get_mut(port_name).ok_or("Port not open")?;
    port.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    Ok(())
}
