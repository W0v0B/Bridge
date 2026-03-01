import { useState, useRef, useEffect, useCallback } from "react";
import { Input, Typography } from "antd";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { useDeviceStore } from "../../store/deviceStore";
import { runShellCommand } from "../../utils/adb";
import { writeToPort } from "../../utils/serial";
import { useSerialData } from "../../hooks/useSerialEvents";
import { QuickCommandsPanel } from "./QuickCommandsPanel";

const { Text } = Typography;

export function ShellPanel() {
  const selectedDeviceId = useDeviceStore((s) => s.selectedDeviceId);
  const devices = useDeviceStore((s) => s.devices);
  const selectedDevice = devices.find((d) => d.id === selectedDeviceId);

  const [output, setOutput] = useState("");
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  const appendOutput = useCallback((text: string) => {
    setOutput((prev) => prev + text);
  }, []);

  // Subscribe to incoming serial data
  const handleSerialData = useCallback(
    (event: { port: string; data: string }) => {
      if (selectedDevice?.type === "serial" && selectedDevice.serial === event.port) {
        setOutput((prev) => prev + event.data);
      }
    },
    [selectedDevice]
  );
  useSerialData(handleSerialData);

  const handleCommand = async () => {
    const cmd = input.trim();
    if (!cmd || !selectedDevice) return;

    setInput("");
    if (selectedDevice.type === "adb") {
      setRunning(true);
      try {
        const result = await runShellCommand(selectedDevice.serial, cmd);
        appendOutput(`$ ${cmd}\n${result}\n`);
      } catch (e) {
        appendOutput(`$ ${cmd}\nError: ${e}\n`);
      } finally {
        setRunning(false);
      }
    } else {
      appendOutput(`> ${cmd}\n`);
      try {
        await writeToPort(selectedDevice.serial, cmd + "\r\n");
      } catch (e) {
        appendOutput(`Error: ${e}\n`);
      }
    }
  };

  if (!selectedDevice) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          color: "#8c8c8c",
        }}
      >
        <Text type="secondary" style={{ fontSize: 16 }}>
          Select a device from the sidebar to start
        </Text>
      </div>
    );
  }

  return (
    <PanelGroup direction="horizontal" style={{ height: "100%" }}>
      <Panel defaultSize={70} minSize={40}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            height: "100%",
            background: "#1e1e1e",
            borderRadius: 6,
            overflow: "hidden",
          }}
        >
          {/* Terminal header */}
          <div
            style={{
              padding: "6px 12px",
              background: "#2d2d2d",
              borderBottom: "1px solid #404040",
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
            <Text style={{ color: "#ccc", fontSize: 12 }}>
              {selectedDevice.type === "adb" ? "adb shell" : "serial"} —{" "}
              {selectedDevice.name}
            </Text>
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
              color: "#d4d4d4",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
            }}
          >
            {output || `Connected to ${selectedDevice.name}\nType a command below.\n`}
          </div>

          {/* Input */}
          <div
            style={{
              padding: "8px 12px",
              borderTop: "1px solid #404040",
              background: "#2d2d2d",
            }}
          >
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPressEnter={handleCommand}
              placeholder={
                selectedDevice.type === "adb"
                  ? "adb shell command..."
                  : "serial command..."
              }
              disabled={running}
              variant="borderless"
              style={{
                fontFamily: "monospace",
                fontSize: 13,
                color: "#d4d4d4",
                background: "transparent",
              }}
              prefix={
                <span style={{ color: "#6a9955", marginRight: 4 }}>
                  {selectedDevice.type === "adb" ? "$" : ">"}
                </span>
              }
            />
          </div>
        </div>
      </Panel>

      <PanelResizeHandle
        style={{
          width: 4,
          background: "#f0f0f0",
          cursor: "col-resize",
        }}
      />

      <Panel defaultSize={30} minSize={20}>
        <QuickCommandsPanel onOutput={appendOutput} />
      </Panel>
    </PanelGroup>
  );
}
