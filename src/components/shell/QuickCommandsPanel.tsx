import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import {
  App, Button, Input, InputNumber, Select, Space, Typography, Tooltip, Divider, Tag,
} from "antd";
import {
  PlusOutlined, PlayCircleOutlined, StopOutlined, FileOutlined, FolderAddOutlined,
} from "@ant-design/icons";
import { open } from "@tauri-apps/plugin-dialog";
import { useCommandStore, type DeviceType } from "../../store/commandStore";
import { useDeviceStore } from "../../store/deviceStore";
import { startShellStream } from "../../utils/adb";
import { startHdcShellStream } from "../../utils/hdc";
import { writeToPort } from "../../utils/serial";
import { runLocalScript, readScriptFile } from "../../utils/script";
import { CommandRow } from "./CommandRow";
import { CommandGroupHeader } from "./CommandGroupHeader";

const { Text } = Typography;

interface QuickCommandsPanelProps {
  onOutput?: (text: string, deviceId?: string) => void;
  onStreamStart?: (deviceId?: string) => void;
}

type DeviceItem = ReturnType<typeof useDeviceStore.getState>["devices"][number];

interface SeqEntry {
  running: boolean;
  interval: number;
  currentLabel: string;
  timeoutId?: ReturnType<typeof setTimeout>;
  index: number;
  device: DeviceItem | null;
}

function getDeviceType(device: DeviceItem | undefined): DeviceType {
  if (!device) return "adb";
  if (device.type === "ohos") return "ohos";
  if (device.type === "serial") return "serial";
  return "adb";
}

