import { useState, useRef, useCallback, useEffect, useMemo } from "react";
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
import { useVirtualizer } from "@tanstack/react-virtual";
import { save } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { useConfigStore } from "../../store/configStore";
import type { LogEntry } from "../../types/log";

const ROW_HEIGHT = 18;

const levelClassMap: Record<string, string> = {
  V: "log-v",
  D: "log-d",
  I: "log-i",
  W: "log-w",
  E: "log-e",
  F: "log-e",
};

export interface LogMode {
  label: string;
  value: string;
}

export interface LevelOption {
  value: string;
  label: string;
}

interface BatchPayload {
  entries: LogEntry[];
  [key: string]: unknown;
}

export interface LogPanelConfig {
  modes: LogMode[];
  levels: LevelOption[];
  levelOrder: string[];
  deviceKey: string | null;
  startStream: (key: string, mode: string, filter: { level: string | null; keyword: string | null }) => Promise<void>;
  stopStream: (key: string, mode: string) => Promise<void>;
  clearDevice: (key: string) => Promise<unknown>;
  exportEntries: (entries: LogEntry[], path: string) => Promise<unknown>;
  eventNames: Record<string, string>;
  exitEventName?: string;
  extractDeviceKey: (payload: BatchPayload) => string;
  clearTooltip: (mode: string) => string;
  primaryMode: string;
}

interface ModeBuffer {
  entries: LogEntry[];
  filteredIndices: number[];
}

