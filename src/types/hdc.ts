import type { LogEntry, LogFilter } from "./log";

export interface OhosDevice {
  connect_key: string;
  conn_type: string; // "USB" | "TCP"
  state: string;     // "Connected" | "Offline" | "Unauthorized"
  name: string;
  is_remounted: boolean;
  remount_info: string; // empty = attempt still in progress
}

export type HilogEntry = LogEntry;
export type HilogFilter = LogFilter;

export interface HilogBatch {
  connect_key: string;
  entries: HilogEntry[];
}

export interface BundleInfo {
  bundle_name: string;
  code_path: string;
  app_type: "user" | "system" | "vendor" | "product";
}

export interface ScreenFrame {
  connect_key: string;
  data: string; // base64 JPEG
}

export interface HdcScreenMirrorState {
  connect_key: string;
  running: boolean;
}

export interface HdcScreenMirrorConfig {
  intervalMs: number;
}
