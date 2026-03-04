import { useState, useRef, useCallback, useEffect } from "react";
import {
  Input,
  Select,
  Button,
  Space,
  Segmented,
  Tooltip,
  InputNumber,
  message,
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
  exportLogs,
} from "../../utils/adb";
import type { LogEntry, LogcatFilter } from "../../types/adb";

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
  const selectedDeviceId = useDeviceStore((s) => s.selectedDeviceId);
  const allDevices = useDeviceStore((s) => s.devices);
  const selectedDevice =
    allDevices.find((d) => d.id === selectedDeviceId)?.serial ?? null;

  const logcatMaxLines = useConfigStore((s) => s.config.logcatMaxLines);
  const setConfig = useConfigStore((s) => s.setConfig);

  const [mode, setMode] = useState<"logcat" | "tlogcat">("logcat");
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const [level, setLevel] = useState<string>("All");

  // Unified filter
  const [filterText, setFilterText] = useState("");
  const [useRegex, setUseRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [exactMatch, setExactMatch] = useState(false);

  // Per-mode log buffers — survives mode switches
  const buffers = useRef<Record<string, ModeBuffer>>({
    logcat: { entries: [], html: "" },
    tlogcat: { entries: [], html: "" },
  });

  // Active buffer shortcut (always points to current mode's buffer)
  const getBuffer = useCallback(() => buffers.current[mode], [mode]);

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

  /** Write buffer HTML to DOM. Always safe to call. */
  const flushToDOM = useCallback(() => {
    const buf = buffers.current[modeRef.current];
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

  // Add a batch of entries to a specific mode's buffer
  const addEntries = useCallback(
    (targetMode: "logcat" | "tlogcat", batch: LogEntry[]) => {
      const max = maxLinesRef.current;
      const buf = buffers.current[targetMode];

      buf.entries.push(...batch);
      if (max > 0 && buf.entries.length > max) {
        buf.entries = buf.entries.slice(-max);
      }

      // Only build incremental HTML if this is the currently displayed mode
      if (targetMode === modeRef.current) {
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

  // When filter changes, rebuild display HTML from current mode's entries
  useEffect(() => {
    const buf = buffers.current[mode];
    rebuildHtml(buf);
    flushToDOM();
  }, [level, filterText, useRegex, caseSensitive, exactMatch, mode, rebuildHtml, flushToDOM]);

  // Event subscriptions — always accumulate, regardless of which mode is displayed
  useLogcatEvents(
    useCallback(
      (batch: LogEntry[]) => {
        if (runningRef.current) addEntries("logcat", batch);
      },
      [addEntries]
    )
  );

  useTlogcatEvents(
    useCallback(
      (batch: LogEntry[]) => {
        if (runningRef.current) addEntries("tlogcat", batch);
      },
      [addEntries]
    )
  );

  const handleStart = async () => {
    if (!selectedDevice) {
      message.warning("Select a device first");
      return;
    }
    runningRef.current = true;
    setRunning(true);
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
      runningRef.current = false;
      setRunning(false);
      message.error(String(e));
    }
  };

  const handleStop = async () => {
    if (!selectedDevice) return;
    runningRef.current = false;
    setRunning(false);
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

  const handleClear = () => {
    const buf = getBuffer();
    buf.entries = [];
    buf.html = "";
    if (contentRef.current) contentRef.current.innerHTML = "";
    setEntryCount(0);
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

  const handleModeChange = async (val: string) => {
    const newMode = val as "logcat" | "tlogcat";
    if (running) {
      await handleStop();
    }
    // Switch mode — logs are preserved in per-mode buffers
    setMode(newMode);
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
      border: "1px solid " + (active ? "#1677ff" : "#d9d9d9"),
      background: active ? "#e6f4ff" : "transparent",
      color: active ? "#1677ff" : "#8c8c8c",
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
        <div style={{ display: "flex", alignItems: "center", border: "1px solid #d9d9d9", borderRadius: 6, padding: "0 4px", background: "#fff", flex: "1 1 200px", maxWidth: 400, minWidth: 160 }}>
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
          <Button icon={<ClearOutlined />} onClick={handleClear} />
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
          <InputNumber
            size="small"
            min={0}
            max={100000}
            step={1000}
            value={logcatMaxLines}
            onChange={(v) => setConfig({ logcatMaxLines: v ?? 5000 })}
            style={{ width: 110 }}
            addonBefore="Max"
          />
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
          background: "#fafafa",
          padding: 8,
          overflow: "auto",
          fontFamily:
            "'Cascadia Code', 'Fira Code', 'Consolas', 'Monaco', monospace",
          borderRadius: 6,
          border: "1px solid #f0f0f0",
        }}
      >
        <div ref={contentRef} />
      </div>
    </div>
  );
}
