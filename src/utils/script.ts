import { invoke } from "@tauri-apps/api/core";

export async function runLocalScript(id: string, scriptPath: string) {
  return invoke("run_local_script", { id, scriptPath });
}

export async function stopLocalScript(id: string) {
  return invoke("stop_local_script", { id });
}
