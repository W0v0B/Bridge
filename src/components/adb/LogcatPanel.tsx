import { useState, useRef, useCallback, useEffect } from "react";
import { Input, Select, Button, Space, Segmented, message } from "antd";
import {
  PlayCircleOutlined,
  PauseOutlined,
  ClearOutlined,
  ExportOutlined,
} from "@ant-design/icons";
import { save } from "@tauri-apps/plugin-dialog";
import { useDeviceStore } from "../../store/deviceStore";
import { useLogcatEvents, useTlogcatEvents } from "../../hooks/useAdbEvents";
import {
  startLogcat,
  stopLogcat,
  startTlogcat,
  stopTlogcat,
  exportLogs,
} from "../../utils/adb";
import type { LogEntry, LogcatFilter } from "../../types/adb";

const MAX_ENTRIES = 10_000;
const THROTTLE_MS = 100;

const levelColors: Record<string, string> = {
  V: "#8c8c8c",
  D: "#1677ff",
  I: "#52c41a",
  W: "#faad14",
  E: "#ff4d4f",
  F: "#ff4d4f",
};

function LogLine({ entry }: { entry: LogEntry }) {
  const color = levelColors[entry.level] || "#8c8c8c";
  return (
    <div style={{ color, whiteSpace: "pre-wrap", fontSize: 12, lineHeight: "18px" }}>
      {entry.timestamp && <span>{entry.timestamp} </span>}
      {entry.pid && <span>{entry.pid} </span>}
      {entry.tid && <span>{entry.tid} </span>}
      <span style={{ fontWeight: "bold" }}>{entry.level}/{entry.tag}: </span>
      <span>{entry.message}</span>
    </div>
  );
}

