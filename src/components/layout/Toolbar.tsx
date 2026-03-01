import { Layout, Button, Space, Typography } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { useDeviceStore } from "../../store/deviceStore";
import { getDevices } from "../../utils/adb";

const { Header } = Layout;
const { Text } = Typography;

export function Toolbar() {
  const syncAdbDevices = useDeviceStore((s) => s.syncAdbDevices);
  const selectedDeviceId = useDeviceStore((s) => s.selectedDeviceId);
  const devices = useDeviceStore((s) => s.devices);
  const selectedDevice = devices.find((d) => d.id === selectedDeviceId);

  const handleRefresh = async () => {
    try {
      const devs = await getDevices();
      syncAdbDevices(devs);
    } catch {
      // ignore
    }
  };

  return (
    <Header
      style={{
        background: "#fff",
        padding: "0 16px",
        display: "flex",
        alignItems: "center",
        borderBottom: "1px solid #f0f0f0",
        height: 48,
        lineHeight: "48px",
      }}
    >
      <Space>
        <Button icon={<ReloadOutlined />} onClick={handleRefresh}>
          Refresh
        </Button>
        {selectedDevice && (
          <Text type="secondary" style={{ fontSize: 13 }}>
            {selectedDevice.name}
            {selectedDevice.model ? ` (${selectedDevice.model})` : ""}
          </Text>
        )}
      </Space>
    </Header>
  );
}
