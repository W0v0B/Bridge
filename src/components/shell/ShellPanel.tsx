import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { App, Input, Button, InputNumber, Tooltip, Typography } from "antd";
import {
  StopOutlined, ClearOutlined, SettingOutlined,
  DownloadOutlined, FileAddOutlined,
  DoubleRightOutlined, DoubleLeftOutlined, LoadingOutlined, VerticalAlignBottomOutlined,
} from "@ant-design/icons";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import "xterm/css/xterm.css";
import { save } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { writeTextFileTo, appendTextToFile, closeLogFile } from "../../utils/fs";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { useDeviceStore } from "../../store/deviceStore";
import { useConfigStore } from "../../store/configStore";
import { startShellStream, stopShellStream } from "../../utils/adb";
import { stopLocalScript, sendScriptInput } from "../../utils/script";
import { startHdcShellStream, stopHdcShellStream } from "../../utils/hdc";
import { writeToPort } from "../../utils/serial";
import { useSerialData } from "../../hooks/useSerialEvents";
import { useShellOutput, useShellExit } from "../../hooks/useShellEvents";
import { useHdcShellOutput, useHdcShellExit } from "../../hooks/useHdcEvents";
import { QuickCommandsPanel } from "./QuickCommandsPanel";

const { Text } = Typography;

interface RawChunk {
  text: string;
  lineCount: number;
}

interface TermEntry {
  terminal: Terminal;
  fitAddon: FitAddon;
  div: HTMLDivElement;
  resizeObserver: ResizeObserver;
}

function countNewlines(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++;
  return n;
}

const XTERM_THEME = {
  background: "#0d1117",
  foreground: "#d9d9d9",
  cursor: "#52c41a",
  cursorAccent: "#0d1117",
  black: "#4d4d4d",
  red: "#ff4d4f",
  green: "#52c41a",
  yellow: "#faad14",
  blue: "#1677ff",
  magenta: "#b37feb",
  cyan: "#13c2c2",
  white: "#d9d9d9",
  brightBlack: "#8c8c8c",
  brightRed: "#ff7875",
  brightGreen: "#95de64",
  brightYellow: "#ffd666",
  brightBlue: "#69b1ff",
  brightMagenta: "#d3adf7",
  brightCyan: "#5cdbd3",
  brightWhite: "#ffffff",
};

