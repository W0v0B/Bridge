import { Button, Tooltip, Typography } from "antd";
import {
  PlusOutlined,
  SettingOutlined,
  UsbOutlined,
  ApiOutlined,
  MobileOutlined,
  DisconnectOutlined,
} from "@ant-design/icons";
import { useDeviceStore } from "../../store/deviceStore";
import { disconnectDevice, getDevices } from "../../utils/adb";
import { closePort } from "../../utils/serial";
import type { ConnectedDevice } from "../../types/device";

const { Text } = Typography;

const stateColors: Record<string, string> = {
  device: "#52c41a",
  connected: "#52c41a",
  offline: "#ff4d4f",
  unauthorized: "#faad14",
  authorizing: "#1677ff",
};

interface SidebarProps {
  onConnect: () => void;
}

export function Sidebar({ onConnect }: SidebarProps) {
  const devices = useDeviceStore((s) => s.devices);
  const selectedDeviceId = useDeviceStore((s) => s.selectedDeviceId);
  const selectDevice = useDeviceStore((s) => s.selectDevice);
  const removeDevice = useDeviceStore((s) => s.removeDevice);
  const syncAdbDevices = useDeviceStore((s) => s.syncAdbDevices);

  const adbDevices = devices.filter((d) => d.type === "adb");
  const serialDevices = devices.filter((d) => d.type === "serial");
  const ohosDevices = devices.filter((d) => d.type === "ohos");

  const handleDisconnect = async (device: ConnectedDevice) => {
    try {
      if (device.type === "adb") {
        await disconnectDevice(device.serial);
        const updated = await getDevices();
        syncAdbDevices(updated);
      } else if (device.type === "serial") {
        await closePort(device.serial);
        removeDevice(device.id);
      } else {
        // OHOS devices are removed from list when disconnected physically;
        // no explicit disconnect command needed.
        removeDevice(device.id);
      }
    } catch {
      // ignore
    }
  };

  const renderDevice = (device: ConnectedDevice) => {
    const isSelected = device.id === selectedDeviceId;
    const dotColor = stateColors[device.state] || "#d9d9d9";
    const canDisconnect =
      device.serial.includes(":") ||
      device.type === "serial" ||
      device.type === "ohos";

    return (
      <div
        key={device.id}
        onClick={() => selectDevice(device.id)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 12px",
          cursor: "pointer",
          borderRadius: 6,
          background: isSelected ? "#e6f4ff" : "transparent",
          marginBottom: 2,
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: dotColor,
            flexShrink: 0,
          }}
        />
        <Text
          ellipsis
          style={{
            flex: 1,
            fontSize: 13,
            color: isSelected ? "#1677ff" : undefined,
          }}
        >
          {device.name}
        </Text>
        {canDisconnect ? (
          <Tooltip title="Disconnect">
            <DisconnectOutlined
              style={{ fontSize: 12, color: "#8c8c8c" }}
              onClick={(e) => {
                e.stopPropagation();
                handleDisconnect(device);
              }}
            />
          </Tooltip>
        ) : null}
      </div>
    );
  };

  const renderGroup = (
    title: string,
    icon: React.ReactNode,
    items: ConnectedDevice[]
  ) => (
    <div style={{ marginBottom: 8 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 12px",
          color: "#8c8c8c",
          fontSize: 12,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: 0.5,
        }}
      >
        {icon}
        {title}
      </div>
      {items.length > 0 ? (
        items.map(renderDevice)
      ) : (
        <Text
          type="secondary"
          style={{ fontSize: 12, padding: "4px 12px 4px 26px", display: "block" }}
        >
          No devices
        </Text>
      )}
    </div>
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
      }}
    >
      {/* Brand + Add button */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 12px 8px",
        }}
      >
        <Text strong style={{ fontSize: 16 }}>
          DevBridge
        </Text>
        <Tooltip title="Connect device">
          <Button
            type="primary"
            size="small"
            icon={<PlusOutlined />}
            onClick={onConnect}
          />
        </Tooltip>
      </div>

      {/* Device groups */}
      <div style={{ flex: 1, overflow: "auto", paddingTop: 8 }}>
        {renderGroup(
          "ADB Devices",
          <UsbOutlined style={{ fontSize: 11 }} />,
          adbDevices
        )}
        {renderGroup(
          "OHOS Devices",
          <MobileOutlined style={{ fontSize: 11 }} />,
          ohosDevices
        )}
        {renderGroup(
          "Serial Devices",
          <ApiOutlined style={{ fontSize: 11 }} />,
          serialDevices
        )}
      </div>

      {/* Settings */}
      <div
        style={{
          padding: "8px 12px",
          borderTop: "1px solid #f0f0f0",
        }}
      >
        <Button type="text" icon={<SettingOutlined />} block style={{ textAlign: "left" }}>
          Settings
        </Button>
      </div>
    </div>
  );
}
