export interface OhosDevice {
  connect_key: string;
  conn_type: string; // "USB" | "TCP"
  state: string;     // "Connected" | "Offline" | "Unauthorized"
  name: string;
  is_remounted: boolean;
  remount_info: string; // empty = attempt still in progress
}

export interface HilogEntry {
  timestamp: string;
  pid: string;
  tid: string;
  level: string;
  tag: string; // "DOMAIN/Tag" format, e.g. "A03200/testTag"
  message: string;
}

export interface HilogFilter {
  level: string | null;
  keyword: string | null;
}

export interface BundleInfo {
  bundle_name: string;
  code_path: string;
  app_type: "user" | "system" | "vendor" | "product";
}
