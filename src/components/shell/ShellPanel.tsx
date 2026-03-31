import { useState, useRef, useEffect, useCallback } from "react";
import { App, Input, Button, InputNumber, Tooltip, Typography } from "antd";
import {
  StopOutlined, ClearOutlined, SettingOutlined,
  DownloadOutlined, FileAddOutlined, BgColorsOutlined,
  DoubleRightOutlined, DoubleLeftOutlined, LoadingOutlined, VerticalAlignBottomOutlined,
} from "@ant-design/icons";
import { save } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { writeTextFileTo, appendTextToFile } from "../../utils/fs";
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
import { AnsiConverter, stripAnsi } from "../../utils/ansi";

const { Text } = Typography;

interface HtmlChunk {
  html: string;
  lineCount: number;
}

export function ShellPanel() {
  const { message } = App.useApp();
  const selectedDeviceId = useDeviceStore((s) => s.selectedDeviceId);
  const devices = useDeviceStore((s) => s.devices);
  const selectedDevice = devices.find((d) => d.id === selectedDeviceId);
  const shellMaxLines = useConfigStore((s) => s.config.shellMaxLines);
  const setConfig = useConfigStore((s) => s.setConfig);

  // Raw text buffers — kept for export
  const outputMap = useRef<Record<string, string>>({});
  const inputMap = useRef<Record<string, string>>({});
  const runningMap = useRef<Record<string, boolean>>({});
  const logFileMap = useRef<Record<string, string | null>>({});

  // Per-device HTML buffers (bypass React state for output rendering)
  const htmlStringMap = useRef<Record<string, string>>({});
  const htmlChunksMap = useRef<Record<string, HtmlChunk[]>>({});
  const htmlTotalLinesMap = useRef<Record<string, number>>({});
  const converterMap = useRef<Record<string, AnsiConverter>>({});

  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const stoppingMap = useRef<Record<string, boolean>>({});
  const autoScrollRef = useRef(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [logToFile, setLogToFile] = useState(false);
  const [ansiColor, setAnsiColor] = useState(true);
  const [quickCmdCollapsed, setQuickCmdCollapsed] = useState(false);
  const ansiColorMap = useRef<Record<string, boolean>>({});

  const outputRef = useRef<HTMLDivElement>(null);
  const rafId = useRef<number>(0);
  const pendingFlush = useRef(false);
  const domStale = useRef(false);
  const maxLinesRef = useRef(shellMaxLines);
  maxLinesRef.current = shellMaxLines;

  // Stable refs for use inside callbacks without stale closures
  const selectedDeviceIdRef = useRef(selectedDeviceId);
  selectedDeviceIdRef.current = selectedDeviceId;
  const selectedDeviceRef = useRef(selectedDevice);
  selectedDeviceRef.current = selectedDevice;

  const trimToMaxLines = useCallback((text: string): string => {
    const max = maxLinesRef.current;
    if (max <= 0) return text;
    let count = 0;
    let idx = text.length;
    while (idx > 0 && count < max) {
      idx = text.lastIndexOf("\n", idx - 1);
      if (idx === -1) { idx = 0; break; }
      count++;
    }
    return idx > 0 ? text.slice(idx + 1) : text;
  }, []);

  /**
   * Rebuild the HTML string and chunk array for a device from its raw outputMap text.
   * Called on device switch or ansiColor toggle.
   */
  const rebuildHtmlForDevice = useCallback((deviceId: string, useColor: boolean) => {
    const rawText = outputMap.current[deviceId] ?? "";
    const conv = new AnsiConverter();
    converterMap.current[deviceId] = conv;

    if (!rawText || !useColor) {
      htmlChunksMap.current[deviceId] = [];
      htmlTotalLinesMap.current[deviceId] = 0;
      htmlStringMap.current[deviceId] = "";
      return;
    }

    const newHtml = conv.convert(rawText);
    const lineCount = (rawText.match(/\n/g) || []).length;
    htmlChunksMap.current[deviceId] = [{ html: newHtml, lineCount }];
    htmlTotalLinesMap.current[deviceId] = lineCount;
    htmlStringMap.current[deviceId] = newHtml;
  }, []);

  /** Write the current device's HTML (or placeholder) directly to the output DOM element. */
  const flushToDOM = useCallback(() => {
    if (!outputRef.current) return;
    domStale.current = false;
    const deviceId = selectedDeviceIdRef.current;
    const dev = selectedDeviceRef.current;
    if (!deviceId) {
      outputRef.current.textContent = "";
      return;
    }

    const useColor = ansiColorMap.current[deviceId] ?? true;
    if (useColor) {
      const html = htmlStringMap.current[deviceId];
      if (html) {
        outputRef.current.innerHTML = html;
      } else {
        outputRef.current.textContent = dev
          ? `Connected to ${dev.name}\nType a command below.\n`
          : "";
      }
    } else {
      const raw = outputMap.current[deviceId] ?? "";
      outputRef.current.textContent = raw
        ? stripAnsi(raw)
        : (dev ? `Connected to ${dev.name}\nType a command below.\n` : "");
    }

    if (autoScrollRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
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

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.deltaY < 0) {
      autoScrollRef.current = false;
      setAutoScroll(false);
    }
  }, []);

  const handleScroll = useCallback(() => {
    const el = outputRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    if (atBottom) {
      if (!autoScrollRef.current) {
        autoScrollRef.current = true;
        setAutoScroll(true);
        if (domStale.current) {
          if (!pendingFlush.current) {
            pendingFlush.current = true;
            cancelAnimationFrame(rafId.current);
            rafId.current = requestAnimationFrame(() => {
              pendingFlush.current = false;
              flushToDOM();
            });
          }
        }
      }
    } else if (autoScrollRef.current) {
      autoScrollRef.current = false;
      setAutoScroll(false);
    }
  }, [flushToDOM]);

  const scrollToBottom = useCallback(() => {
    autoScrollRef.current = true;
    setAutoScroll(true);
    if (domStale.current) {
      flushToDOM();
    }
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [flushToDOM]);

  useEffect(() => {
    return () => cancelAnimationFrame(rafId.current);
  }, []);

  // On device switch: restore HTML state for the new device
  useEffect(() => {
    if (selectedDeviceId) {
      const useColor = ansiColorMap.current[selectedDeviceId] ?? true;
      // Only rebuild if we don't already have a rendered HTML string
      if (htmlStringMap.current[selectedDeviceId] === undefined) {
        rebuildHtmlForDevice(selectedDeviceId, useColor);
      }
      setInput(inputMap.current[selectedDeviceId] ?? "");
      setRunning(runningMap.current[selectedDeviceId] ?? false);
      setStopping(stoppingMap.current[selectedDeviceId] ?? false);
      setLogToFile(!!logFileMap.current[selectedDeviceId]);
      setAnsiColor(ansiColorMap.current[selectedDeviceId] ?? true);
    }
    autoScrollRef.current = true;
    setAutoScroll(true);
    flushToDOM();
  }, [selectedDeviceId, rebuildHtmlForDevice, flushToDOM]);

  const writeToDeviceBuffer = useCallback((deviceId: string, text: string) => {
    // Update raw text (for export)
    outputMap.current[deviceId] = trimToMaxLines(
      (outputMap.current[deviceId] ?? "") + text
    );

    // Update HTML incrementally for the active device only
    if (deviceId === selectedDeviceId) {
      const useColor = ansiColorMap.current[deviceId] ?? true;

      if (useColor) {
        if (!converterMap.current[deviceId]) {
          converterMap.current[deviceId] = new AnsiConverter();
        }
        const newHtml = converterMap.current[deviceId].convert(text);
        const lineCount = (text.match(/\n/g) || []).length;

        const chunks = (htmlChunksMap.current[deviceId] ??= []);
        chunks.push({ html: newHtml, lineCount });

        let total = (htmlTotalLinesMap.current[deviceId] ?? 0) + lineCount;
        const max = maxLinesRef.current;

        if (max > 0 && total > max) {
          while (total > max && chunks.length > 1) {
            total -= chunks.shift()!.lineCount;
          }
          htmlTotalLinesMap.current[deviceId] = total;
          htmlStringMap.current[deviceId] = chunks.map((c) => c.html).join("");
        } else {
          htmlTotalLinesMap.current[deviceId] = total;
          htmlStringMap.current[deviceId] =
            (htmlStringMap.current[deviceId] ?? "") + newHtml;
        }
      }
      // For !useColor, flushToDOM reads outputMap directly via textContent

      scheduleFlush();
    }

    const logPath = logFileMap.current[deviceId];
    if (logPath) {
      appendTextToFile(logPath, text).catch(() => {});
    }
  }, [selectedDeviceId, scheduleFlush, trimToMaxLines]);

  const appendOutput = useCallback((text: string, deviceId?: string) => {
    const targetId = deviceId ?? selectedDeviceId;
    if (!targetId) return;
    writeToDeviceBuffer(targetId, text);
  }, [selectedDeviceId, writeToDeviceBuffer]);

  const setDeviceRunning = useCallback((deviceId: string, value: boolean) => {
    runningMap.current[deviceId] = value;
    if (deviceId === selectedDeviceId) {
      setRunning(value);
    }
  }, [selectedDeviceId]);

  // Serial data events
  const handleSerialData = useCallback(
    (event: { port: string; data: string }) => {
      const device = devices.find(
        (d) => d.type === "serial" && d.serial === event.port
      );
      if (!device) return;
      writeToDeviceBuffer(device.id, event.data);
    },
    [devices, writeToDeviceBuffer]
  );
  useSerialData(handleSerialData);

  // ADB shell output events
  useShellOutput(
    useCallback(
      (event) => {
        const device = devices.find(
          (d) => d.type === "adb" && d.serial === event.serial
        );
        if (!device) return;
        writeToDeviceBuffer(device.id, event.data);
      },
      [devices, writeToDeviceBuffer]
    )
  );

  useShellExit(
    useCallback(
      (event) => {
        const device = devices.find(
          (d) => d.type === "adb" && d.serial === event.serial
        );
        if (!device) return;
        stoppingMap.current[device.id] = false;
        if (selectedDeviceIdRef.current === device.id) setStopping(false);
        const exitLine = `\n[Process exited with code ${event.code}]\n`;
        writeToDeviceBuffer(device.id, exitLine);
        setDeviceRunning(device.id, false);
      },
      [devices, writeToDeviceBuffer, setDeviceRunning]
    )
  );

  // HDC shell output events
  useHdcShellOutput(
    useCallback(
      (event) => {
        const device = devices.find(
          (d) => d.type === "ohos" && d.serial === event.connect_key
        );
        if (!device) return;
        writeToDeviceBuffer(device.id, event.data);
      },
      [devices, writeToDeviceBuffer]
    )
  );

  useHdcShellExit(
    useCallback(
      (event) => {
        const device = devices.find(
          (d) => d.type === "ohos" && d.serial === event.connect_key
        );
        if (!device) return;
        stoppingMap.current[device.id] = false;
        if (selectedDeviceIdRef.current === device.id) setStopping(false);
        const exitLine = `\n[Process exited with code ${event.code}]\n`;
        writeToDeviceBuffer(device.id, exitLine);
        setDeviceRunning(device.id, false);
      },
      [devices, writeToDeviceBuffer, setDeviceRunning]
    )
  );

  // Script output/exit events
  useEffect(() => {
    const unlistenOutput = listen<{ id: string; data: string }>("script_output", (event) => {
      writeToDeviceBuffer(event.payload.id, event.payload.data);
    });
    const unlistenExit = listen<{ id: string; code: number }>("script_exit", (event) => {
      const { id, code } = event.payload;
      stoppingMap.current[id] = false;
      if (selectedDeviceIdRef.current === id) setStopping(false);
      writeToDeviceBuffer(id, `\n[Script exited with code ${code}]\n`);
      setDeviceRunning(id, false);
    });
    return () => {
      unlistenOutput.then((f) => f());
      unlistenExit.then((f) => f());
    };
  }, [writeToDeviceBuffer, setDeviceRunning]);

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
    // Run shell stream stop and script kill independently so one failure
    // does not prevent the other from being called.
    if (selectedDevice.type === "adb") {
      await stopShellStream(selectedDevice.serial).catch(() => {});
    } else if (selectedDevice.type === "ohos") {
      await stopHdcShellStream(selectedDevice.serial).catch(() => {});
    }
    await stopLocalScript(selectedDevice.id).catch(() => {});
  };

  const handleClear = () => {
    if (!selectedDeviceId) return;
    outputMap.current[selectedDeviceId] = "";
    htmlStringMap.current[selectedDeviceId] = "";
    htmlChunksMap.current[selectedDeviceId] = [];
    htmlTotalLinesMap.current[selectedDeviceId] = 0;
    converterMap.current[selectedDeviceId]?.reset();
    if (outputRef.current) outputRef.current.innerHTML = "";
  };

  const makeLogFilename = () => {
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const dev = (selectedDevice?.serial ?? "shell").replace(/[^a-zA-Z0-9]/g, "_");
    return `shell_${dev}_${ts}.txt`;
  };

  const handleExportSnapshot = async () => {
    if (!selectedDeviceId) return;
    const content = outputMap.current[selectedDeviceId] ?? "";
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
      logFileMap.current[selectedDeviceId] = null;
      setLogToFile(false);
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
            <Tooltip title={ansiColor ? "ANSI colors enabled — click to disable" : "ANSI colors disabled — click to enable"}>
              <Button
                size="small"
                type="text"
                icon={<BgColorsOutlined style={{ color: ansiColor ? "#52c41a" : "#999" }} />}
                onClick={() => {
                  const next = !ansiColor;
                  setAnsiColor(next);
                  if (selectedDeviceId) {
                    ansiColorMap.current[selectedDeviceId] = next;
                    rebuildHtmlForDevice(selectedDeviceId, next);
                    flushToDOM();
                  }
                }}
              />
            </Tooltip>
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

          {/* Output area — content managed directly via ref, no React state */}
          <div
            ref={outputRef}
            className="term-output"
            onWheel={handleWheel}
            onScroll={handleScroll}
            style={{
              flex: 1,
              overflow: "auto",
              padding: 12,
              fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace",
              fontSize: 13,
              lineHeight: 1.5,
              color: "var(--term-text)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
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
