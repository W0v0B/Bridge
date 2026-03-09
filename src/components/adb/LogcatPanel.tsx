import { useState, useRef, useCallback, useEffect } from "react";
import {
  App,
  Input,
  Select,
  Button,
  Space,
  Segmented,
  Tooltip,
  InputNumber,
} from "antd";
import {
  PlayCircleOutlined,
  PauseOutlined,
  ClearOutlined,
  ExportOutlined,
  VerticalAlignBottomOutlined,
} from "@ant-design/icons";
import { save } from "@tauri-apps/plugin-dialog";
import { useDeviceStore } from "../../store/deviceStore";
import { useConfigStore } from "../../store/configStore";
import { useLogcatEvents, useTlogcatEvents } from "../../hooks/useAdbEvents";
import {
  startLogcat,
  stopLogcat,
  startTlogcat,
  stopTlogcat,
  clearDeviceLog,
  exportLogs,
} from "../../utils/adb";
import type { LogEntry, LogcatFilter, LogcatBatch } from "../../types/adb";

// CSS class names for log levels
const levelClassMap: Record<string, string> = {
  V: "log-v",
  D: "log-d",
  I: "log-i",
  W: "log-w",
  E: "log-e",
  F: "log-e",
};

/** Escape HTML entities to prevent XSS. */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Format a LogEntry into a single-line HTML string with a color class. */
function formatEntry(e: LogEntry): string {
  const cls = levelClassMap[e.level] || "log-v";
  const ts = e.timestamp ? e.timestamp + " " : "";
  const pid = e.pid ? e.pid + " " : "";
  const tid = e.tid ? e.tid + " " : "";
  return `<div class="${cls}">${ts}${pid}${tid}<b>${e.level}/${esc(e.tag)}:</b> ${esc(e.message)}</div>`;
}

/** Per-mode buffer storing raw entries and pre-built HTML. */
interface ModeBuffer {
  entries: LogEntry[];
  html: string;
}

