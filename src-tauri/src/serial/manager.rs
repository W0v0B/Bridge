use serialport::available_ports;
use std::collections::HashMap;
use std::sync::Mutex;
use once_cell::sync::Lazy;

static OPEN_PORTS: Lazy<Mutex<HashMap<String, Box<dyn serialport::SerialPort + Send>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

pub fn list_ports() -> Result<Vec<String>, String> {
    let ports = available_ports().map_err(|e| e.to_string())?;
    Ok(ports.iter().map(|p| p.port_name.clone()).collect())
}

pub fn open_port(port_name: &str, baud_rate: u32) -> Result<(), String> {
    let port = serialport::new(port_name, baud_rate)
        .timeout(std::time::Duration::from_millis(100))
        .open()
        .map_err(|e| e.to_string())?;

    let mut ports = OPEN_PORTS.lock().map_err(|e| e.to_string())?;
    ports.insert(port_name.to_string(), port);
    Ok(())
}

pub fn close_port(port_name: &str) -> Result<(), String> {
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
