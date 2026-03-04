export interface AdbDevice {
  serial: string;
  state: string;
  model: string;
  product: string;
  transport_id: string;
  is_root: boolean;
  is_remounted: boolean;
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
