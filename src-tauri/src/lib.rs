mod adb;
mod hdc;
mod serial;
mod config;
pub mod util;

use base64::Engine as _;
use tauri::Manager as _;

use adb::{apps, commands, device, file, logcat, scrcpy};
use hdc::{apps as hdc_apps, commands as hdc_commands, device as hdc_device, file as hdc_file, hilog};
use serial::manager;
use util as script_util;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            device::start_device_watcher(app.handle().clone());
            hdc_device::start_device_watcher(app.handle().clone());
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
            start_shell_stream,
            stop_shell_stream,
            install_apk,
            // ADB app commands
            list_packages,
            uninstall_package,
            force_stop_package,
            clear_package_data,
            re_enable_package,
            // ADB scrcpy commands
            start_scrcpy,
            stop_scrcpy,
            is_scrcpy_running,
            // ADB logcat commands
            start_logcat,
            stop_logcat,
            start_tlogcat,
            stop_tlogcat,
            clear_device_log,
            export_logs,
            // HDC device commands
            get_ohos_devices,
            connect_ohos_device,
            disconnect_ohos_device,
            // HDC shell commands
            run_hdc_shell_command,
            start_hdc_shell_stream,
            stop_hdc_shell_stream,
            // HDC file commands
            list_hdc_files,
            send_hdc_files,
            recv_hdc_file,
            delete_hdc_file,
            // HDC hilog commands
            start_hilog,
            stop_hilog,
            start_hdc_tlogcat,
            stop_hdc_tlogcat,
            clear_hilog,
            export_hilog,
            // HDC app commands
            list_bundles,
            install_hap,
            uninstall_bundle,
            force_stop_bundle,
            clear_bundle_data,
            // Serial commands
            list_serial_ports,
            open_serial_port,
            open_telnet_session,
            close_serial_port,
            write_serial,
            // Script execution
            run_local_script,
            stop_local_script,
            // File utilities
            write_text_file_to_path,
            append_text_to_file,
            // Background image
            save_bg_image,
            load_bg_image,
            remove_bg_image,
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

#[tauri::command]
async fn start_shell_stream(
    serial: String,
    command: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    commands::start_shell_stream(&serial, &command, app).await
}

#[tauri::command]
async fn stop_shell_stream(serial: String) -> Result<(), String> {
    commands::stop_shell_stream(&serial).await
}

#[tauri::command]
async fn install_apk(serial: String, apk_path: String) -> Result<(), String> {
    commands::install_apk(&serial, &apk_path).await
}

// ── ADB App Commands ──

#[tauri::command]
async fn list_packages(serial: String) -> Result<Vec<apps::PackageInfo>, String> {
    apps::list_packages(&serial).await
}

#[tauri::command]
async fn uninstall_package(
    serial: String,
    package: String,
    is_system: bool,
    is_root: bool,
) -> Result<String, String> {
    apps::uninstall_package(&serial, &package, is_system, is_root).await
}

#[tauri::command]
async fn force_stop_package(serial: String, package: String) -> Result<(), String> {
    apps::force_stop_package(&serial, &package).await
}

#[tauri::command]
async fn clear_package_data(serial: String, package: String) -> Result<String, String> {
    apps::clear_package_data(&serial, &package).await
}

#[tauri::command]
async fn re_enable_package(serial: String, package: String) -> Result<String, String> {
    apps::re_enable_package(&serial, &package).await
}

// ── ADB Scrcpy Commands ──

#[tauri::command]
async fn start_scrcpy(serial: String, config: scrcpy::ScrcpyConfig, app: tauri::AppHandle) -> Result<(), String> {
    scrcpy::start(&serial, config, app).await
}

#[tauri::command]
async fn stop_scrcpy(serial: String, app: tauri::AppHandle) -> Result<(), String> {
    scrcpy::stop(&serial, &app).await
}