export function ShellPanel() {
  const { message } = App.useApp();
  const selectedDeviceId = useDeviceStore((s) => s.selectedDeviceId);
  const devices = useDeviceStore((s) => s.devices);
  const selectedDevice = devices.find((d) => d.id === selectedDeviceId);
  const shellMaxLines = useConfigStore((s) => s.config.shellMaxLines);
  const setConfig = useConfigStore((s) => s.setConfig);

  // Raw text chunk ring-buffer — kept for export and terminal replay on first selection
  const rawChunksMap = useRef<Record<string, RawChunk[]>>({});
  const rawTotalLinesMap = useRef<Record<string, number>>({});
  const inputMap = useRef<Record<string, string>>({});
  const runningMap = useRef<Record<string, boolean>>({});
  const logFileMap = useRef<Record<string, string | null>>({});
  const stoppingMap = useRef<Record<string, boolean>>({});

  // xterm terminal instances, one per device (created lazily on first selection)
  const termMapRef = useRef(new Map<string, TermEntry>());
  const termContainerRef = useRef<HTMLDivElement>(null);

  const disposeTerm = useCallback((id: string) => {
    const entry = termMapRef.current.get(id);
    if (!entry) return;
    entry.resizeObserver.disconnect();
    entry.terminal.dispose();
    entry.div.remove();
    termMapRef.current.delete(id);
  }, []);

  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const autoScrollRef = useRef(true);
  const [showSettings, setShowSettings] = useState(false);
  const [logToFile, setLogToFile] = useState(false);
  const [quickCmdCollapsed, setQuickCmdCollapsed] = useState(false);

  const maxLinesRef = useRef(shellMaxLines);
  maxLinesRef.current = shellMaxLines;

  // Stable refs for use inside callbacks without stale closures
  const selectedDeviceIdRef = useRef(selectedDeviceId);
  selectedDeviceIdRef.current = selectedDeviceId;
  const selectedDeviceRef = useRef(selectedDevice);
  selectedDeviceRef.current = selectedDevice;

  // O(1) device lookup by "type:serial" key
  const deviceByKey = useMemo(() => {
    const m = new Map<string, typeof devices[number]>();
    for (const d of devices) m.set(`${d.type}:${d.serial}`, d);
    return m;
  }, [devices]);
  const deviceByKeyRef = useRef(deviceByKey);
  deviceByKeyRef.current = deviceByKey;

  // Clean up per-device refs when devices are removed (dispose terminals, free memory)
  const prevDeviceIds = useRef(new Set<string>());
  useEffect(() => {
    const currentIds = new Set(devices.map((d) => d.id));
    for (const id of prevDeviceIds.current) {
      if (!currentIds.has(id)) {
        delete rawChunksMap.current[id];
        delete rawTotalLinesMap.current[id];
        delete inputMap.current[id];
        delete runningMap.current[id];
        delete logFileMap.current[id];
        delete stoppingMap.current[id];
        disposeTerm(id);
      }
    }
    prevDeviceIds.current = currentIds;
  }, [devices]);

  // Update scrollback on all terminals when shellMaxLines changes
  useEffect(() => {
    const scrollback = shellMaxLines > 0 ? shellMaxLines : 50000;
    for (const { terminal } of termMapRef.current.values()) {
      terminal.options.scrollback = scrollback;
    }
  }, [shellMaxLines]);

  /** Get or create the xterm Terminal for a device. Replays buffered raw text on first creation. */
  const getOrCreateTerm = useCallback((deviceId: string): TermEntry | null => {
    if (!termContainerRef.current) return null;
    const existing = termMapRef.current.get(deviceId);
    if (existing) return existing;

    // Absolute positioning avoids height:100% not resolving in flex containers.
    const div = document.createElement("div");
    div.style.cssText = "position:absolute;inset:0;padding:6px 8px;box-sizing:border-box;display:none;";

    // Separate mount point so fitAddon measures size excluding outer padding.
    const innerDiv = document.createElement("div");
    innerDiv.style.cssText = "width:100%;height:100%;";
    div.appendChild(innerDiv);
    termContainerRef.current.appendChild(div);

    const scrollback = maxLinesRef.current > 0 ? maxLinesRef.current : 50000;
    const terminal = new Terminal({
      theme: XTERM_THEME,
      scrollback,
      convertEol: true,
      fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace",
      fontSize: 13,
      lineHeight: 1.5,
      cursorBlink: false,
      cursorStyle: "bar",
      disableStdin: true,
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(innerDiv);

    // Per-terminal observer — avoids the race of a global observer that depends
    // on termContainerRef existing at first-mount time.
    const resizeObserver = new ResizeObserver(() => {
      // Skip hidden terminals (only the active one is display:block)
      if (div.style.display !== "none") fitAddon.fit();
    });
    resizeObserver.observe(innerDiv);

    const buffered = rawChunksMap.current[deviceId] ?? [];
    if (buffered.length > 0) {
      for (const chunk of buffered) terminal.write(chunk.text);
    }

    const entry: TermEntry = { terminal, fitAddon, div, resizeObserver };
    termMapRef.current.set(deviceId, entry);
    return entry;
  }, []);

  // On device switch: hide old terminal, show (or create) new terminal
  useEffect(() => {
    // Hide all terminals first
    for (const { div } of termMapRef.current.values()) {
      div.style.display = "none";
    }
    autoScrollRef.current = true;
    setAutoScroll(true);

    if (selectedDeviceId) {
      setInput(inputMap.current[selectedDeviceId] ?? "");
      setRunning(runningMap.current[selectedDeviceId] ?? false);
      setStopping(stoppingMap.current[selectedDeviceId] ?? false);
      setLogToFile(!!logFileMap.current[selectedDeviceId]);

      const entry = getOrCreateTerm(selectedDeviceId);
      if (entry) {
        entry.div.style.display = "block";
        // Defer to next frame so layout settles before scrolling.
        // ResizeObserver handles fit(); we only need scrollToBottom here.
        requestAnimationFrame(() => {
          if (!termMapRef.current.has(selectedDeviceId)) return; // disposed
          entry.terminal.scrollToBottom();
        });
      }
    }
  }, [selectedDeviceId, getOrCreateTerm]);

  // Dispose all terminals on unmount
  useEffect(() => {
    return () => {
      for (const id of termMapRef.current.keys()) disposeTerm(id);
    };
  }, [disposeTerm]);

  const writeToDeviceBuffer = useCallback((deviceId: string, text: string) => {
    const lineCount = countNewlines(text);
    const max = maxLinesRef.current;

    // Update raw chunk ring-buffer (used for export and terminal replay)
    const rawChunks = (rawChunksMap.current[deviceId] ??= []);
    rawChunks.push({ text, lineCount });
    let rawTotal = (rawTotalLinesMap.current[deviceId] ?? 0) + lineCount;
    if (max > 0 && rawTotal > max) {
      while (rawTotal > max && rawChunks.length > 1) {
        rawTotal -= rawChunks.shift()!.lineCount;
      }
    }
    rawTotalLinesMap.current[deviceId] = rawTotal;

    // Write to xterm terminal if it already exists for this device
    // (it exists once the device has been selected at least once)
    const entry = termMapRef.current.get(deviceId);
    if (entry) {
      entry.terminal.write(text);
      if (autoScrollRef.current && deviceId === selectedDeviceIdRef.current) {
        entry.terminal.scrollToBottom();
      }
    }

    const logPath = logFileMap.current[deviceId];
    if (logPath) {
      appendTextToFile(logPath, text).catch(() => {});
    }
  }, []);

  const appendOutput = useCallback((text: string, deviceId?: string) => {
    const targetId = deviceId ?? selectedDeviceIdRef.current;
    if (!targetId) return;
    writeToDeviceBuffer(targetId, text);
  }, [writeToDeviceBuffer]);

  const setDeviceRunning = useCallback((deviceId: string, value: boolean) => {
    runningMap.current[deviceId] = value;
    if (deviceId === selectedDeviceIdRef.current) {
      setRunning(value);
    }
  }, []);

  // Stable callback refs for event handlers — prevents re-creating Tauri listeners on every render
  const writeToDeviceBufferRef = useRef(writeToDeviceBuffer);
  writeToDeviceBufferRef.current = writeToDeviceBuffer;
  const setDeviceRunningRef = useRef(setDeviceRunning);
  setDeviceRunningRef.current = setDeviceRunning;

  // Serial data events
  const handleSerialData = useCallback(
    (event: { port: string; data: string }) => {
      const device = deviceByKeyRef.current.get(`serial:${event.port}`);
      if (!device) return;
      writeToDeviceBufferRef.current(device.id, event.data);
    },
    []
  );
  useSerialData(handleSerialData);

  // ADB shell output events
  useShellOutput(
    useCallback(
      (event) => {
        const device = deviceByKeyRef.current.get(`adb:${event.serial}`);
        if (!device) return;
        writeToDeviceBufferRef.current(device.id, event.data);
      },
      []
    )
  );

  useShellExit(
    useCallback(
      (event) => {
        const device = deviceByKeyRef.current.get(`adb:${event.serial}`);
        if (!device) return;
        stoppingMap.current[device.id] = false;
        if (selectedDeviceIdRef.current === device.id) setStopping(false);
        writeToDeviceBufferRef.current(device.id, `\n[Process exited with code ${event.code}]\n`);
        setDeviceRunningRef.current(device.id, false);
      },
      []
    )
  );

  // HDC shell output events
  useHdcShellOutput(
    useCallback(
      (event) => {
        const device = deviceByKeyRef.current.get(`ohos:${event.connect_key}`);
        if (!device) return;
        writeToDeviceBufferRef.current(device.id, event.data);
      },
      []
    )
  );

  useHdcShellExit(
    useCallback(
      (event) => {
        const device = deviceByKeyRef.current.get(`ohos:${event.connect_key}`);
        if (!device) return;
        stoppingMap.current[device.id] = false;
        if (selectedDeviceIdRef.current === device.id) setStopping(false);
        writeToDeviceBufferRef.current(device.id, `\n[Process exited with code ${event.code}]\n`);
        setDeviceRunningRef.current(device.id, false);
      },
      []
    )
  );

  // Script output/exit events — registered once, use stable refs to avoid listener churn
  useEffect(() => {
    const unlistenOutput = listen<{ id: string; data: string }>("script_output", (event) => {
      writeToDeviceBufferRef.current(event.payload.id, event.payload.data);
    });
    const unlistenExit = listen<{ id: string; code: number }>("script_exit", (event) => {
      const { id, code } = event.payload;
      stoppingMap.current[id] = false;
      if (selectedDeviceIdRef.current === id) setStopping(false);
      writeToDeviceBufferRef.current(id, `\n[Script exited with code ${code}]\n`);
      setDeviceRunningRef.current(id, false);
    });
    return () => {
      unlistenOutput.then((f) => f());
      unlistenExit.then((f) => f());
    };
  }, []);

  const handleCommand = async () => {
    const cmd = input.trim();
    if (!cmd || !selectedDevice) return;

    setInput("");
    if (selectedDeviceId) inputMap.current[selectedDeviceId] = "";

    if (selectedDevice.type === "adb") {
      appendOutput(`$ ${cmd}\n`);
      setDeviceRunning(selectedDevice.id, true);
      try {
        await startShellStream(selectedDevice.serial, cmd);
      } catch (e) {
        appendOutput(`Error: ${e}\n`);
        setDeviceRunning(selectedDevice.id, false);
      }
    } else if (selectedDevice.type === "ohos") {
      appendOutput(`$ ${cmd}\n`);
      setDeviceRunning(selectedDevice.id, true);
      try {
        await startHdcShellStream(selectedDevice.serial, cmd);
      } catch (e) {
        appendOutput(`Error: ${e}\n`);
        setDeviceRunning(selectedDevice.id, false);
      }
    } else {
      // Serial
      appendOutput(`> ${cmd}\n`);
      try {
        await writeToPort(selectedDevice.serial, cmd + "\r\n");
      } catch (e) {
        appendOutput(`Error: ${e}\n`);
      }
    }
  };

  const handleStop = async () => {
    if (!selectedDevice) return;
    stoppingMap.current[selectedDevice.id] = true;
    setStopping(true);
    if (selectedDevice.type === "adb") {
      await stopShellStream(selectedDevice.serial).catch(() => {});
    } else if (selectedDevice.type === "ohos") {
      await stopHdcShellStream(selectedDevice.serial).catch(() => {});
    }
    await stopLocalScript(selectedDevice.id).catch(() => {});
  };

  const handleClear = () => {
    if (!selectedDeviceId) return;
    rawChunksMap.current[selectedDeviceId] = [];
    rawTotalLinesMap.current[selectedDeviceId] = 0;
    termMapRef.current.get(selectedDeviceId)?.terminal.clear();
  };

  const makeLogFilename = () => {
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const dev = (selectedDevice?.serial ?? "shell").replace(/[^a-zA-Z0-9]/g, "_");
    return `shell_${dev}_${ts}.txt`;
  };

  const handleExportSnapshot = async () => {
    if (!selectedDeviceId) return;
    const content = (rawChunksMap.current[selectedDeviceId] ?? []).map((c) => c.text).join("");
    const path = await save({ defaultPath: makeLogFilename(), filters: [{ name: "Text", extensions: ["txt"] }] });
    if (!path) return;
    try {
      await writeTextFileTo(path, content);
      message.success("Log exported");
    } catch (e) {
      message.error(String(e));
    }
  };

  const handleToggleLogToFile = async () => {
    if (!selectedDeviceId) return;
    if (logToFile) {
      const oldPath = logFileMap.current[selectedDeviceId];
      logFileMap.current[selectedDeviceId] = null;
      setLogToFile(false);
      if (oldPath) closeLogFile(oldPath).catch(() => {});
      return;
    }
    const path = await save({ defaultPath: makeLogFilename(), filters: [{ name: "Text", extensions: ["txt"] }] });
    if (!path) return;
    try {
      await writeTextFileTo(path, "");
      logFileMap.current[selectedDeviceId] = path;
      setLogToFile(true);
      message.success("Logging to file started");
    } catch (e) {
      message.error(String(e));
    }
  };

  const scrollToBottom = useCallback(() => {
    autoScrollRef.current = true;
    setAutoScroll(true);
    if (selectedDeviceId) {
      termMapRef.current.get(selectedDeviceId)?.terminal.scrollToBottom();
    }
  }, [selectedDeviceId]);

  const shellLabel = selectedDevice?.type === "adb"
    ? "adb shell"
    : selectedDevice?.type === "ohos"
    ? "hdc shell"
    : "serial";

  const inputPlaceholder = selectedDevice?.type === "adb"
    ? "adb shell command..."
    : selectedDevice?.type === "ohos"
    ? "hdc shell command..."
    : "serial command...";

  const inputPrefix = selectedDevice?.type === "serial" ? ">" : "$";

  if (!selectedDevice) {
    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-secondary)",
        }}
      >
        <Text type="secondary" style={{ fontSize: 16 }}>
          Select a device from the sidebar to start
        </Text>
      </div>
    );
  }

  return (
    <div style={{ position: "absolute", inset: 0 }}>
    <PanelGroup direction="horizontal" style={{ height: "100%" }} id="shell-panel-group">
      <Panel id="shell-main" order={1} defaultSize={quickCmdCollapsed ? 100 : 70} minSize={40}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            height: "100%",
            background: "var(--term-bg)",
            borderRadius: 6,
            border: "1px solid var(--term-border)",
            overflow: "hidden",
          }}
        >
          {/* Terminal header */}
          <div
            style={{
              padding: "6px 12px",
              background: "var(--term-header-bg)",
              borderBottom: "1px solid var(--term-border)",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#52c41a",
              }}
            />
            <Text style={{ color: "var(--term-text)", fontSize: 12, flex: 1 }}>
              {shellLabel} — {selectedDevice.name}
            </Text>
            {showSettings && (
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <Text style={{ color: "var(--term-text)", fontSize: 11, whiteSpace: "nowrap", opacity: 0.7 }}>
                  Max lines
                </Text>
                <InputNumber
                  size="small"
                  min={0}
                  max={100000}
                  step={1000}
                  value={shellMaxLines}
                  onChange={(v) => setConfig({ shellMaxLines: v ?? 5000 })}
                  style={{ width: 80 }}
                />
                <Text style={{ color: "var(--term-text)", fontSize: 10, opacity: 0.5 }}>0=unlimited</Text>
              </div>
            )}
            <Tooltip title="Export snapshot">
              <Button
                size="small"
                type="text"
                icon={<DownloadOutlined style={{ color: "var(--term-text)", opacity: 0.6 }} />}
                onClick={handleExportSnapshot}
              />
            </Tooltip>
            <Tooltip title={logToFile ? "Stop logging to file" : "Log to file"}>
              <Button
                size="small"
                type="text"
                icon={<FileAddOutlined style={{ color: logToFile ? "#ff4d4f" : "#999" }} />}
                onClick={handleToggleLogToFile}
              />
            </Tooltip>
            <Tooltip title="Settings">
              <Button
                size="small"
                type="text"
                icon={<SettingOutlined style={{ color: showSettings ? "var(--term-prompt)" : "var(--term-text)", opacity: showSettings ? 1 : 0.6 }} />}
                onClick={() => setShowSettings((v) => !v)}
              />
            </Tooltip>
            <Tooltip title="Clear">
              <Button
                size="small"
                type="text"
                icon={<ClearOutlined style={{ color: "var(--term-text)", opacity: 0.6 }} />}
                onClick={handleClear}
              />
            </Tooltip>
            {!autoScroll && (
              <Tooltip title="Scroll to bottom">
                <Button
                  size="small"
                  type="text"
                  icon={<VerticalAlignBottomOutlined style={{ color: "var(--term-text)", opacity: 0.6 }} />}
                  onClick={scrollToBottom}
                />
              </Tooltip>
            )}
          </div>

          {/* xterm.js terminal container — one child div per device, hidden/shown on switch */}
          <div
            ref={termContainerRef}
            style={{
              flex: 1,
              position: "relative",
              overflow: "hidden",
              background: XTERM_THEME.background,
            }}
          />

          {/* Input */}
          <div
            style={{
              padding: "8px 12px",
              borderTop: "1px solid var(--term-border)",
              background: "var(--term-header-bg)",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <Input
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                if (selectedDeviceId) inputMap.current[selectedDeviceId] = e.target.value;
              }}
              onPressEnter={handleCommand}
              placeholder={inputPlaceholder}
              disabled={running}
              variant="borderless"
              style={{
                flex: 1,
                fontFamily: "monospace",
                fontSize: 13,
                color: "var(--term-text)",
                background: "transparent",
              }}
              prefix={
                <span style={{ color: "var(--term-prompt)", marginRight: 4 }}>
                  {inputPrefix}
                </span>
              }
            />
            {running && selectedDevice.type !== "serial" && (
              <Button
                size="small"
                danger
                type="primary"
                icon={stopping ? <LoadingOutlined /> : <StopOutlined />}
                onClick={stopping ? undefined : handleStop}
                style={stopping ? { opacity: 0.65, pointerEvents: "none" } : undefined}
              >
                {stopping ? "Stopping..." : "Stop"}
              </Button>
            )}
            <Tooltip title="Send Enter">
              <Button
                size="small"
                onClick={async () => {
                  if (selectedDevice.type === "serial") {
                    await writeToPort(selectedDevice.serial, "\r\n").catch(() => {});
                  } else {
                    await sendScriptInput(selectedDevice.id, "\n").catch(() => {});
                  }
                }}
                style={{ fontFamily: "monospace" }}
              >
                ↵
              </Button>
            </Tooltip>
            {selectedDevice.type === "serial" && (
              <Tooltip title="Send Ctrl+C (interrupt)">
                <Button
                  size="small"
                  danger
                  onClick={async () => {
                    try {
                      await writeToPort(selectedDevice.serial, "\x03");
                    } catch (e) {
                      appendOutput(`Error sending Ctrl+C: ${e}\n`);
                    }
                  }}
                  style={{ fontFamily: "monospace", fontWeight: 600 }}
                >
                  Ctrl+C
                </Button>
              </Tooltip>
            )}
            <Tooltip title={quickCmdCollapsed ? "Show Quick Commands" : "Hide Quick Commands"}>
              <Button
                size="small"
                type="text"
                icon={quickCmdCollapsed ? <DoubleLeftOutlined /> : <DoubleRightOutlined />}
                style={{ color: "var(--term-text)", opacity: 0.6 }}
                onClick={() => setQuickCmdCollapsed((v) => !v)}
              />
            </Tooltip>
          </div>
        </div>
      </Panel>

      {!quickCmdCollapsed && (
        <>
          <PanelResizeHandle
            style={{
              width: 4,
              background: "var(--border)",
              cursor: "col-resize",
            }}
          />

          <Panel id="shell-quick-cmds" order={2} defaultSize={30} minSize={20}>
            <QuickCommandsPanel
              onOutput={appendOutput}
              onStreamStart={(deviceId) => {
                const id = deviceId ?? selectedDevice?.id;
                if (id) setDeviceRunning(id, true);
              }}
            />
          </Panel>
        </>
      )}
    </PanelGroup>
    </div>
  );
}
