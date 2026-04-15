export interface LogEntry {
  timestamp: string;
  pid: string;
  tid: string;
  level: string;
  tag: string;
  message: string;
}

export interface LogFilter {
  level: string | null;
  keyword: string | null;
  tags?: string[] | null;
}
