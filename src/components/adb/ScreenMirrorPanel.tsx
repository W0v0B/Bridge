import { useState, useEffect, useCallback } from "react";
import {
  App,
  Button,
  Switch,
  InputNumber,
  Input,
  Select,
  Collapse,
  Tag,
  Space,
  Tooltip,
  Typography,
} from "antd";
import {
  PlayCircleOutlined,
  PauseCircleOutlined,
  SettingOutlined,
  DesktopOutlined,
} from "@ant-design/icons";
import { open } from "@tauri-apps/plugin-dialog";
import { useDeviceStore } from "../../store/deviceStore";
import { useScrcpyState } from "../../hooks/useAdbEvents";
import { startScrcpy, stopScrcpy, isScrcpyRunning, runShellCommand } from "../../utils/adb";
import { RemoteControlPanel } from "../shared/RemoteControlPanel";
import type { ScrcpyConfig } from "../../types/adb";

const { Text } = Typography;

const DEFAULT_CONFIG: ScrcpyConfig = {
  maxSize: 1024,
  videoBitrate: "8M",
  maxFps: 60,
  stayAwake: false,
  showTouches: false,
  borderless: false,
  alwaysOnTop: false,
  turnScreenOff: false,
  powerOffOnClose: false,
  crop: "",
  lockOrientation: undefined,
  recordPath: "",
  noAudio: false,
  keyboardMode: "",
  mouseMode: "",
};

function loadConfig(): ScrcpyConfig {
  try {
    const raw = localStorage.getItem("scrcpy_config");
    if (raw) return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULT_CONFIG };
}

function saveConfig(config: ScrcpyConfig) {
  localStorage.setItem("scrcpy_config", JSON.stringify(config));
}

