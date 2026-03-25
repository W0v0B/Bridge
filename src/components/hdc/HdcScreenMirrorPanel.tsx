import { useState, useEffect, useCallback, useRef } from "react";
import { App, Button, Slider, Tag, Typography } from "antd";
import {
  PlayCircleOutlined,
  PauseCircleOutlined,
  DesktopOutlined,
} from "@ant-design/icons";
import { useDeviceStore } from "../../store/deviceStore";
import { useHdcScreenMirrorState, useHdcScreenFrame } from "../../hooks/useHdcEvents";
import { startHdcScreenMirror, stopHdcScreenMirror, runHdcShellCommand, OHOS_KEYCODE_MAP } from "../../utils/hdc";
import { RemoteControlPanel } from "../shared/RemoteControlPanel";

const { Text } = Typography;

const INTERVAL_MARKS: Record<number, string> = {
  333: "3fps",
  500: "2fps",
  1000: "1fps",
  2000: "0.5fps",
  5000: "0.2fps",
};

const DEFAULT_INTERVAL_MS = 500;

function loadIntervalMs(): number {
  try {
    const raw = localStorage.getItem("hdc_screen_config");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed.intervalMs === "number") return parsed.intervalMs;
    }
  } catch { /* ignore */ }
  return DEFAULT_INTERVAL_MS;
}

function saveIntervalMs(ms: number) {
  localStorage.setItem("hdc_screen_config", JSON.stringify({ intervalMs: ms }));
}

export function HdcScreenMirrorPanel() {
  const { message } = App.useApp();

  const selectedDeviceId = useDeviceStore((s) => s.selectedDeviceId);
  const allDevices = useDeviceStore((s) => s.devices);
  const connectKey =
    allDevices.find((d) => d.id === selectedDeviceId && d.type === "ohos")?.serial ?? null;

  const { running } = useHdcScreenMirrorState(connectKey);
  const [starting, setStarting] = useState(false);
  const [intervalMs, setIntervalMs] = useState(loadIntervalMs);
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [fps, setFps] = useState(0);
  const fpsCounterRef = useRef(0);

  // Clear starting flag once running
  useEffect(() => {
    if (running) setStarting(false);
  }, [running]);

  // Clear image when stopped or device changes
  useEffect(() => {
    if (!running) setImgSrc(null);
  }, [running, connectKey]);

  // FPS counter: count frames per second
  useEffect(() => {
    if (!running) {
      setFps(0);
      fpsCounterRef.current = 0;
      return;
    }
    const interval = setInterval(() => {
      setFps(fpsCounterRef.current);
      fpsCounterRef.current = 0;
    }, 1000);
    return () => clearInterval(interval);
  }, [running]);

  useHdcScreenFrame(
    connectKey,
    useCallback((data: string) => {
      setImgSrc(`data:image/jpeg;base64,${data}`);
      fpsCounterRef.current += 1;
    }, [])
  );

  const handleStart = useCallback(async () => {
    if (!connectKey) return;
    setStarting(true);
    try {
      await startHdcScreenMirror(connectKey, { intervalMs });
    } catch (err: unknown) {
      setStarting(false);
      message.error(String(err));
    }
  }, [connectKey, intervalMs, message]);

  const handleStop = useCallback(async () => {
    if (!connectKey) return;
    try {
      await stopHdcScreenMirror(connectKey);
    } catch (err: unknown) {
      message.error(String(err));
    }
  }, [connectKey, message]);

  const sendKey = useCallback(async (keyCode: number) => {
    if (!connectKey) return;
    try {
      const ohosCode = OHOS_KEYCODE_MAP[keyCode] ?? keyCode;
      await runHdcShellCommand(connectKey, `uinput -K -d ${ohosCode} -u ${ohosCode}`);
    } catch (err: unknown) {
      message.error(String(err));
    }
  }, [connectKey, message]);

  const remoteDisabled = !connectKey;

  if (!connectKey) {
    return (
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "row", overflow: "hidden" }}>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Text type="secondary">Select an OHOS device to use Screen Mirror</Text>
        </div>
        <RemoteControlPanel disabled={remoteDisabled} onSendKey={sendKey} />
      </div>
    );
  }

  const statusLabel = running
    ? fps > 0
      ? `Running • ${fps} FPS`
      : "Running"
    : starting
    ? "Starting..."
    : "Stopped";

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

        <div style={{ flex: 1, maxWidth: 320, display: "flex", alignItems: "center", gap: 8 }}>
          <Text type="secondary" style={{ flexShrink: 0, fontSize: 12 }}>Interval:</Text>
          <Slider
            style={{ flex: 1 }}
            min={333}
            max={5000}
            step={null}
            marks={INTERVAL_MARKS}
            value={intervalMs}
            onChange={setIntervalMs}
            onChangeComplete={saveIntervalMs}
            disabled={running}
            tooltip={{ formatter: (v) => `${v}ms` }}
          />
        </div>

        <Tag color={running ? "green" : "default"}>{statusLabel}</Tag>
      </div>

      {/* Image + Remote side by side */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "row", overflow: "hidden" }}>
        {/* Image display area */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
          {imgSrc ? (
            <img
              src={imgSrc}
              alt="Screen Mirror"
              style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
            />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              <DesktopOutlined style={{ fontSize: 48, opacity: 0.3 }} />
              <Text type="secondary">
                {running ? "Waiting for first frame..." : "Click \"Start Mirror\" to begin"}
              </Text>
            </div>
          )}
        </div>

        {/* Remote control panel */}
        <div style={{ display: "flex", alignItems: "center" }}>
          <RemoteControlPanel disabled={remoteDisabled} onSendKey={sendKey} />
        </div>
      </div>
    </div>
  );
}