export function QuickCommandsPanel({ onOutput, onStreamStart }: QuickCommandsPanelProps) {
  const { message } = App.useApp();
  const commandsByType = useCommandStore((s) => s.commandsByType);
  const groupsByType = useCommandStore((s) => s.groupsByType);
  const addCommand = useCommandStore((s) => s.addCommand);
  const addScript = useCommandStore((s) => s.addScript);
  const removeCommand = useCommandStore((s) => s.removeCommand);
  const setSequenceOrder = useCommandStore((s) => s.setSequenceOrder);
  const addGroup = useCommandStore((s) => s.addGroup);
  const renameGroup = useCommandStore((s) => s.renameGroup);
  const removeGroup = useCommandStore((s) => s.removeGroup);
  const toggleGroupCollapsed = useCommandStore((s) => s.toggleGroupCollapsed);
  const moveCommandToGroup = useCommandStore((s) => s.moveCommandToGroup);
  const selectedDeviceId = useDeviceStore((s) => s.selectedDeviceId);
  const devices = useDeviceStore((s) => s.devices);

  const [newLabel, setNewLabel] = useState("");
  const [newCommand, setNewCommand] = useState("");
  const [newGroupId, setNewGroupId] = useState<string | undefined>(undefined);

  // Per-device sequence state (runs in background independent of selected device)
  const seqMap = useRef<Map<string, SeqEntry>>(new Map());

  // UI state reflects the currently selected device's sequence
  const [seqRunning, setSeqRunning] = useState(false);
  const [seqInterval, setSeqInterval] = useState(2);
  const [seqCurrentLabel, setSeqCurrentLabel] = useState("");

  // Stable refs so the setTimeout callback always gets fresh values
  const onOutputRef = useRef(onOutput);
  onOutputRef.current = onOutput;
  const onStreamStartRef = useRef(onStreamStart);
  onStreamStartRef.current = onStreamStart;
  const selectedDeviceIdRef = useRef(selectedDeviceId);
  selectedDeviceIdRef.current = selectedDeviceId;

  const selectedDevice = devices.find((d) => d.id === selectedDeviceId);
  const deviceType = getDeviceType(selectedDevice);
  const commands = commandsByType[deviceType] ?? [];
  const groups = groupsByType[deviceType] ?? [];

  const getEntry = (deviceId: string): SeqEntry => {
    if (!seqMap.current.has(deviceId)) {
      seqMap.current.set(deviceId, {
        running: false, interval: 2, currentLabel: "", index: 0, device: null,
      });
    }
    return seqMap.current.get(deviceId)!;
  };

  // Sync UI when selected device changes
  useEffect(() => {
    if (!selectedDeviceId) return;
    const entry = getEntry(selectedDeviceId);
    setSeqRunning(entry.running);
    setSeqInterval(entry.interval);
    setSeqCurrentLabel(entry.currentLabel);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDeviceId]);

  const stopSequenceForDevice = useCallback((deviceId: string) => {
    const entry = getEntry(deviceId);
    clearTimeout(entry.timeoutId);
    entry.running = false;
    entry.currentLabel = "";
    entry.timeoutId = undefined;
    if (deviceId === selectedDeviceIdRef.current) {
      setSeqRunning(false);
      setSeqCurrentLabel("");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sendCommand = useCallback(async (
    device: DeviceItem,
    command: string,
    scriptPath?: string,
    echoPrefix?: string,
  ) => {
    if (scriptPath) {
      const isShell = scriptPath.match(/\.sh$/i);
      if (isShell) {
        let contents: string;
        try {
          contents = await readScriptFile(scriptPath);
        } catch (e) {
          onOutputRef.current?.(`> Error reading script: ${e}\n`, device.id);
          return;
        }
        const lines = contents.split(/\r?\n/).filter((l) => l.trim().length > 0);
        onOutputRef.current?.(`${echoPrefix ?? ">"} [sh] ${scriptPath}\n`, device.id);
        onStreamStartRef.current?.(device.id);
        for (const line of lines) {
          if (device.type === "serial") {
            onOutputRef.current?.(`> ${line}\n`, device.id);
            await writeToPort(device.serial, line + "\r\n");
          } else {
            onOutputRef.current?.(`$ ${line}\n`, device.id);
            if (device.type === "adb") await startShellStream(device.serial, line);
            else await startHdcShellStream(device.serial, line);
          }
          await new Promise((r) => setTimeout(r, 200));
        }
      } else {
        onOutputRef.current?.(`${echoPrefix ?? ">"} [script] ${scriptPath}\n`, device.id);
        onStreamStartRef.current?.(device.id);
        await runLocalScript(device.id, scriptPath);
      }
    } else if (device.type === "adb") {
      onOutputRef.current?.(`${echoPrefix ?? "$"} ${command}\n`, device.id);
      onStreamStartRef.current?.(device.id);
      await startShellStream(device.serial, command);
    } else if (device.type === "ohos") {
      onOutputRef.current?.(`${echoPrefix ?? "$"} ${command}\n`, device.id);
      onStreamStartRef.current?.(device.id);
      await startHdcShellStream(device.serial, command);
    } else {
      onOutputRef.current?.(`${echoPrefix ?? ">"} ${command}\n`, device.id);
      await writeToPort(device.serial, command + "\r\n");
    }
  }, []);

  // Stable ref to the step function — avoids stale closure inside setTimeout
  const runNextStepRef = useRef<(deviceId: string) => void>(null!);
  runNextStepRef.current = (deviceId: string) => {
    const entry = getEntry(deviceId);
    if (!entry.running) return;

    const device = entry.device;
    if (!device) { stopSequenceForDevice(deviceId); return; }

    const dt = getDeviceType(device);
    const seqCmds = (useCommandStore.getState().commandsByType[dt] ?? [])
      .filter((c) => c.sequenceOrder && c.sequenceOrder > 0)
      .sort((a, b) => (a.sequenceOrder ?? 0) - (b.sequenceOrder ?? 0));

    if (seqCmds.length === 0) { stopSequenceForDevice(deviceId); return; }

    const cmd = seqCmds[entry.index % seqCmds.length];
    entry.index++;
    entry.currentLabel = cmd.label;

    if (deviceId === selectedDeviceIdRef.current) {
      setSeqCurrentLabel(cmd.label);
    }

    (async () => {
      try {
        await sendCommand(device, cmd.command, cmd.scriptPath);
      } catch (e) {
        const prefix = device.type === "serial" ? ">" : "$";
        onOutputRef.current?.(`${prefix} ${cmd.command}\nError: ${e}\n`, device.id);
      }
    })();

    entry.timeoutId = setTimeout(
      () => runNextStepRef.current(deviceId),
      entry.interval * 1000,
    );
  };

  const stopSequence = useCallback(() => {
    if (selectedDeviceId) stopSequenceForDevice(selectedDeviceId);
  }, [selectedDeviceId, stopSequenceForDevice]);

  const startSequence = useCallback(() => {
    if (!selectedDevice || !selectedDeviceId) {
      message.warning("No device selected");
      return;
    }
    const seqCmds = commands.filter((c) => c.sequenceOrder && c.sequenceOrder > 0);
    if (seqCmds.length === 0) {
      message.warning("No commands have a sequence order set");
      return;
    }
    const entry = getEntry(selectedDeviceId);
    clearTimeout(entry.timeoutId);
    entry.device = selectedDevice;
    entry.index = 0;
    entry.running = true;
    entry.currentLabel = "";
    setSeqRunning(true);
    setSeqCurrentLabel("");
    runNextStepRef.current(selectedDeviceId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDevice, selectedDeviceId, commands]);

  const handleIntervalChange = (v: number | null) => {
    const val = v ?? 2;
    setSeqInterval(val);
    if (selectedDeviceId) {
      getEntry(selectedDeviceId).interval = val;
    }
  };

  const handleSend = useCallback(async (command: string, scriptPath?: string) => {
    if (!selectedDevice) {
      message.warning("No device selected");
      return;
    }
    try {
      await sendCommand(selectedDevice, command, scriptPath);
    } catch (e) {
      const prefix = selectedDevice.type === "serial" ? ">" : "$";
      onOutput?.(`${prefix} ${command}\nError: ${e}\n`);
    }
  }, [selectedDevice, onOutput, sendCommand, message]);

  const handleAdd = () => {
    const label = newLabel.trim();
    const cmd = newCommand.trim();
    if (!label || !cmd) return;
    addCommand(deviceType, label, cmd, newGroupId);
    setNewLabel("");
    setNewCommand("");
  };

  const handleAddScript = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Scripts", extensions: ["bat", "cmd", "ps1", "sh"] }],
    });
    if (!selected) return;
    const path = typeof selected === "string" ? selected : selected;
    const filename = path.split(/[\\/]/).pop() ?? path;
    const label = filename.replace(/\.[^.]+$/, "");
    addScript(deviceType, label, path, newGroupId);
  };

  const handleAddGroup = () => {
    const id = addGroup(deviceType, "New Group");
    setNewGroupId(id);
  };

  const handleAddToGroup = (groupId: string) => {
    setNewGroupId(groupId);
  };

  const typeLabel = deviceType === "adb" ? "ADB" : deviceType === "ohos" ? "OHOS" : "Serial";
  const ungroupedCommands = useMemo(() => commands.filter((c) => !c.groupId), [commands]);
  const sortedGroups = useMemo(() => [...groups].sort((a, b) => a.sortOrder - b.sortOrder), [groups]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <Text strong>Quick Commands</Text>
        <Tag color={deviceType === "adb" ? "blue" : deviceType === "ohos" ? "green" : "orange"}>
          {typeLabel}
        </Tag>
      </div>

      {/* Directory view */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {/* Ungrouped commands */}
        {ungroupedCommands.map((cmd) => (
          <CommandRow
            key={cmd.id}
            cmd={cmd}
            groups={groups}
            onSend={handleSend}
            onDelete={() => removeCommand(deviceType, cmd.id)}
            onSetSequenceOrder={(order) => setSequenceOrder(deviceType, cmd.id, order)}
            onMove={(gid) => moveCommandToGroup(deviceType, cmd.id, gid)}
          />
        ))}

        {/* Groups */}
        {sortedGroups.map((group) => {
          const groupCommands = commands.filter((c) => c.groupId === group.id);
          return (
            <div key={group.id}>
              <CommandGroupHeader
                group={group}
                commandCount={groupCommands.length}
                onToggleCollapse={() => toggleGroupCollapsed(deviceType, group.id)}
                onRename={(label) => renameGroup(deviceType, group.id, label)}
                onDelete={() => removeGroup(deviceType, group.id)}
                onAddCommand={() => handleAddToGroup(group.id)}
              />
              {!group.collapsed && groupCommands.map((cmd) => (
                <CommandRow
                  key={cmd.id}
                  cmd={cmd}
                  groups={groups}
                  indented
                  onSend={handleSend}
                  onDelete={() => removeCommand(deviceType, cmd.id)}
                  onSetSequenceOrder={(order) => setSequenceOrder(deviceType, cmd.id, order)}
                  onMove={(gid) => moveCommandToGroup(deviceType, cmd.id, gid)}
                />
              ))}
            </div>
          );
        })}

        {/* New Group button */}
        <div style={{ marginTop: 6 }}>
          <Tooltip title="Create a new group">
            <Button
              size="small"
              icon={<FolderAddOutlined />}
              onClick={handleAddGroup}
              style={{ fontSize: 11, height: 24 }}
            >
              New Group
            </Button>
          </Tooltip>
        </div>
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
              onChange={handleIntervalChange}
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

      {/* Add command / script form */}
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
        <Space direction="vertical" style={{ width: "100%" }} size={4}>
          <Input size="small" placeholder="Label" value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)} />
          <Input size="small" placeholder="Command" value={newCommand}
            onChange={(e) => setNewCommand(e.target.value)} onPressEnter={handleAdd} />
          <Select
            size="small"
            allowClear
            placeholder="Group (optional)"
            value={newGroupId}
            onChange={(v) => setNewGroupId(v)}
            style={{ width: "100%" }}
            options={groups.map((g) => ({ value: g.id, label: g.label }))}
          />
          <Space style={{ width: "100%" }} size={4}>
            <Button size="small" icon={<PlusOutlined />} onClick={handleAdd} style={{ flex: 1 }}>
              Add Command
            </Button>
            <Tooltip title="Add a local script (.bat, .cmd, .ps1, .sh)">
              <Button size="small" icon={<FileOutlined />} onClick={handleAddScript}>
                Add Script
              </Button>
            </Tooltip>
          </Space>
        </Space>
      </div>
    </div>
  );
}