export function LogcatPanel() {
  const { message } = App.useApp();
  const selectedDeviceId = useDeviceStore((s) => s.selectedDeviceId);
  const allDevices = useDeviceStore((s) => s.devices);
  const selectedDevice =
    allDevices.find((d) => d.id === selectedDeviceId && d.type === "adb")?.serial ?? null;

  const logcatMaxLines = useConfigStore((s) => s.config.logcatMaxLines);
  const setConfig = useConfigStore((s) => s.setConfig);

  const [mode, setMode] = useState<"logcat" | "tlogcat">("logcat");
  // Per-device-per-mode running state: "serial:mode" → boolean
  const [runningMap, setRunningMap] = useState<Record<string, boolean>>({});
  const runningMapRef = useRef<Record<string, boolean>>({});
  const runningKey = selectedDevice ? `${selectedDevice}:${mode}` : mode;
  const running = runningMap[runningKey] ?? false;

  const setModeRunning = (m: string, val: boolean, serial?: string) => {
    const key = serial ? `${serial}:${m}` : m;
    runningMapRef.current = { ...runningMapRef.current, [key]: val };
    setRunningMap({ ...runningMapRef.current });
  };
  const [level, setLevel] = useState<string>("All");

  // Unified filter
  const [filterText, setFilterText] = useState("");
  const [useRegex, setUseRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [exactMatch, setExactMatch] = useState(false);

  // Per-device-per-mode log buffers — keyed by "serial:mode", survives device/mode switches
  const buffers = useRef<Record<string, ModeBuffer>>({});

  const getOrCreateBuffer = useCallback((serial: string, m: string): ModeBuffer => {
    const key = `${serial}:${m}`;
    if (!buffers.current[key]) {
      buffers.current[key] = { entries: [], html: "" };
    }
    return buffers.current[key];
  }, []);

  // Active buffer shortcut (current device + current mode)
  const getBuffer = useCallback(() => {
    if (!selectedDevice) return { entries: [], html: "" } as ModeBuffer;
    return getOrCreateBuffer(selectedDevice, mode);
  }, [selectedDevice, mode, getOrCreateBuffer]);

  const [entryCount, setEntryCount] = useState(0);

  // Scroll container (outer) and content container (inner ref — bypasses React rendering)
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const maxLinesRef = useRef(logcatMaxLines);
  maxLinesRef.current = logcatMaxLines;

  // RAF batching
  const rafId = useRef(0);
  const pendingFlush = useRef(false);
  // Track whether DOM is stale (user was scrolling when new data arrived)
  const domStale = useRef(false);

  const selectedDeviceRef = useRef(selectedDevice);
  selectedDeviceRef.current = selectedDevice;

  /** Write buffer HTML to DOM. Always safe to call. */
  const flushToDOM = useCallback(() => {
    const serial = selectedDeviceRef.current;
    if (!serial) return;
    const key = `${serial}:${modeRef.current}`;
    const buf = buffers.current[key];
    if (!buf) return;
    if (contentRef.current) {
      contentRef.current.innerHTML = buf.html;
    }
    setEntryCount(buf.entries.length);
    domStale.current = false;
    if (autoScrollRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  /**
   * Schedule a DOM flush on the next animation frame.
   * If the user has paused auto-scroll (reading history), we skip DOM
   * updates entirely so innerHTML replacement doesn't fight the scroll.
   * The buffer keeps accumulating — we catch up when auto-scroll resumes.
   */
  const scheduleFlush = useCallback(() => {
    if (!autoScrollRef.current) {
      // Don't touch the DOM while user is scrolling — just mark stale
      domStale.current = true;
      return;
    }
    if (pendingFlush.current) return;
    pendingFlush.current = true;
    rafId.current = requestAnimationFrame(() => {
      pendingFlush.current = false;
      flushToDOM();
    });
  }, [flushToDOM]);

  useEffect(() => {
    return () => cancelAnimationFrame(rafId.current);
  }, []);

  // Detect user scroll-up via wheel event
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.deltaY < 0) {
      autoScrollRef.current = false;
      setAutoScroll(false);
    }
  }, []);

  // Re-enable auto-scroll when user scrolls to bottom
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    if (atBottom && !autoScrollRef.current) {
      autoScrollRef.current = true;
      setAutoScroll(true);
      // Catch up on any data that arrived while user was scrolling
      if (domStale.current) flushToDOM();
    }
  }, [flushToDOM]);

  const scrollToBottom = useCallback(() => {
    autoScrollRef.current = true;
    setAutoScroll(true);
    // Catch up on buffered data, then scroll
    if (domStale.current) flushToDOM();
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [flushToDOM]);

  /** Build a matcher function from the current filter settings. */
  const buildMatcher = useCallback((): ((text: string) => boolean) | null => {
    if (!filterText) return null;

    if (useRegex) {
      try {
        const re = new RegExp(filterText, caseSensitive ? "" : "i");
        return (text: string) => re.test(text);
      } catch {
        return null;
      }
    }

    if (exactMatch) {
      const escaped = filterText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`\\b${escaped}\\b`, caseSensitive ? "" : "i");
      return (text: string) => re.test(text);
    }

    if (caseSensitive) {
      return (text: string) => text.includes(filterText);
    }
    const lower = filterText.toLowerCase();
    return (text: string) => text.toLowerCase().includes(lower);
  }, [filterText, useRegex, caseSensitive, exactMatch]);

  /** Check if an entry passes the current client-side filter. */
  const passesFilter = useCallback(
    (e: LogEntry) => {
      if (level !== "All") {
        const levels = ["V", "D", "I", "W", "E", "F"];
        const minIdx = levels.indexOf(level);
        const eIdx = levels.indexOf(e.level);
        if (eIdx < minIdx) return false;
      }

      const matcher = buildMatcher();
      if (matcher) {
        if (!matcher(e.tag) && !matcher(e.message)) return false;
      }

      return true;
    },
    [level, buildMatcher]
  );

  /** Trim HTML buffer to max lines by stripping leading <div>...</div> entries. */
  const trimHtml = useCallback((html: string): string => {
    const max = maxLinesRef.current;
    if (max <= 0) return html;
    let count = 0;
    let idx = html.length;
    while (count < max) {
      const pos = html.lastIndexOf("</div>", idx - 1);
      if (pos === -1) return html;
      idx = pos;
      count++;
    }
    const startOfDiv = html.lastIndexOf("<div", idx - 1);
    return startOfDiv > 0 ? html.slice(startOfDiv) : html;
  }, []);

  /** Rebuild HTML for a buffer from its entries using the current filter. */
  const rebuildHtml = useCallback(
    (buf: ModeBuffer) => {
      let html = "";
      for (const entry of buf.entries) {
        if (passesFilter(entry)) {
          html += formatEntry(entry);
        }
      }
      buf.html = trimHtml(html);
    },
    [passesFilter, trimHtml]
  );

  // Add a batch of entries to a specific device+mode buffer
  const addEntries = useCallback(
    (serial: string, targetMode: "logcat" | "tlogcat", batch: LogEntry[]) => {
      const max = maxLinesRef.current;
      const key = `${serial}:${targetMode}`;
      if (!buffers.current[key]) {
        buffers.current[key] = { entries: [], html: "" };
      }
      const buf = buffers.current[key];

      buf.entries.push(...batch);
      if (max > 0 && buf.entries.length > max) {
        buf.entries = buf.entries.slice(-max);
      }

      // Only build incremental HTML if this is the currently displayed device+mode
      if (serial === selectedDeviceRef.current && targetMode === modeRef.current) {
        let newHtml = "";
        for (const entry of batch) {
          if (passesFilter(entry)) {
            newHtml += formatEntry(entry);
          }
        }
        if (newHtml) {
          buf.html += newHtml;
          buf.html = trimHtml(buf.html);
          scheduleFlush();
        }
      }
    },
    [passesFilter, scheduleFlush, trimHtml]
  );

  // When filter/mode/device changes, rebuild display HTML from current device+mode entries
  useEffect(() => {
    if (!selectedDevice) return;
    const key = `${selectedDevice}:${mode}`;
    const buf = buffers.current[key];
    if (buf) {
      rebuildHtml(buf);
    }
    flushToDOM();
  }, [level, filterText, useRegex, caseSensitive, exactMatch, mode, selectedDevice, rebuildHtml, flushToDOM]);

  // Event subscriptions — each device+mode checks its own running flag
  useLogcatEvents(
    useCallback(
      (batch: LogcatBatch) => {
        const key = `${batch.serial}:logcat`;
        if (runningMapRef.current[key]) addEntries(batch.serial, "logcat", batch.entries);
      },
      [addEntries]
    )
  );

  useTlogcatEvents(
    useCallback(
      (batch: LogcatBatch) => {
        const key = `${batch.serial}:tlogcat`;
        if (runningMapRef.current[key]) addEntries(batch.serial, "tlogcat", batch.entries);
      },
      [addEntries]
    )
  );

  const handleStart = async () => {
    if (!selectedDevice) {
      message.warning("Select a device first");
      return;
    }
    setModeRunning(mode, true, selectedDevice);
    try {
      if (mode === "logcat") {
        const filter: LogcatFilter = {
          level: level === "All" ? null : level,
          tags: null,
          keyword: filterText || null,
        };
        await startLogcat(selectedDevice, filter);
      } else {
        await startTlogcat(selectedDevice);
      }
    } catch (e) {
      setModeRunning(mode, false, selectedDevice);
      message.error(String(e));
    }
  };

  const handleStop = async () => {
    if (!selectedDevice) return;
    setModeRunning(mode, false, selectedDevice);
    try {
      if (mode === "logcat") {
        await stopLogcat(selectedDevice);
      } else {
        await stopTlogcat(selectedDevice);
      }
    } catch {
      // Ignore errors on stop
    }
  };

  /** Clear the in-app display buffer only. */
  const clearDisplay = () => {
    const buf = getBuffer();
    buf.entries = [];
    buf.html = "";
    if (contentRef.current) contentRef.current.innerHTML = "";
    setEntryCount(0);
  };

  /**
   * Clear both the device's on-device logcat ring buffer (adb logcat -c)
   * and the in-app display buffer. Only applies to logcat mode (not tlogcat).
   */
  const handleClear = async () => {
    clearDisplay();
    if (selectedDevice && mode === "logcat") {
      try {
        await clearDeviceLog(selectedDevice);
      } catch (e) {
        message.warning(`Could not clear device log buffer: ${String(e)}`);
      }
    }
  };

  const handleExport = async () => {
    // Export only entries that pass the current filter
    const filtered = getBuffer().entries.filter(passesFilter);
    if (filtered.length === 0) {
      message.warning("No entries to export (check your filter)");
      return;
    }
    const path = await save({
      defaultPath: `${mode}_export.txt`,
      filters: [{ name: "Text", extensions: ["txt"] }],
    });
    if (!path) return;
    try {
      await exportLogs(filtered, path);
      message.success(`Exported ${filtered.length} entries`);
    } catch (e) {
      message.error(String(e));
    }
  };

  const handleModeChange = (val: string) => {
    // Just switch the displayed mode — each mode runs independently in the background
    setMode(val as "logcat" | "tlogcat");
    // Display will be rebuilt by the filter effect (depends on `mode`)
  };

  /** Toggle button style helper */
  const toggleBtn = (active: boolean) =>
    ({
      padding: "0 6px",
      height: 24,
      fontSize: 12,
      fontWeight: 600,
      lineHeight: "24px",
      border: "1px solid " + (active ? "var(--accent)" : "var(--border)"),
      background: active ? "var(--selected-bg)" : "transparent",
      color: active ? "var(--accent)" : "var(--text-secondary)",
      borderRadius: 3,
      cursor: "pointer",
      userSelect: "none" as const,
      fontFamily: "monospace",
    }) as React.CSSProperties;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Inline styles for log level colors */}
      <style>{`
        .log-v { color: #8c8c8c; }
        .log-d { color: #1677ff; }
        .log-i { color: #52c41a; }
        .log-w { color: #faad14; }
        .log-e { color: #ff4d4f; }
        .logcat-body div { white-space: pre-wrap; font-size: 12px; line-height: 18px; }
        .logcat-body b { font-weight: 600; }
      `}</style>

      {/* Toolbar row */}
      <div style={{ marginBottom: 8, flexShrink: 0, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <Segmented
          style={{ background: "var(--card-bg)" }}
          options={[
            {
              label: (
                <span>
                  Logcat{selectedDevice && runningMap[`${selectedDevice}:logcat`] && <span style={{ marginLeft: 4, width: 6, height: 6, borderRadius: "50%", background: "#52c41a", display: "inline-block", verticalAlign: "middle" }} />}
                </span>
              ),
              value: "logcat",
            },
            {
              label: (
                <span>
                  tlogcat{selectedDevice && runningMap[`${selectedDevice}:tlogcat`] && <span style={{ marginLeft: 4, width: 6, height: 6, borderRadius: "50%", background: "#52c41a", display: "inline-block", verticalAlign: "middle" }} />}
                </span>
              ),
              value: "tlogcat",
            },
          ]}
          value={mode}
          onChange={handleModeChange}
        />
        <Select
          value={level}
          onChange={setLevel}
          style={{ width: 100 }}
          options={[
            { value: "All", label: "All" },
            { value: "V", label: "Verbose" },
            { value: "D", label: "Debug" },
            { value: "I", label: "Info" },
            { value: "W", label: "Warn" },
            { value: "E", label: "Error" },
            { value: "F", label: "Fatal" },
          ]}
        />

        {/* VS Code-style unified filter */}
        <div style={{ display: "flex", alignItems: "center", border: "1px solid var(--border)", borderRadius: 6, padding: "0 4px", background: "var(--card-bg)", flex: "1 1 200px", maxWidth: 400, minWidth: 160 }}>
          <Input
            placeholder="Filter (tag or message)"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            variant="borderless"
            style={{ flex: 1, minWidth: 0 }}
          />
          <Tooltip title="Use Regular Expression">
            <span style={toggleBtn(useRegex)} onClick={() => setUseRegex((v) => !v)}>.*</span>
          </Tooltip>
          <Tooltip title="Match Case">
            <span style={{ ...toggleBtn(caseSensitive), marginLeft: 2 }} onClick={() => setCaseSensitive((v) => !v)}>Aa</span>
          </Tooltip>
          <Tooltip title="Match Whole Word">
            <span style={{ ...toggleBtn(exactMatch), marginLeft: 2 }} onClick={() => setExactMatch((v) => !v)}>ab</span>
          </Tooltip>
        </div>

        <Space size={4}>
          {running ? (
            <Button icon={<PauseOutlined />} onClick={handleStop} danger>
              Stop
            </Button>
          ) : (
            <Button icon={<PlayCircleOutlined />} onClick={handleStart} type="primary">
              Start
            </Button>
          )}
          <Tooltip title={mode === "logcat" ? "Clear display and device log buffer (adb logcat -c)" : "Clear display"}>
            <Button icon={<ClearOutlined />} onClick={handleClear} />
          </Tooltip>
          <Tooltip title="Export filtered logs">
            <Button icon={<ExportOutlined />} onClick={handleExport} />
          </Tooltip>
          {!autoScroll && (
            <Tooltip title="Scroll to bottom">
              <Button
                icon={<VerticalAlignBottomOutlined />}
                onClick={scrollToBottom}
                type="dashed"
              />
            </Tooltip>
          )}
        </Space>

        {/* Max lines — always visible, compact */}
        <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: "auto" }}>
          <span style={{ color: "#999", fontSize: 11, whiteSpace: "nowrap" }}>{entryCount} lines</span>
          <Space.Compact size="small">
            <Input value="Max" disabled style={{ width: 40, textAlign: "center", color: "inherit" }} />
            <InputNumber
              min={0}
              max={100000}
              step={1000}
              value={logcatMaxLines}
              onChange={(v) => setConfig({ logcatMaxLines: v ?? 5000 })}
              style={{ width: 72 }}
            />
          </Space.Compact>
        </div>
      </div>

      {/* Log display — scroll container is stable, inner content div updated via ref */}
      <div
        ref={scrollRef}
        onWheel={handleWheel}
        onScroll={handleScroll}
        className="logcat-body"
        style={{
          flex: 1,
          minHeight: 0,
          background: "var(--card-bg)",
          padding: 8,
          overflow: "auto",
          fontFamily:
            "'Cascadia Code', 'Fira Code', 'Consolas', 'Monaco', monospace",
          borderRadius: 6,
          border: "1px solid var(--border)",
        }}
      >
        <div ref={contentRef} />
      </div>
    </div>
  );
}
