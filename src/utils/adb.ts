import { invoke } from "@tauri-apps/api/core";

export async function listDevices() {
  return invoke<{ serial: string; model: string; status: string }[]>("list_devices");
}

export async function pushFile(serial: string, localPath: string, remotePath: string) {
  return invoke("push_file", { serial, localPath, remotePath });
}

export async function pullFile(serial: string, remotePath: string, localPath: string) {
  return invoke("pull_file", { serial, remotePath, localPath });
}

export async function runShellCommand(serial: string, command: string) {
  return invoke<string>("run_shell_command", { serial, command });
}