#[tauri::command]
fn is_scrcpy_running(serial: String) -> bool {
    scrcpy::is_running(&serial)
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
async fn clear_device_log(serial: String) -> Result<(), String> {
    logcat::clear_device_log(&serial).await
}

#[tauri::command]
async fn export_logs(logs: Vec<logcat::LogEntry>, path: String) -> Result<(), String> {
    logcat::export_logs(logs, path).await
}

// ── HDC Device Commands ──

#[tauri::command]
async fn get_ohos_devices() -> Result<Vec<hdc_device::OhosDevice>, String> {
    hdc_device::list_devices().await
}

#[tauri::command]
async fn connect_ohos_device(addr: String) -> Result<String, String> {
    hdc_device::connect_device(&addr).await
}

#[tauri::command]
async fn disconnect_ohos_device(addr: String) -> Result<String, String> {
    hdc_device::disconnect_device(&addr).await
}

// ── HDC Shell Commands ──

#[tauri::command]
async fn run_hdc_shell_command(connect_key: String, command: String) -> Result<String, String> {
    hdc_commands::run_hdc_shell(&connect_key, &command).await
}

#[tauri::command]
async fn start_hdc_shell_stream(
    connect_key: String,
    command: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    hdc_commands::start_shell_stream(&connect_key, &command, app).await
}

#[tauri::command]
async fn stop_hdc_shell_stream(connect_key: String) -> Result<(), String> {
    hdc_commands::stop_shell_stream(&connect_key).await
}

// ── HDC File Commands ──

#[tauri::command]
async fn list_hdc_files(
    connect_key: String,
    path: String,
) -> Result<Vec<hdc_file::FileEntry>, String> {
    hdc_file::list_directory(&connect_key, &path).await
}

#[tauri::command]
async fn send_hdc_files(
    connect_key: String,
    local_paths: Vec<String>,
    remote_path: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    hdc_file::send_files(&connect_key, local_paths, &remote_path, app).await
}

#[tauri::command]
async fn recv_hdc_file(
    connect_key: String,
    remote_path: String,
    local_path: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    hdc_file::recv_file(&connect_key, &remote_path, &local_path, app).await
}

#[tauri::command]
async fn delete_hdc_file(connect_key: String, path: String) -> Result<(), String> {
    hdc_file::delete_file(&connect_key, &path).await
}

// ── HDC HiLog Commands ──

#[tauri::command]
async fn start_hilog(
    connect_key: String,
    filter: hilog::HilogFilter,
    app: tauri::AppHandle,
) -> Result<(), String> {
    hilog::start(&connect_key, filter, app).await
}

#[tauri::command]
async fn stop_hilog(connect_key: String) -> Result<(), String> {
    hilog::stop(&connect_key).await
}

#[tauri::command]
async fn start_hdc_tlogcat(
    connect_key: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    hilog::start_tlogcat(&connect_key, app).await
}

#[tauri::command]
async fn stop_hdc_tlogcat(connect_key: String) -> Result<(), String> {
    hilog::stop_tlogcat(&connect_key).await
}

#[tauri::command]
async fn clear_hilog(connect_key: String) -> Result<(), String> {
    hilog::clear(&connect_key).await
}

#[tauri::command]
async fn export_hilog(entries: Vec<hilog::HilogEntry>, path: String) -> Result<(), String> {
    hilog::export(entries, path).await
}

// ── HDC App Commands ──

#[tauri::command]
async fn list_bundles(connect_key: String) -> Result<Vec<hdc_apps::BundleInfo>, String> {
    hdc_apps::list_bundles(&connect_key).await
}

#[tauri::command]
async fn install_hap(connect_key: String, hap_path: String) -> Result<String, String> {
    hdc_apps::install_hap(&connect_key, &hap_path).await
}

#[tauri::command]
async fn uninstall_bundle(connect_key: String, bundle_name: String) -> Result<String, String> {
    hdc_apps::uninstall_bundle(&connect_key, &bundle_name).await
}

#[tauri::command]
async fn force_stop_bundle(connect_key: String, bundle_name: String) -> Result<(), String> {
    hdc_apps::force_stop_bundle(&connect_key, &bundle_name).await
}

#[tauri::command]
async fn clear_bundle_data(connect_key: String, bundle_name: String) -> Result<(), String> {
    hdc_apps::clear_bundle_data(&connect_key, &bundle_name).await
}

// ── Script Execution ──

#[tauri::command]
async fn run_local_script(
    id: String,
    script_path: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    script_util::run_script(&id, &script_path, app).await
}

#[tauri::command]
async fn stop_local_script(id: String) -> Result<(), String> {
    script_util::stop_script(&id).await
}

// ── File Utilities ──

#[tauri::command]
async fn write_text_file_to_path(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
async fn append_text_to_file(path: String, content: String) -> Result<(), String> {
    use std::io::Write;
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    file.write_all(content.as_bytes()).map_err(|e| e.to_string())
}

// ── Background Image Commands ──

#[tauri::command]
async fn save_bg_image(app: tauri::AppHandle, src_path: String) -> Result<String, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    let src = std::path::Path::new(&src_path);
    let ext = src.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("jpg")
        .to_lowercase();
    let dest = data_dir.join(format!("background.{}", ext));
    std::fs::copy(src, &dest).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
async fn load_bg_image(path: String) -> Result<String, String> {
    let data = std::fs::read(&path).map_err(|e| e.to_string())?;
    let ext = std::path::Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("jpg")
        .to_lowercase();
    let mime = match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "webp"         => "image/webp",
        "gif"          => "image/gif",
        _              => "image/png",
    };
    let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
    Ok(format!("data:{};base64,{}", mime, b64))
}

#[tauri::command]
async fn remove_bg_image(path: String) -> Result<(), String> {
    std::fs::remove_file(&path).map_err(|e| e.to_string())
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
async fn open_telnet_session(host: String, port: u16, app: tauri::AppHandle) -> Result<(), String> {
    tokio::task::spawn_blocking(move || manager::open_telnet(&host, port, app))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn close_serial_port(port_name: String) -> Result<(), String> {
    manager::close_port(&port_name)
}

#[tauri::command]
async fn write_serial(port_name: String, data: String) -> Result<(), String> {
    manager::write_data(&port_name, &data)
}