export function LogcatPanel() {
  const selectedDeviceId = useDeviceStore((s) => s.selectedDeviceId);
  const allDevices = useDeviceStore((s) => s.devices);
  const selectedDevice = allDevices.find((d) => d.id === selectedDeviceId)?.serial ?? null;

  const [mode, setMode] = useState<"logcat" | "tlogcat">("logcat");
  const [running, setRunning] = useState(false);
  const [level, setLevel] = useState<string>("V");
  const [tagFilter, setTagFilter] = useState("");
  const [keyword, setKeyword] = useState("");
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [displayEntries, setDisplayEntries] = useState<LogEntry[]>([]);

  const logContainerRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const pendingRef = useRef<LogEntry[]>([]);
  const throttleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Batch incoming log lines with throttle
  const flushPending = useCallback(() => {
    if (pendingRef.current.length === 0) return;
    setEntries((prev) => {
      const next = [...prev, ...pendingRef.current];
      pendingRef.current = [];
      return next.length > MAX_ENTRIES
        ? next.slice(next.length - MAX_ENTRIES)
        : next;
    });
  }, []);

  const addEntry = useCallback(
    (entry: LogEntry) => {
      pendingRef.current.push(entry);
      if (!throttleTimerRef.current) {
        throttleTimerRef.current = setTimeout(() => {
          throttleTimerRef.current = null;
          flushPending();
        }, THROTTLE_MS);
      }
    },
    [flushPending]
  );

  // Client-side filtering for display
  useEffect(() => {
    const levels = ["V", "D", "I", "W", "E", "F"];
    const minIdx = levels.indexOf(level);
    const tags = tagFilter
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const kw = keyword.toLowerCase();

    const filtered = entries.filter((e) => {
      const eIdx = levels.indexOf(e.level);
      if (eIdx < minIdx) return false;
      if (tags.length > 0 && !tags.some((t) => e.tag.includes(t))) return false;
      if (
        kw &&
        !e.message.toLowerCase().includes(kw) &&
        !e.tag.toLowerCase().includes(kw)
      )
        return false;
      return true;
    });

    setDisplayEntries(filtered);
  }, [entries, level, tagFilter, keyword]);

  // Auto-scroll
  useEffect(() => {
    if (autoScrollRef.current && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [displayEntries]);

  const handleScroll = () => {
    const el = logContainerRef.current;
    if (!el) return;
    autoScrollRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 50;
  };

  // Event subscriptions
  useLogcatEvents(
    useCallback(
      (entry: LogEntry) => {
        if (mode === "logcat" && running) addEntry(entry);
      },
      [mode, running, addEntry]
    )
  );

  useTlogcatEvents(
    useCallback(
      (entry: LogEntry) => {
        if (mode === "tlogcat" && running) addEntry(entry);
      },
      [mode, running, addEntry]
    )
  );

  const handleStart = async () => {
    if (!selectedDevice) {
      message.warning("Select a device first");
      return;
    }
    try {
      if (mode === "logcat") {
        const filter: LogcatFilter = {
          level,
          tags: tagFilter ? tagFilter.split(",").map((t) => t.trim()).filter(Boolean) : null,
          keyword: keyword || null,
        };
        await startLogcat(selectedDevice, filter);
      } else {
        await startTlogcat(selectedDevice);
      }
      setRunning(true);
    } catch (e) {
      message.error(String(e));
    }
  };

  const handleStop = async () => {
    if (!selectedDevice) return;
    try {
      if (mode === "logcat") {
        await stopLogcat(selectedDevice);
      } else {
        await stopTlogcat(selectedDevice);
      }
    } catch {
      // Ignore errors on stop
    }
    setRunning(false);
  };

  const handleClear = () => {
    setEntries([]);
    setDisplayEntries([]);
    pendingRef.current = [];
  };

  const handleExport = async () => {
    const path = await save({
      defaultPath: `${mode}_export.txt`,
      filters: [{ name: "Text", extensions: ["txt"] }],
    });
    if (!path) return;
    try {
      await exportLogs(displayEntries, path);
      message.success("Logs exported");
    } catch (e) {
      message.error(String(e));
    }
  };

  const handleModeChange = async (val: string) => {
    if (running) {
      await handleStop();
    }
    handleClear();
    setMode(val as "logcat" | "tlogcat");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Space style={{ marginBottom: 12 }} wrap>
        <Segmented
          options={[
            { label: "Logcat", value: "logcat" },
            { label: "tlogcat", value: "tlogcat" },
          ]}
          value={mode}
          onChange={handleModeChange}
        />
        <Select
          value={level}
          onChange={setLevel}
          style={{ width: 100 }}
          options={[
            { value: "V", label: "Verbose" },
            { value: "D", label: "Debug" },
            { value: "I", label: "Info" },
            { value: "W", label: "Warn" },
            { value: "E", label: "Error" },
            { value: "F", label: "Fatal" },
          ]}
        />
        <Input
          placeholder="Tags (comma-separated)"
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
          style={{ width: 180 }}
        />
        <Input.Search
          placeholder="Keyword"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          style={{ width: 180 }}
        />
        {running ? (
          <Button icon={<PauseOutlined />} onClick={handleStop} danger>
            Stop
          </Button>
        ) : (
          <Button
            icon={<PlayCircleOutlined />}
            onClick={handleStart}
            type="primary"
          >
            Start
          </Button>
        )}
        <Button icon={<ClearOutlined />} onClick={handleClear}>
          Clear
        </Button>
        <Button icon={<ExportOutlined />} onClick={handleExport}>
          Export
        </Button>
      </Space>

      <div
        ref={logContainerRef}
        onScroll={handleScroll}
        style={{
          flex: 1,
          minHeight: 400,
          background: "#fafafa",
          padding: 8,
          overflow: "auto",
          fontFamily: "'Cascadia Code', 'Consolas', monospace",
          borderRadius: 4,
        }}
      >
        {displayEntries.length === 0 ? (
          <div style={{ color: "#bfbfbf" }}>
            {running
              ? "Waiting for log output..."
              : `Press Start to begin ${mode} streaming`}
          </div>
        ) : (
          displayEntries.map((entry, i) => <LogLine key={i} entry={entry} />)
        )}
      </div>
    </div>
  );
}
