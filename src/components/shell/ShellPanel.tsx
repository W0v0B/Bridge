import { useState, useRef, useEffect, useCallback } from "react";
import { App, Input, Button, InputNumber, Tooltip, Typography } from "antd";
import {
  StopOutlined, ClearOutlined, SettingOutlined,
  DownloadOutlined, FileAddOutlined, BgColorsOutlined,
} from "@ant-design/icons";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFileTo, appendTextToFile } from "../../utils/fs";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { useDeviceStore } from "../../store/deviceStore";
import { useConfigStore } from "../../store/configStore";
import { startShellStream, stopShellStream } from "../../utils/adb";
import { startHdcShellStream, stopHdcShellStream } from "../../utils/hdc";
import { writeToPort } from "../../utils/serial";
import { useSerialData } from "../../hooks/useSerialEvents";
import { useShellOutput, useShellExit } from "../../hooks/useShellEvents";
import { useHdcShellOutput, useHdcShellExit } from "../../hooks/useHdcEvents";
import { QuickCommandsPanel } from "./QuickCommandsPanel";
import { ansiToHtml, stripAnsi } from "../../utils/ansi";

const { Text } = Typography;

export function ShellPanel() {
  const { message } = App.useApp();
  const selectedDeviceId = useDeviceStore((s) => s.selectedDeviceId);
  const devices = useDeviceStore((s) => s.devices);
  const selectedDevice = devices.find((d) => d.id === selectedDeviceId);
  const shellMaxLines = useConfigStore((s) => s.config.shellMaxLines);
  const setConfig = useConfigStore((s) => s.setConfig);

  const outputMap = useRef<Record<string, string>>({});
  const inputMap = useRef<Record<string, string>>({});
  const runningMap = useRef<Record<string, boolean>>({});
  const logFileMap = useRef<Record<string, string | null>>({});

  const [output, setOutput] = useState("");
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [logToFile, setLogToFile] = useState(false);
  const [ansiColor, setAnsiColor] = useState(true);
  const ansiColorMap = useRef<Record<string, boolean>>({});

  const outputRef = useRef<HTMLDivElement>(null);
  const rafId = useRef<number>(0);
  const pendingFlush = useRef(false);
  const maxLinesRef = useRef(shellMaxLines);
  maxLinesRef.current = shellMaxLines;

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

  useEffect(() => {
    if (selectedDeviceId) {
      setOutput(outputMap.current[selectedDeviceId] ?? "");
      setInput(inputMap.current[selectedDeviceId] ?? "");
      setRunning(runningMap.current[selectedDeviceId] ?? false);
      setLogToFile(!!logFileMap.current[selectedDeviceId]);
      setAnsiColor(ansiColorMap.current[selectedDeviceId] ?? true);
    }
  }, [selectedDeviceId]);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  const scheduleFlush = useCallback(() => {
    if (pendingFlush.current) return;
    pendingFlush.current = true;
    rafId.current = requestAnimationFrame(() => {
      pendingFlush.current = false;
      if (selectedDeviceId) {
        setOutput(outputMap.current[selectedDeviceId] ?? "");
      }
    });
  }, [selectedDeviceId]);

  useEffect(() => {
    return () => cancelAnimationFrame(rafId.current);
  }, []);

  const writeToDeviceBuffer = useCallback((deviceId: string, text: string) => {
    outputMap.current[deviceId] = trimToMaxLines(
      (outputMap.current[deviceId] ?? "") + text
    );
    if (deviceId === selectedDeviceId) {
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
        const exitLine = `\n[Process exited with code ${event.code}]\n`;
        writeToDeviceBuffer(device.id, exitLine);
        setDeviceRunning(device.id, false);
      },
      [devices, writeToDeviceBuffer, setDeviceRunning]
    )
  );

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
    try {
      if (selectedDevice.type === "adb") {
        await stopShellStream(selectedDevice.serial);
      } else if (selectedDevice.type === "ohos") {
        await stopHdcShellStream(selectedDevice.serial);
      }
    } catch {
      // Process may have already exited
    }
  };

  const handleClear = () => {
    if (!selectedDeviceId) return;
    outputMap.current[selectedDeviceId] = "";
    setOutput("");
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
    <PanelGroup direction="horizontal" style={{ height: "100%" }}>
      <Panel defaultSize={70} minSize={40}>
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
                  if (selectedDeviceId) ansiColorMap.current[selectedDeviceId] = next;
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
          </div>

          {/* Output area */}
          <div
            ref={outputRef}
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
            {...(ansiColor
              ? { dangerouslySetInnerHTML: { __html: output ? ansiToHtml(output) : `Connected to ${selectedDevice.name}\nType a command below.\n` } }
              : { children: output ? stripAnsi(output) : `Connected to ${selectedDevice.name}\nType a command below.\n` }
            )}
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
            {running && (
              <Button
                size="small"
                danger
                type="primary"
                icon={<StopOutlined />}
                onClick={handleStop}
              >
                Stop
              </Button>
            )}
          </div>
        </div>
      </Panel>

      <PanelResizeHandle
        style={{
          width: 4,
          background: "var(--border)",
          cursor: "col-resize",
        }}
      />

      <Panel defaultSize={30} minSize={20}>
        <QuickCommandsPanel
          onOutput={appendOutput}
          onStreamStart={(deviceId) => {
            const id = deviceId ?? selectedDevice?.id;
            if (id) setDeviceRunning(id, true);
          }}
        />
      </Panel>
    </PanelGroup>
    </div>
  );
}
