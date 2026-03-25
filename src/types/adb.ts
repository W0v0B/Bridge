export interface AdbDevice {
  serial: string;
  state: string;
  model: string;
  product: string;
  transport_id: string;
  is_root: boolean;
  root_info: string;
  is_remounted: boolean;
  remount_info: string;
}

export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  permissions: string;
  modified: string;
}

export interface TransferProgress {
  id: string;
  file_name: string;
  transferred: number;
  total: number;
  percent: number;
  speed: string;
}

export interface LogEntry {
  timestamp: string;
  pid: string;
  tid: string;
  level: string;
  tag: string;
  message: string;
}

export interface LogcatFilter {
  level: string | null;
  tags: string[] | null;
  keyword: string | null;
}

export interface LogcatBatch {
  serial: string;
  entries: LogEntry[];
}

export interface ScrcpyConfig {
  maxSize?: number;
  videoBitrate?: string;
  maxFps?: number;
  stayAwake?: boolean;
  showTouches?: boolean;
  borderless?: boolean;
  alwaysOnTop?: boolean;
  turnScreenOff?: boolean;
  powerOffOnClose?: boolean;
  crop?: string;
  lockOrientation?: number;
  recordPath?: string;
  noAudio?: boolean;
  keyboardMode?: string;
  mouseMode?: string;
}

export interface ScrcpyState {
  serial: string;
  running: boolean;
}

export interface AdbScreenFrame {
  serial: string;
  data: string; // base64 PNG
}

export interface AdbScreenCaptureState {
  serial: string;
  running: boolean;
}

export interface PackageInfo {
  package_name: string;
  apk_path: string;
  is_system: boolean;
  is_disabled: boolean;
  is_hidden: boolean;
  app_type: "user" | "system" | "vendor" | "product";
}