export function LogPanel({ config }: { config: LogPanelConfig }) {
  const { message } = App.useApp();

  const logcatMaxLines = useConfigStore((s) => s.config.logcatMaxLines);
  const setConfig = useConfigStore((s) => s.setConfig);

  const [mode, setMode] = useState(config.modes[0].value);
  const [runningMap, setRunningMap] = useState<Record<string, boolean>>({});
  const runningMapRef = useRef<Record<string, boolean>>({});
  const runningKey = config.deviceKey ? `${config.deviceKey}:${mode}` : mode;
  const running = runningMap[runningKey] ?? false;

  const setModeRunning = useCallback((m: string, val: boolean, key?: string) => {
    const rk = key ? `${key}:${m}` : m;
    runningMapRef.current = { ...runningMapRef.current, [rk]: val };
    setRunningMap({ ...runningMapRef.current });
  }, []);

  const [level, setLevel] = useState<string>("All");
  const [filterText, setFilterText] = useState("");
  const [useRegex, setUseRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [exactMatch, setExactMatch] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const autoScrollRef = useRef(true);
  // Guards against handleScroll toggling autoScroll off during programmatic scrollToIndex
  const programmaticScrollRef = useRef(false);

  // Per-device-per-mode log buffers
  const buffers = useRef<Record<string, ModeBuffer>>({});
  const deviceKeyRef = useRef(config.deviceKey);
  deviceKeyRef.current = config.deviceKey;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const maxLinesRef = useRef(logcatMaxLines);
  maxLinesRef.current = logcatMaxLines;

  // Microtask-coalesced re-render: multiple tick() calls within the same
  // task collapse into a single state update. Unlike requestAnimationFrame,
  // queueMicrotask fires reliably in Tauri's WebView2.
  const [, setRenderTick] = useState(0);
  const pendingTick = useRef(false);
  const tick = useCallback(() => {
    if (pendingTick.current) return;
    pendingTick.current = true;
    queueMicrotask(() => {
      pendingTick.current = false;
      setRenderTick((n) => n + 1);
    });
  }, []);

  const scrollRef = useRef<HTMLDivElement>(null);
  const entryCountDomRef = useRef<HTMLSpanElement>(null);


  // Cached matcher — rebuilt only when filter settings change, not per-batch
  const matcher = useMemo((): ((text: string) => boolean) | null => {
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
  const matcherRef = useRef(matcher);
  matcherRef.current = matcher;

  // Pre-built level index map — O(1) lookup instead of indexOf per entry
  const levelIndexMap = useMemo(() => {
    const map: Record<string, number> = {};
    config.levelOrder.forEach((l, i) => { map[l] = i; });
    return map;
  }, [config.levelOrder]);
  const minLevelIdx = level === "All" ? -1 : (levelIndexMap[level] ?? 0);
  const minLevelIdxRef = useRef(minLevelIdx);
  minLevelIdxRef.current = minLevelIdx;

  const passesFilter = useCallback(
    (e: LogEntry, m: ((text: string) => boolean) | null, minIdx: number) => {
      if (minIdx >= 0) {
        const eIdx = levelIndexMap[e.level];
        if (eIdx === undefined || eIdx < minIdx) return false;
      }
      if (m) {
        if (!m(e.tag) && !m(e.message)) return false;
      }
      return true;
    },
    [levelIndexMap]
  );


  const getOrCreateBuffer = useCallback((key: string, m: string): ModeBuffer => {
    const bk = `${key}:${m}`;
    if (!buffers.current[bk]) {
      buffers.current[bk] = { entries: [], filteredIndices: [] };
    }
    return buffers.current[bk];
  }, []);

  const currentBuffer = useMemo((): ModeBuffer => {
    if (!config.deviceKey) return { entries: [], filteredIndices: [] };
    return getOrCreateBuffer(config.deviceKey, mode);
  }, [config.deviceKey, mode, getOrCreateBuffer]);

  const rebuildFilteredIndices = useCallback(
    (buf: ModeBuffer) => {
      const indices: number[] = [];
      for (let i = 0; i < buf.entries.length; i++) {
        if (passesFilter(buf.entries[i], matcher, minLevelIdx)) indices.push(i);
      }
      buf.filteredIndices = indices;
    },
    [passesFilter, matcher, minLevelIdx]
  );

  useEffect(() => {
    rebuildFilteredIndices(currentBuffer);
    tick();
    if (entryCountDomRef.current) {
      entryCountDomRef.current.textContent = `${currentBuffer.entries.length} lines`;
    }
  }, [level, filterText, useRegex, caseSensitive, exactMatch, mode, config.deviceKey, currentBuffer, rebuildFilteredIndices, tick]);


  const virtualizer = useVirtualizer({
    count: currentBuffer.filteredIndices.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  });

  // Auto-scroll: when filtered count changes, scroll to end
  const filteredCount = currentBuffer.filteredIndices.length;
  const prevCountRef = useRef(0);
  useEffect(() => {
    if (autoScrollRef.current && filteredCount > 0 && filteredCount !== prevCountRef.current) {
      programmaticScrollRef.current = true;
      virtualizer.scrollToIndex(filteredCount - 1, { align: "end" });
    }
    prevCountRef.current = filteredCount;
  }, [filteredCount, virtualizer]);


  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.deltaY < 0) {
      autoScrollRef.current = false;
      setAutoScroll(false);
    }
  }, []);

  const handleScroll = useCallback(() => {
    if (programmaticScrollRef.current) {
      programmaticScrollRef.current = false;
      return;
    }
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    if (atBottom && !autoScrollRef.current) {
      autoScrollRef.current = true;
      setAutoScroll(true);
    } else if (!atBottom && autoScrollRef.current) {
      autoScrollRef.current = false;
      setAutoScroll(false);
    }
  }, []);

  const scrollToBottom = useCallback(() => {
    autoScrollRef.current = true;
    setAutoScroll(true);
    if (currentBuffer.filteredIndices.length > 0) {
      programmaticScrollRef.current = true;
      virtualizer.scrollToIndex(currentBuffer.filteredIndices.length - 1, { align: "end" });
    }
  }, [currentBuffer, virtualizer]);


  // Ref for addEntries so event listeners always see the latest without re-subscribing
  const addEntriesRef = useRef<(deviceKey: string, targetMode: string, batch: LogEntry[]) => void>(() => {});

  const addEntries = useCallback(
    (deviceKey: string, targetMode: string, batch: LogEntry[]) => {
      const max = maxLinesRef.current;
      const buf = getOrCreateBuffer(deviceKey, targetMode);

      buf.entries.push(...batch);

      if (max > 0 && buf.entries.length > max) {
        const excess = buf.entries.length - max;
        buf.entries = buf.entries.slice(excess);
        const newIndices: number[] = [];
        for (const idx of buf.filteredIndices) {
          const mapped = idx - excess;
          if (mapped >= 0) newIndices.push(mapped);
        }
        buf.filteredIndices = newIndices;
      }

      const m = matcherRef.current;
      const lvlIdx = minLevelIdxRef.current;
      const baseIdx = buf.entries.length - batch.length;
      for (let i = 0; i < batch.length; i++) {
        const entryIdx = baseIdx + i;
        // entryIdx can be negative when batch > maxLines after trim
        if (entryIdx >= 0 && passesFilter(batch[i], m, lvlIdx)) {
          buf.filteredIndices.push(entryIdx);
        }
      }

      const isCurrentView = deviceKey === deviceKeyRef.current && targetMode === modeRef.current;
      if (isCurrentView) {
        if (entryCountDomRef.current) {
          entryCountDomRef.current.textContent = `${buf.entries.length} lines`;
        }
        tick();
      }
    },
    [getOrCreateBuffer, passesFilter, tick]
  );
  addEntriesRef.current = addEntries;

  const onExitRef = useRef<(event: { connect_key: string; mode: string; code: number | null }) => void>(() => {});
  onExitRef.current = (event: { connect_key: string; mode: string; code: number | null }) => {
    const rk = `${event.connect_key}:${event.mode}`;
    if (runningMapRef.current[rk]) {
      setModeRunning(event.mode, false, event.connect_key);
      if (event.code !== 0) {
        message.warning(
          `${event.mode} exited` +
            (event.code !== null ? ` with code ${event.code}` : "") +
            " — the command may not be supported on this device"
        );
      }
    }
  };

  // Single useEffect for all event subscriptions — no hooks in loops/conditionals
  useEffect(() => {
    const unlisteners: Promise<() => void>[] = [];

    for (const m of config.modes) {
      const eventName = config.eventNames[m.value];
      const modeValue = m.value;
      unlisteners.push(
        listen<BatchPayload>(eventName, (event) => {
          const dk = config.extractDeviceKey(event.payload);
          const key = `${dk}:${modeValue}`;
          if (runningMapRef.current[key]) {
            addEntriesRef.current(dk, modeValue, event.payload.entries);
          }
        })
      );
    }

    if (config.exitEventName) {
      unlisteners.push(
        listen<{ connect_key: string; mode: string; code: number | null }>(config.exitEventName, (event) => {
          onExitRef.current(event.payload);
        })
      );
    }

    return () => {
      for (const p of unlisteners) {
        p.then((fn) => fn());
      }
    };
  }, [config.modes, config.eventNames, config.exitEventName, config.extractDeviceKey]);


  const handleStart = async () => {
    if (!config.deviceKey) {
      message.warning("Select a device first");
      return;
    }
    setModeRunning(mode, true, config.deviceKey);
    try {
      await config.startStream(config.deviceKey, mode, {
        level: level === "All" ? null : level,
        keyword: filterText || null,
      });
    } catch (e) {
      setModeRunning(mode, false, config.deviceKey);
      message.error(String(e));
    }
  };

  const handleStop = async () => {
    if (!config.deviceKey) return;
    setModeRunning(mode, false, config.deviceKey);
    try {
      await config.stopStream(config.deviceKey, mode);
    } catch {
      // ignore
    }
  };

  const clearDisplay = () => {
    if (!config.deviceKey) return;
    const buf = getOrCreateBuffer(config.deviceKey, mode);
    buf.entries = [];
    buf.filteredIndices = [];
    if (entryCountDomRef.current) entryCountDomRef.current.textContent = "0 lines";
    tick();
  };

  const handleClear = async () => {
    clearDisplay();
    if (config.deviceKey && mode === config.primaryMode) {
      try {
        await config.clearDevice(config.deviceKey);
      } catch (e) {
        message.warning(`Could not clear device log buffer: ${String(e)}`);
      }
    }
  };

  const handleExport = async () => {
    const buf = currentBuffer;
    const filtered = buf.filteredIndices.map((i) => buf.entries[i]);
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
      await config.exportEntries(filtered, path);
      message.success(`Exported ${filtered.length} entries`);
    } catch (e) {
      message.error(String(e));
    }
  };


  const toggleBtn = (active: boolean): React.CSSProperties => ({
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
    userSelect: "none",
    fontFamily: "monospace",
  });


  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column" }}>
      {/* Toolbar */}
      <div style={{ marginBottom: 8, flexShrink: 0, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <Segmented
          style={{ background: "var(--card-bg)" }}
          options={config.modes.map((m) => ({
            label: (
              <span>
                {m.label}
                {config.deviceKey && runningMap[`${config.deviceKey}:${m.value}`] && (
                  <span style={{ marginLeft: 4, width: 6, height: 6, borderRadius: "50%", background: "#52c41a", display: "inline-block", verticalAlign: "middle" }} />
                )}
              </span>
            ),
            value: m.value,
          }))}
          value={mode}
          onChange={(val) => setMode(val as string)}
        />
        <Select
          value={level}
          onChange={setLevel}
          style={{ width: 100 }}
          options={config.levels}
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
            <Button icon={<PauseOutlined />} onClick={handleStop} danger>Stop</Button>
          ) : (
            <Button icon={<PlayCircleOutlined />} onClick={handleStart} type="primary">Start</Button>
          )}
          <Tooltip title={config.clearTooltip(mode)}>
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
          <span ref={entryCountDomRef} style={{ color: "#999", fontSize: 11, whiteSpace: "nowrap" }}>0 lines</span>
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

      {/* Virtualized log display */}
      <div
        ref={scrollRef}
        onWheel={handleWheel}
        onScroll={handleScroll}
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
        <div style={{ height: virtualizer.getTotalSize(), width: "100%", position: "relative" }}>
          {virtualItems.map((vItem) => {
            const entry = currentBuffer.entries[currentBuffer.filteredIndices[vItem.index]];
            if (!entry) return null;
            const cls = levelClassMap[entry.level] || "log-v";
            return (
              <div
                key={vItem.index}
                className={cls}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: ROW_HEIGHT,
                  transform: `translateY(${vItem.start}px)`,
                  whiteSpace: "pre-wrap",
                  fontSize: 12,
                  lineHeight: `${ROW_HEIGHT}px`,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {entry.timestamp ? entry.timestamp + " " : ""}
                {entry.pid ? entry.pid + " " : ""}
                {entry.tid ? entry.tid + " " : ""}
                <b>{entry.level}/{entry.tag}:</b> {entry.message}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
