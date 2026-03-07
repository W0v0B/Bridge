import { useState, useRef, useCallback, useEffect } from "react";
import {
  Button, Input, InputNumber, Space, Typography, message, Tooltip, Divider,
} from "antd";
import {
  DeleteOutlined, SendOutlined, PlusOutlined,
  PlayCircleOutlined, StopOutlined,
} from "@ant-design/icons";
import { useCommandStore } from "../../store/commandStore";
import { useDeviceStore } from "../../store/deviceStore";
import { startShellStream } from "../../utils/adb";
import { writeToPort } from "../../utils/serial";

const { Text } = Typography;

interface QuickCommandsPanelProps {
  onOutput?: (text: string) => void;
  onStreamStart?: () => void;
}

export function QuickCommandsPanel({ onOutput, onStreamStart }: QuickCommandsPanelProps) {
  const commands = useCommandStore((s) => s.commands);
  const addCommand = useCommandStore((s) => s.addCommand);
  const removeCommand = useCommandStore((s) => s.removeCommand);
  const setSequenceOrder = useCommandStore((s) => s.setSequenceOrder);
  const selectedDeviceId = useDeviceStore((s) => s.selectedDeviceId);
  const devices = useDeviceStore((s) => s.devices);

  const [newLabel, setNewLabel] = useState("");
  const [newCommand, setNewCommand] = useState("");
  const [seqRunning, setSeqRunning] = useState(false);
  const [seqInterval, setSeqInterval] = useState(2);
  const [seqCurrentLabel, setSeqCurrentLabel] = useState("");

  const seqTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const seqIndexRef = useRef(0);
  const seqRunningRef = useRef(false);

  const selectedDevice = devices.find((d) => d.id === selectedDeviceId);

  const handleSend = useCallback(async (command: string) => {
    if (!selectedDevice) {
      message.warning("No device selected");
      return;
    }
    try {
      if (selectedDevice.type === "adb") {
        onOutput?.(`$ ${command}\n`);
        onStreamStart?.();
        await startShellStream(selectedDevice.serial, command);
      } else {
        onOutput?.(`> ${command}\n`);
        await writeToPort(selectedDevice.serial, command + "\r\n");
      }
    } catch (e) {
      const prefix = selectedDevice.type === "adb" ? "$" : ">";
      onOutput?.(`${prefix} ${command}\nError: ${e}\n`);
    }
  }, [selectedDevice, onOutput, onStreamStart]);

  const stopSequence = useCallback(() => {
    seqRunningRef.current = false;
    clearTimeout(seqTimeoutRef.current);
    setSeqRunning(false);
    setSeqCurrentLabel("");
  }, []);

  // Stop sequence when device changes
  useEffect(() => { stopSequence(); }, [selectedDeviceId, stopSequence]);

  const runNextStep = useCallback(() => {
    if (!seqRunningRef.current) return;
    const seqCmds = useCommandStore
      .getState()
      .commands.filter((c) => c.sequenceOrder && c.sequenceOrder > 0)
      .sort((a, b) => (a.sequenceOrder ?? 0) - (b.sequenceOrder ?? 0));

    if (seqCmds.length === 0) { stopSequence(); return; }

    const cmd = seqCmds[seqIndexRef.current % seqCmds.length];
    seqIndexRef.current++;
    setSeqCurrentLabel(cmd.label);
    handleSend(cmd.command);
    seqTimeoutRef.current = setTimeout(runNextStep, seqInterval * 1000);
  }, [handleSend, seqInterval, stopSequence]);

  const startSequence = useCallback(() => {
    const seqCmds = commands.filter((c) => c.sequenceOrder && c.sequenceOrder > 0);
    if (seqCmds.length === 0) {
      message.warning("No commands have a sequence order set");
      return;
    }
    seqIndexRef.current = 0;
    seqRunningRef.current = true;
    setSeqRunning(true);
    runNextStep();
  }, [commands, runNextStep]);

  const handleAdd = () => {
    const label = newLabel.trim();
    const cmd = newCommand.trim();
    if (!label || !cmd) return;
    addCommand(label, cmd);
    setNewLabel("");
    setNewCommand("");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: 12 }}>
      <Text strong style={{ marginBottom: 8 }}>Quick Commands</Text>

      {/* Command list */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {commands.map((cmd) => (
          <div
            key={cmd.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 8px",
              marginBottom: 4,
              borderRadius: 6,
              border: "1px solid #f0f0f0",
              background: "#fafafa",
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <Text strong style={{ fontSize: 13, display: "block" }}>{cmd.label}</Text>
              <Text type="secondary" style={{ fontSize: 11, fontFamily: "monospace" }} ellipsis>
                {cmd.command}
              </Text>
            </div>
            <Tooltip title="Sequence order (blank = skip)">
              <InputNumber
                size="small"
                min={1}
                value={cmd.sequenceOrder ?? null}
                onChange={(v) => setSequenceOrder(cmd.id, v ?? undefined)}
                placeholder="#"
                style={{ width: 44 }}
              />
            </Tooltip>
            <Button size="small" type="primary" icon={<SendOutlined />}
              onClick={() => handleSend(cmd.command)} />
            <Button size="small" danger icon={<DeleteOutlined />}
              onClick={() => removeCommand(cmd.id)} />
          </div>
        ))}
      </div>

      {/* Sequence runner */}
      <Divider style={{ margin: "8px 0" }} />
      <div style={{ marginBottom: 8 }}>
        <Text strong style={{ fontSize: 12, display: "block", marginBottom: 6 }}>
          Sequence Runner
        </Text>
        <Space size={6} style={{ width: "100%", flexWrap: "wrap" }}>
          <Space size={4}>
            <Text style={{ fontSize: 12 }}>Interval</Text>
            <InputNumber
              size="small"
              min={0.5}
              max={3600}
              step={0.5}
              value={seqInterval}
              onChange={(v) => setSeqInterval(v ?? 2)}
              disabled={seqRunning}
              style={{ width: 64 }}
            />
            <Text style={{ fontSize: 12 }}>s</Text>
          </Space>
          {seqRunning ? (
            <Button size="small" danger icon={<StopOutlined />} onClick={stopSequence}>
              Stop
            </Button>
          ) : (
            <Button size="small" type="primary" icon={<PlayCircleOutlined />}
              onClick={startSequence}>
              Run
            </Button>
          )}
        </Space>
        {seqRunning && seqCurrentLabel && (
          <Text type="secondary" style={{ fontSize: 11, display: "block", marginTop: 4 }}>
            ▶ {seqCurrentLabel}
          </Text>
        )}
      </div>

      {/* Add command form */}
      <div style={{ borderTop: "1px solid #f0f0f0", paddingTop: 8 }}>
        <Space direction="vertical" style={{ width: "100%" }} size={4}>
          <Input size="small" placeholder="Label" value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)} />
          <Input size="small" placeholder="Command" value={newCommand}
            onChange={(e) => setNewCommand(e.target.value)} onPressEnter={handleAdd} />
          <Button size="small" icon={<PlusOutlined />} onClick={handleAdd} block>
            Add Command
          </Button>
        </Space>
      </div>
    </div>
  );
}
