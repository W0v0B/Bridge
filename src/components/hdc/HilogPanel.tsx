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
import { useHilogEvents, useHdcTlogcatEvents } from "../../hooks/useHdcEvents";
import { startHilog, stopHilog, startHdcTlogcat, stopHdcTlogcat, clearHilog, exportHilog } from "../../utils/hdc";
import type { HilogEntry, HilogFilter, HilogBatch } from "../../types/hdc";

const levelClassMap: Record<string, string> = {
  D: "log-d",
  I: "log-i",
  W: "log-w",
  E: "log-e",
  F: "log-e",
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatEntry(e: HilogEntry): string {
  const cls = levelClassMap[e.level] || "log-i";
  const ts = e.timestamp ? e.timestamp + " " : "";
  const pid = e.pid ? e.pid + " " : "";
  const tid = e.tid ? e.tid + " " : "";
  return `<div class="${cls}">${ts}${pid}${tid}<b>${e.level}/${esc(e.tag)}:</b> ${esc(e.message)}</div>`;
}

interface ModeBuffer {
  entries: HilogEntry[];
  html: string;
}

export function HilogPanel() {
  const { message } = App.useApp();
  const selectedDeviceId = useDeviceStore((s) => s.selectedDeviceId);
  const allDevices = useDeviceStore((s) => s.devices);
  const selectedDevice =
    allDevices.find((d) => d.id === selectedDeviceId && d.type === "ohos")?.serial ?? null;

  const logcatMaxLines = useConfigStore((s) => s.config.logcatMaxLines);
  const setConfig = useConfigStore((s) => s.setConfig);

  const [mode, setMode] = useState<"hilog" | "tlogcat">("hilog");
  // Per-device-per-mode running state: "connect_key:mode" → boolean
  const [runningMap, setRunningMap] = useState<Record<string, boolean>>({});
  const runningMapRef = useRef<Record<string, boolean>>({});
  const runningKey = selectedDevice ? `${selectedDevice}:${mode}` : mode;
  const running = runningMap[runningKey] ?? false;

  const setModeRunning = (m: string, val: boolean, key?: string) => {
    const rk = key ? `${key}:${m}` : m;
    runningMapRef.current = { ...runningMapRef.current, [rk]: val };
    setRunningMap({ ...runningMapRef.current });
  };

  const [level, setLevel] = useState<string>("All");
  const [filterText, setFilterText] = useState("");
  const [useRegex, setUseRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [exactMatch, setExactMatch] = useState(false);
  const [entryCount, setEntryCount] = useState(0);
  const [autoScroll, setAutoScroll] = useState(true);

  // Per-device-per-mode log buffers
  const buffers = useRef<Record<string, ModeBuffer>>({});
  const selectedDeviceRef = useRef(selectedDevice);
  selectedDeviceRef.current = selectedDevice;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const getOrCreateBuffer = useCallback((key: string, m: string): ModeBuffer => {
    const bk = `${key}:${m}`;
    if (!buffers.current[bk]) {
      buffers.current[bk] = { entries: [], html: "" };
    }
    return buffers.current[bk];
  }, []);

  const getBuffer = useCallback(() => {
    if (!selectedDevice) return { entries: [], html: "" } as ModeBuffer;
    return getOrCreateBuffer(selectedDevice, mode);
  }, [selectedDevice, mode, getOrCreateBuffer]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const maxLinesRef = useRef(logcatMaxLines);
  maxLinesRef.current = logcatMaxLines;

  const rafId = useRef(0);
  const pendingFlush = useRef(false);
  const domStale = useRef(false);

  const flushToDOM = useCallback(() => {
    const key = selectedDeviceRef.current;
    if (!key) return;
    const bk = `${key}:${modeRef.current}`;
    const buf = buffers.current[bk];
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

  const scheduleFlush = useCallback(() => {
    if (!autoScrollRef.current) {
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

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.deltaY < 0) {
      autoScrollRef.current = false;
      setAutoScroll(false);
    }
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    if (atBottom && !autoScrollRef.current) {
      autoScrollRef.current = true;
      setAutoScroll(true);
      if (domStale.current) flushToDOM();
    }
  }, [flushToDOM]);

  const scrollToBottom = useCallback(() => {
    autoScrollRef.current = true;
    setAutoScroll(true);
    if (domStale.current) flushToDOM();
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [flushToDOM]);

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

  const passesFilter = useCallback(
    (e: HilogEntry) => {
      if (level !== "All") {
        const levels = ["D", "I", "W", "E", "F"];
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

  // When filter/mode/device changes, rebuild display
  useEffect(() => {
    if (!selectedDevice) return;
    const bk = `${selectedDevice}:${mode}`;
    const buf = buffers.current[bk];
    if (buf) {
      rebuildHtml(buf);
    }
    flushToDOM();
  }, [level, filterText, useRegex, caseSensitive, exactMatch, mode, selectedDevice, rebuildHtml, flushToDOM]);

  const addEntries = useCallback(
    (connectKey: string, targetMode: "hilog" | "tlogcat", batch: HilogEntry[]) => {
      const max = maxLinesRef.current;
      const bk = `${connectKey}:${targetMode}`;
      if (!buffers.current[bk]) {
        buffers.current[bk] = { entries: [], html: "" };
      }
      const buf = buffers.current[bk];

      buf.entries.push(...batch);
      if (max > 0 && buf.entries.length > max) {
        buf.entries = buf.entries.slice(-max);
      }

      // Only build incremental HTML if this is the currently displayed device+mode
      if (connectKey === selectedDeviceRef.current && targetMode === modeRef.current) {
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

  useHilogEvents(
    useCallback(
      (batch: HilogBatch) => {
        const key = `${batch.connect_key}:hilog`;
        if (runningMapRef.current[key]) addEntries(batch.connect_key, "hilog", batch.entries);
      },
      [addEntries]
    )
  );

  useHdcTlogcatEvents(
    useCallback(
      (batch: HilogBatch) => {
        const key = `${batch.connect_key}:tlogcat`;
        if (runningMapRef.current[key]) addEntries(batch.connect_key, "tlogcat", batch.entries);
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
      if (mode === "hilog") {
        const filter: HilogFilter = {
          level: level === "All" ? null : level,
          keyword: filterText || null,
        };
        await startHilog(selectedDevice, filter);
      } else {
        await startHdcTlogcat(selectedDevice);
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
      if (mode === "hilog") {
        await stopHilog(selectedDevice);
      } else {
        await stopHdcTlogcat(selectedDevice);
      }
    } catch {
      // ignore
    }
  };

  const clearDisplay = () => {
    const buf = getBuffer();
    buf.entries = [];
    buf.html = "";
    if (contentRef.current) contentRef.current.innerHTML = "";
    setEntryCount(0);
  };

  const handleClear = async () => {
    clearDisplay();
    if (selectedDevice && mode === "hilog") {
      try {
        await clearHilog(selectedDevice);
      } catch (e) {
        message.warning(`Could not clear device hilog buffer: ${String(e)}`);
      }
    }
  };

  const handleExport = async () => {
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
      await exportHilog(filtered, path);
      message.success(`Exported ${filtered.length} entries`);
    } catch (e) {
      message.error(String(e));
    }
  };

  const handleModeChange = (val: string) => {
    setMode(val as "hilog" | "tlogcat");
  };

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
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column" }}>
      <style>{`
        .log-d { color: #1677ff; }
        .log-i { color: #52c41a; }
        .log-w { color: #faad14; }
        .log-e { color: #ff4d4f; }
        .hilog-body div { white-space: pre-wrap; font-size: 12px; line-height: 18px; }
        .hilog-body b { font-weight: 600; }
      `}</style>

      {/* Toolbar */}
      <div style={{ marginBottom: 8, flexShrink: 0, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <Segmented
          style={{ background: "var(--card-bg)" }}
          options={[
            {
              label: (
                <span>
                  HiLog{selectedDevice && runningMap[`${selectedDevice}:hilog`] && <span style={{ marginLeft: 4, width: 6, height: 6, borderRadius: "50%", background: "#52c41a", display: "inline-block", verticalAlign: "middle" }} />}
                </span>
              ),
              value: "hilog",
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
            { value: "D", label: "Debug" },
            { value: "I", label: "Info" },
            { value: "W", label: "Warn" },
            { value: "E", label: "Error" },
            { value: "F", label: "Fatal" },
          ]}
        />

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
          <Tooltip title={mode === "hilog" ? "Clear display and device hilog buffer (hilog -r)" : "Clear display"}>
            <Button icon={<ClearOutlined />} onClick={handleClear} />
          </Tooltip>
          <Tooltip title="Export filtered logs">
            <Button icon={<ExportOutlined />} onClick={handleExport} />
          </Tooltip>
          {!autoScroll && (
            <Tooltip title="Scroll to bottom">
              <Button icon={<VerticalAlignBottomOutlined />} onClick={scrollToBottom} type="dashed" />
            </Tooltip>
          )}
        </Space>

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

      {/* Log display */}
      <div
        ref={scrollRef}
        onWheel={handleWheel}
        onScroll={handleScroll}
        className="hilog-body"
        style={{
          flex: 1,
          minHeight: 0,
          background: "var(--card-bg)",
          padding: 8,
          overflow: "auto",
          fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', 'Monaco', monospace",
          borderRadius: 6,
          border: "1px solid var(--border)",
        }}
      >
        <div ref={contentRef} />
      </div>
    </div>
  );
}
