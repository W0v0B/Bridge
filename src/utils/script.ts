import { invoke } from "@tauri-apps/api/core";

export async function runLocalScript(id: string, scriptPath: string) {
  return invoke("run_local_script", { id, scriptPath });
}

export async function stopLocalScript(id: string) {
  return invoke("stop_local_script", { id });
}

export async function readScriptFile(path: string): Promise<string> {
  return invoke<string>("read_script_file", { path });
}

export async function sendScriptInput(id: string, data: string) {
  return invoke("send_script_input", { id, data });
}
