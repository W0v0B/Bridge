import { invoke } from "@tauri-apps/api/core";

export async function writeTextFileTo(path: string, content: string) {
  return invoke("write_text_file_to_path", { path, content });
}

export async function appendTextToFile(path: string, content: string) {
  return invoke("append_text_to_file", { path, content });
}
