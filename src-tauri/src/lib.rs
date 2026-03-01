mod adb;
mod serial;
mod config;

use adb::{commands, device, file, logcat};
use serial::manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            device::start_device_watcher(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // ADB device commands
            get_devices,
            connect_network_device,
            disconnect_device,
            // ADB file commands
            list_files,
            push_files,
            pull_file,
            delete_file,
            // ADB shell/utility commands
            run_shell_command,
            // ADB logcat commands
            start_logcat,
            stop_logcat,
            start_tlogcat,
            stop_tlogcat,
            export_logs,
            // Serial commands
            list_serial_ports,
            open_serial_port,
            close_serial_port,
            write_serial,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// ── ADB Device Commands ──

#[tauri::command]
async fn get_devices() -> Result<Vec<device::AdbDevice>, String> {
    device::list_devices().await
}

#[tauri::command]
async fn connect_network_device(host: String, port: u16) -> Result<String, String> {
    device::connect_network_device(&host, port).await
}

#[tauri::command]
async fn disconnect_device(serial: String) -> Result<String, String> {
    device::disconnect_device(&serial).await
}

// ── ADB File Commands ──

#[tauri::command]
async fn list_files(serial: String, path: String) -> Result<Vec<file::FileEntry>, String> {
    file::list_directory(&serial, &path).await
}

#[tauri::command]
async fn push_files(
    serial: String,
    local_paths: Vec<String>,
    remote_path: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    file::push_files(&serial, local_paths, &remote_path, app).await
}

#[tauri::command]
async fn pull_file(
    serial: String,
    remote_path: String,
    local_path: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    file::pull_file(&serial, &remote_path, &local_path, app).await
}

#[tauri::command]
async fn delete_file(serial: String, path: String) -> Result<(), String> {
    file::delete_file(&serial, &path).await
}

// ── ADB Shell Commands ──

#[tauri::command]
async fn run_shell_command(serial: String, command: String) -> Result<String, String> {
    commands::run_shell(&serial, &command).await
}

// ── ADB Logcat Commands ──

#[tauri::command]
async fn start_logcat(
    serial: String,
    filter: logcat::LogcatFilter,
    app: tauri::AppHandle,
) -> Result<(), String> {
    logcat::start(&serial, filter, app).await
}

#[tauri::command]
async fn stop_logcat(serial: String) -> Result<(), String> {
    logcat::stop(&serial).await
}

#[tauri::command]
async fn start_tlogcat(serial: String, app: tauri::AppHandle) -> Result<(), String> {
    logcat::start_tlogcat(&serial, app).await
}

#[tauri::command]
async fn stop_tlogcat(serial: String) -> Result<(), String> {
    logcat::stop_tlogcat(&serial).await
}

#[tauri::command]
async fn export_logs(logs: Vec<logcat::LogEntry>, path: String) -> Result<(), String> {
    logcat::export_logs(logs, path).await
}

// ── Serial Commands ──

#[tauri::command]
async fn list_serial_ports() -> Result<Vec<String>, String> {
    manager::list_ports()
}

#[tauri::command]
async fn open_serial_port(port_name: String, baud_rate: u32, app: tauri::AppHandle) -> Result<(), String> {
    manager::open_port(&port_name, baud_rate, app)
}

#[tauri::command]
async fn close_serial_port(port_name: String) -> Result<(), String> {
    manager::close_port(&port_name)
}

#[tauri::command]
async fn write_serial(port_name: String, data: String) -> Result<(), String> {
    manager::write_data(&port_name, &data)
}
