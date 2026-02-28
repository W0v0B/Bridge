mod adb;
mod serial;
mod config;

use adb::{commands, device, file, logcat};
use serial::{manager, state};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            list_devices,
            push_file,
            pull_file,
            run_shell_command,
            start_logcat,
            stop_logcat,
            list_serial_ports,
            open_serial_port,
            close_serial_port,
            write_serial,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
async fn list_devices() -> Result<Vec<device::DeviceInfo>, String> {
    device::list_devices().await
}

#[tauri::command]
async fn push_file(serial: String, local_path: String, remote_path: String) -> Result<(), String> {
    file::push_file(&serial, &local_path, &remote_path).await
}

#[tauri::command]
async fn pull_file(serial: String, remote_path: String, local_path: String) -> Result<(), String> {
    file::pull_file(&serial, &remote_path, &local_path).await
}

#[tauri::command]
async fn run_shell_command(serial: String, command: String) -> Result<String, String> {
    commands::run_shell(&serial, &command).await
}

#[tauri::command]
async fn start_logcat(serial: String) -> Result<(), String> {
    logcat::start(&serial).await
}

#[tauri::command]
async fn stop_logcat(serial: String) -> Result<(), String> {
    logcat::stop(&serial).await
}

#[tauri::command]
async fn list_serial_ports() -> Result<Vec<String>, String> {
    manager::list_ports()
}

#[tauri::command]
async fn open_serial_port(port_name: String, baud_rate: u32) -> Result<(), String> {
    manager::open_port(&port_name, baud_rate)
}

#[tauri::command]
async fn close_serial_port(port_name: String) -> Result<(), String> {
    manager::close_port(&port_name)
}

#[tauri::command]
async fn write_serial(port_name: String, data: String) -> Result<(), String> {
    manager::write_data(&port_name, &data)
}
