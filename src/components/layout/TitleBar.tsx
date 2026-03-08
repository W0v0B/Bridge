import { useEffect, useState } from "react";
import { Typography } from "antd";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useDeviceStore } from "../../store/deviceStore";

const { Text } = Typography;
const appWindow = getCurrentWindow();

// ── SVG window-control icons (VS Code style) ──────────────────
const MinimizeIcon = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
    <path d="M0 5h10v1H0z" fill="currentColor" />
  </svg>
);

const MaximizeIcon = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
    <path d="M0 0v10h10V0H0zm1 1h8v8H1V1z" fill="currentColor" />
  </svg>
);

const RestoreIcon = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
    <path
      d="M2 0v2H0v8h8V8h2V0H2zm6 7H3V1h5v6zm-2 1v1H1V3h1v5h4z"
      fill="currentColor"
    />
  </svg>
);

const CloseIcon = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
    <path
      d="M1.4 0 0 1.4 3.6 5 0 8.6 1.4 10 5 6.4l3.6 3.6 1.4-1.4L6.4 5 10 1.4 8.6 0 5 3.6z"
      fill="currentColor"
    />
  </svg>
);

// ── Single window-control button ──────────────────────────────
interface WinBtnProps {
  icon: React.ReactNode;
  onClick: () => void;
  isClose?: boolean;
  title?: string;
}

function WinBtn({ icon, onClick, isClose, title }: WinBtnProps) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      title={title}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 46,
        height: "100%",
        border: "none",
        outline: "none",
        background: hovered
          ? isClose
            ? "var(--wc-close-hover)"
            : "var(--wc-hover)"
          : "transparent",
        color: hovered && isClose
          ? "var(--wc-close-hover-text)"
          : "var(--text-secondary)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "default",
        flexShrink: 0,
        transition: "background 0.1s, color 0.1s",
        WebkitAppRegion: "no-drag",
      } as React.CSSProperties}
    >
      {icon}
    </button>
  );
}

// ── TitleBar ──────────────────────────────────────────────────
export function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);

  const selectedDeviceId = useDeviceStore((s) => s.selectedDeviceId);
  const devices = useDeviceStore((s) => s.devices);
  const selectedDevice = devices.find((d) => d.id === selectedDeviceId);

  useEffect(() => {
    appWindow.isMaximized().then(setIsMaximized);
    let unlisten: (() => void) | undefined;
    appWindow.onResized(async () => {
      setIsMaximized(await appWindow.isMaximized());
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  const handleMaximize = async () => {
    await appWindow.toggleMaximize();
    setIsMaximized(await appWindow.isMaximized());
  };

  return (
    <div
      data-tauri-drag-region
      style={{
        height: 36,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        background: "var(--tb-bg)",
        borderBottom: "1px solid var(--border)",
        userSelect: "none",
      }}
    >
      {/* Left: icon + app name */}
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          padding: "0 12px",
          flexShrink: 0,
        }}
      >
        <img
          src="/icon.png"
          alt=""
          draggable={false}
          style={{ width: 16, height: 16, borderRadius: 3 }}
        />
        <Text strong style={{ fontSize: 13, lineHeight: 1 }}>
          Bridge
        </Text>
      </div>

      {/* Centre: flex spacer (draggable) */}
      <div data-tauri-drag-region style={{ flex: 1 }} />

      {/* Centre-right: active device name */}
      {selectedDevice && (
        <div
          onMouseDown={(e) => e.stopPropagation()}
          style={{ paddingRight: 8 }}
        >
          <Text type="secondary" style={{ fontSize: 13 }}>
            {selectedDevice.name}
            {selectedDevice.model ? ` (${selectedDevice.model})` : ""}
          </Text>
        </div>
      )}

      {/* Right: window controls */}
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{ display: "flex", height: "100%", flexShrink: 0 }}
      >
        <WinBtn
          icon={<MinimizeIcon />}
          onClick={() => appWindow.minimize()}
          title="Minimize"
        />
        <WinBtn
          icon={isMaximized ? <RestoreIcon /> : <MaximizeIcon />}
          onClick={handleMaximize}
          title={isMaximized ? "Restore" : "Maximize"}
        />
        <WinBtn
          icon={<CloseIcon />}
          onClick={() => appWindow.close()}
          isClose
          title="Close"
        />
      </div>
    </div>
  );
}