export function ScreenMirrorPanel() {
  const { message } = App.useApp();

  const selectedDeviceId = useDeviceStore((s) => s.selectedDeviceId);
  const allDevices = useDeviceStore((s) => s.devices);
  const deviceObj = allDevices.find((d) => d.id === selectedDeviceId && d.type === "adb") ?? null;
  const serial = deviceObj?.serial ?? null;

  const { running, setRunningOptimistic } = useScrcpyState(serial);
  const [starting, setStarting] = useState(false);
  const [config, setConfig] = useState<ScrcpyConfig>(loadConfig);
  const [configVisible, setConfigVisible] = useState(true);
  const [record, setRecord] = useState(false);

  // Sync running state from backend on serial change
  useEffect(() => {
    if (!serial) return;
    isScrcpyRunning(serial).then((r) => {
      setRunningOptimistic(r);
    }).catch(() => {});
  }, [serial, setRunningOptimistic]);

  // Reset starting flag when running state changes
  useEffect(() => {
    if (running) setStarting(false);
  }, [running]);

  const updateConfig = useCallback((partial: Partial<ScrcpyConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...partial };
      saveConfig(next);
      return next;
    });
  }, []);

  const handleStart = useCallback(async () => {
    if (!serial) return;
    setStarting(true);
    try {
      const cfg = { ...config };
      if (!record) cfg.recordPath = "";
      await startScrcpy(serial, cfg);
    } catch (err: unknown) {
      setStarting(false);
      message.error(String(err));
    }
  }, [serial, config, record, message]);

  const handleStop = useCallback(async () => {
    if (!serial) return;
    try {
      await stopScrcpy(serial);
    } catch (err: unknown) {
      message.error(String(err));
    }
  }, [serial, message]);

  const handleBrowseRecord = useCallback(async () => {
    const path = await open({
      title: "Save recording to...",
      filters: [{ name: "Video", extensions: ["mp4", "mkv"] }],
    });
    if (path) {
      updateConfig({ recordPath: path as string });
    }
  }, [updateConfig]);

  const sendKey = useCallback(async (keyCode: number) => {
    if (!serial) return;
    try {
      await runShellCommand(serial, `input keyevent ${keyCode}`);
    } catch (err: unknown) {
      message.error(String(err));
    }
  }, [serial, message]);

  if (!serial) {
    return (
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "row", overflow: "hidden" }}>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Text type="secondary">Select an ADB device to use Screen Mirror</Text>
        </div>
        <div style={{ display: "flex", alignItems: "center" }}>
          <RemoteControlPanel disabled onSendKey={sendKey} />
        </div>
      </div>
    );
  }

  const orientationOptions = [
    { label: "Auto", value: "" },
    { label: "0° (Natural)", value: 0 },
    { label: "90° (CCW)", value: 1 },
    { label: "180°", value: 2 },
    { label: "270° (CW)", value: 3 },
  ];

  const inputModeOptions = [
    { label: "Default", value: "" },
    { label: "uhid", value: "uhid" },
    { label: "sdk", value: "sdk" },
    { label: "aoa", value: "aoa" },
    { label: "disabled", value: "disabled" },
  ];

  const collapseItems = [
    {
      key: "display",
      label: "Display",
      children: (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 16px", alignItems: "center" }}>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>Max Resolution</Text>
            <InputNumber
              style={{ width: "100%" }}
              min={0}
              max={4096}
              step={128}
              value={config.maxSize}
              onChange={(v) => updateConfig({ maxSize: v ?? undefined })}
              placeholder="e.g. 1024"
            />
          </div>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>Max FPS</Text>
            <InputNumber
              style={{ width: "100%" }}
              min={1}
              max={240}
              value={config.maxFps}
              onChange={(v) => updateConfig({ maxFps: v ?? undefined })}
              placeholder="e.g. 60"
            />
          </div>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>Video Bitrate</Text>
            <Input
              value={config.videoBitrate}
              onChange={(e) => updateConfig({ videoBitrate: e.target.value })}
              placeholder="e.g. 8M"
            />
          </div>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>Lock Orientation</Text>
            <Select
              style={{ width: "100%" }}
              value={config.lockOrientation ?? ""}
              onChange={(v) => updateConfig({ lockOrientation: v === "" ? undefined : (v as number) })}
              options={orientationOptions}
            />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <Text type="secondary" style={{ fontSize: 12 }}>Crop (e.g. 1224:1440:0:0)</Text>
            <Input
              value={config.crop}
              onChange={(e) => updateConfig({ crop: e.target.value })}
              placeholder="width:height:x:y"
            />
          </div>
        </div>
      ),
    },
    {
      key: "window",
      label: "Window",
      children: (
        <Space direction="vertical" size={8}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Switch size="small" checked={config.borderless} onChange={(v) => updateConfig({ borderless: v })} />
            <Text>Borderless</Text>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Switch size="small" checked={config.alwaysOnTop} onChange={(v) => updateConfig({ alwaysOnTop: v })} />
            <Text>Always on Top</Text>
          </div>
        </Space>
      ),
    },
    {
      key: "device",
      label: "Device",
      children: (
        <Space direction="vertical" size={8}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Switch size="small" checked={config.stayAwake} onChange={(v) => updateConfig({ stayAwake: v })} />
            <Text>Stay Awake</Text>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Switch size="small" checked={config.showTouches} onChange={(v) => updateConfig({ showTouches: v })} />
            <Text>Show Touches</Text>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Switch size="small" checked={config.turnScreenOff} onChange={(v) => updateConfig({ turnScreenOff: v })} />
            <Text>Turn Screen Off</Text>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Switch size="small" checked={config.powerOffOnClose} onChange={(v) => updateConfig({ powerOffOnClose: v })} />
            <Text>Power Off on Close</Text>
          </div>
        </Space>
      ),
    },
    {
      key: "input",
      label: "Input",
      children: (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 16px", alignItems: "center" }}>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>Keyboard</Text>
            <Select
              style={{ width: "100%" }}
              value={config.keyboardMode ?? ""}
              onChange={(v) => updateConfig({ keyboardMode: v || "" })}
              options={inputModeOptions}
            />
          </div>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>Mouse</Text>
            <Select
              style={{ width: "100%" }}
              value={config.mouseMode ?? ""}
              onChange={(v) => updateConfig({ mouseMode: v || "" })}
              options={inputModeOptions}
            />
          </div>
          <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 8 }}>
            <Switch size="small" checked={config.noAudio} onChange={(v) => updateConfig({ noAudio: v })} />
            <Text>Disable Audio</Text>
          </div>
        </div>
      ),
    },
    {
      key: "recording",
      label: "Recording",
      children: (
        <Space direction="vertical" size={8} style={{ width: "100%" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Switch size="small" checked={record} onChange={setRecord} />
            <Text>Record</Text>
          </div>
          {record && (
            <div style={{ display: "flex", gap: 8 }}>
              <Input
                style={{ flex: 1 }}
                value={config.recordPath}
                onChange={(e) => updateConfig({ recordPath: e.target.value })}
                placeholder="Recording file path"
                readOnly
              />
              <Button onClick={handleBrowseRecord}>Browse...</Button>
            </div>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "0 0 12px 0", flexShrink: 0 }}>
        {running ? (
          <Button
            type="primary"
            danger
            icon={<PauseCircleOutlined />}
            onClick={handleStop}
          >
            Stop Mirror
          </Button>
        ) : (
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            loading={starting}
            onClick={handleStart}
          >
            Start Mirror
          </Button>
        )}
        <Tooltip title="Toggle settings panel">
          <Button
            icon={<SettingOutlined />}
            type={configVisible ? "default" : "text"}
            onClick={() => setConfigVisible((v) => !v)}
          />
        </Tooltip>
        <Tag color={running ? "green" : "default"}>
          {running ? "Running" : starting ? "Starting..." : "Stopped"}
        </Tag>
      </div>

      {/* Settings + Remote side by side */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "row", overflow: "hidden" }}>
        {/* Settings / placeholder */}
        <div style={{ flex: 1, minWidth: 0, overflow: "auto" }}>
          {configVisible && (
            <Collapse
              items={collapseItems}
              defaultActiveKey={["display"]}
              size="small"
              bordered={false}
            />
          )}
          {!configVisible && (
            <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8 }}>
              <DesktopOutlined style={{ fontSize: 48, opacity: 0.3 }} />
              <Text type="secondary">Click "Start Mirror" to launch scrcpy</Text>
            </div>
          )}
        </div>

        {/* Remote control panel */}
        <div style={{ display: "flex", alignItems: "center" }}>
          <RemoteControlPanel disabled={!serial} onSendKey={sendKey} />
        </div>
      </div>
    </div>
  );
}
