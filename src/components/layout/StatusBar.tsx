import { Layout, Tag } from "antd";
import { useDeviceStore } from "../../store/deviceStore";

const { Footer } = Layout;

export function StatusBar() {
  const devices = useDeviceStore((s) => s.devices);
  const selectedDeviceId = useDeviceStore((s) => s.selectedDeviceId);

  const adbCount = devices.filter((d) => d.type === "adb" && d.state === "device").length;
  const serialCount = devices.filter((d) => d.type === "serial").length;
  const total = adbCount + serialCount;
  const selectedDevice = devices.find((d) => d.id === selectedDeviceId);

  return (
    <Footer
      style={{
        padding: "6px 16px",
        background: "#fff",
        borderTop: "1px solid #f0f0f0",
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      <Tag color={total > 0 ? "green" : "default"}>
        {total > 0 ? "Connected" : "No Devices"}
      </Tag>
      <span style={{ color: "#8c8c8c", fontSize: 12 }}>
        {adbCount > 0 && `ADB: ${adbCount}`}
        {adbCount > 0 && serialCount > 0 && " · "}
        {serialCount > 0 && `Serial: ${serialCount}`}
        {total === 0 && "Connect a device to get started"}
      </span>
      {selectedDevice && (
        <span style={{ marginLeft: "auto", color: "#8c8c8c", fontSize: 12 }}>
          Active: {selectedDevice.name}
        </span>
      )}
    </Footer>
  );
}
