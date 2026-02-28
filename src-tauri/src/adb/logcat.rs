use std::collections::HashMap;
use std::sync::Mutex;
use once_cell::sync::Lazy;

static LOGCAT_SESSIONS: Lazy<Mutex<HashMap<String, bool>>> = Lazy::new(|| Mutex::new(HashMap::new()));

pub async fn start(serial: &str) -> Result<(), String> {
    let mut sessions = LOGCAT_SESSIONS.lock().map_err(|e| e.to_string())?;
    sessions.insert(serial.to_string(), true);
    // TODO: Start actual logcat streaming
    Ok(())
}

pub async fn stop(serial: &str) -> Result<(), String> {
    let mut sessions = LOGCAT_SESSIONS.lock().map_err(|e| e.to_string())?;
    sessions.remove(serial);
    Ok(())
}
