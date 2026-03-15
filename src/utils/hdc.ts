import { invoke } from "@tauri-apps/api/core";
import type { OhosDevice, HilogEntry, HilogFilter, BundleInfo } from "../types/hdc";
import type { FileEntry } from "../types/adb";

export async function getOhosDevices() {
  return invoke<OhosDevice[]>("get_ohos_devices");
}

export async function connectOhosDevice(addr: string) {
  return invoke<string>("connect_ohos_device", { addr });
}

export async function disconnectOhosDevice(addr: string) {
  return invoke<string>("disconnect_ohos_device", { addr });
}

export async function runHdcShellCommand(connectKey: string, command: string) {
  return invoke<string>("run_hdc_shell_command", { connectKey, command });
}

export async function startHdcShellStream(connectKey: string, command: string) {
  return invoke("start_hdc_shell_stream", { connectKey, command });
}

export async function stopHdcShellStream(connectKey: string) {
  return invoke("stop_hdc_shell_stream", { connectKey });
}

export async function listHdcFiles(connectKey: string, path: string) {
  return invoke<FileEntry[]>("list_hdc_files", { connectKey, path });
}

export async function sendHdcFiles(
  connectKey: string,
  localPaths: string[],
  remotePath: string
) {
  return invoke("send_hdc_files", { connectKey, localPaths, remotePath });
}

export async function recvHdcFile(
  connectKey: string,
  remotePath: string,
  localPath: string
) {
  return invoke("recv_hdc_file", { connectKey, remotePath, localPath });
}

export async function deleteHdcFile(connectKey: string, path: string) {
  return invoke("delete_hdc_file", { connectKey, path });
}

export async function startHilog(connectKey: string, filter: HilogFilter) {
  return invoke("start_hilog", { connectKey, filter });
}

export async function stopHilog(connectKey: string) {
  return invoke("stop_hilog", { connectKey });
}

export async function clearHilog(connectKey: string) {
  return invoke("clear_hilog", { connectKey });
}

export async function exportHilog(entries: HilogEntry[], path: string) {
  return invoke("export_hilog", { entries, path });
}

export async function listBundles(connectKey: string) {
  return invoke<BundleInfo[]>("list_bundles", { connectKey });
}

export async function installHap(connectKey: string, hapPath: string) {
  return invoke<string>("install_hap", { connectKey, hapPath });
}

export async function uninstallBundle(connectKey: string, bundleName: string) {
  return invoke<string>("uninstall_bundle", { connectKey, bundleName });
}

export async function forceStopBundle(connectKey: string, bundleName: string) {
  return invoke("force_stop_bundle", { connectKey, bundleName });
}

export async function clearBundleData(connectKey: string, bundleName: string) {
  return invoke("clear_bundle_data", { connectKey, bundleName });
}
