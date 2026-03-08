import { invoke } from "@tauri-apps/api/core";

/** Copy a local file to the app-data directory. Returns the stored path. */
export async function saveBgImage(srcPath: string): Promise<string> {
  return invoke("save_bg_image", { srcPath });
}

/** Read the stored background image and return it as a base64 data URL. */
export async function loadBgImage(path: string): Promise<string> {
  return invoke("load_bg_image", { path });
}

/** Delete the stored background image file. */
export async function removeBgImage(path: string): Promise<void> {
  return invoke("remove_bg_image", { path });
}
