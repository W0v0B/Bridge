import { invoke } from "@tauri-apps/api/core";
import type {
  AdbDevice,
  FileEntry,
  LogEntry,
  LogcatFilter,
  PackageInfo,
} from "../types/adb";

export async function getDevices() {
  return invoke<AdbDevice[]>("get_devices");
}

export async function connectNetworkDevice(host: string, port: number) {
  return invoke<string>("connect_network_device", { host, port });
}

export async function disconnectDevice(serial: string) {
  return invoke<string>("disconnect_device", { serial });
}

export async function listFiles(serial: string, path: string) {
  return invoke<FileEntry[]>("list_files", { serial, path });
}

export async function pushFiles(
  serial: string,
  localPaths: string[],
  remotePath: string
) {
  return invoke("push_files", { serial, localPaths, remotePath });
}

export async function pullFile(
  serial: string,
  remotePath: string,
  localPath: string
) {
  return invoke("pull_file", { serial, remotePath, localPath });
}

export async function deleteFile(serial: string, path: string) {
  return invoke("delete_file", { serial, path });
}

export async function runShellCommand(serial: string, command: string) {
  return invoke<string>("run_shell_command", { serial, command });
}

export async function startShellStream(serial: string, command: string) {
  return invoke("start_shell_stream", { serial, command });
}

export async function stopShellStream(serial: string) {
  return invoke("stop_shell_stream", { serial });
}

export async function startLogcat(serial: string, filter: LogcatFilter) {
  return invoke("start_logcat", { serial, filter });
}

export async function stopLogcat(serial: string) {
  return invoke("stop_logcat", { serial });
}

export async function startTlogcat(serial: string) {
  return invoke("start_tlogcat", { serial });
}

export async function stopTlogcat(serial: string) {
  return invoke("stop_tlogcat", { serial });
}

export async function clearDeviceLog(serial: string) {
  return invoke("clear_device_log", { serial });
}

export async function exportLogs(logs: LogEntry[], path: string) {
  return invoke("export_logs", { logs, path });
}

export async function listPackages(serial: string) {
  return invoke<PackageInfo[]>("list_packages", { serial });
}

export async function uninstallPackage(
  serial: string,
  pkg: string,
  isSystem: boolean,
  isRoot: boolean
) {
  return invoke<string>("uninstall_package", {
    serial,
    package: pkg,
    isSystem,
    isRoot,
  });
}

export async function installApk(serial: string, apkPath: string) {
  return invoke("install_apk", { serial, apkPath });
}
