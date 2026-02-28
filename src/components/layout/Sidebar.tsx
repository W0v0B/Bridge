import { Menu } from "antd";
import { UsbOutlined, CodeOutlined, SettingOutlined } from "@ant-design/icons";

export function Sidebar() {
  const items = [
    { key: "adb", icon: <UsbOutlined />, label: "ADB" },
    { key: "serial", icon: <CodeOutlined />, label: "Serial" },
    { key: "settings", icon: <SettingOutlined />, label: "Settings" },
  ];

  return (
    <div>
      <div style={{ height: 32, margin: 16, color: "#fff", fontWeight: "bold" }}>
        DevBridge
      </div>
      <Menu theme="dark" mode="inline" defaultSelectedKeys={["adb"]} items={items} />
    </div>
  );
}
