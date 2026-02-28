import { invoke } from "@tauri-apps/api/core";

export async function listPorts() {
  return invoke<string[]>("list_serial_ports");
}

export async function openPort(portName: string, baudRate: number) {
  return invoke("open_serial_port", { portName, baudRate });
}

export async function closePort(portName: string) {
  return invoke("close_serial_port", { portName });
}

export async function writeToPort(portName: string, data: string) {
  return invoke("write_serial", { portName, data });
}
