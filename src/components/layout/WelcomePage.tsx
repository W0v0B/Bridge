import { Typography } from "antd";
import {
  UsbOutlined,
  MobileOutlined,
  ApiOutlined,
} from "@ant-design/icons";

const { Title, Text } = Typography;

interface DeviceTypeCard {
  icon: React.ReactNode;
  label: string;
  features: string[];
}

function DeviceCard({ icon, label, features }: DeviceTypeCard) {
  return (
    <div
      style={{
        background: "#f5f5f5",
        borderRadius: 8,
        padding: "16px 20px",
        minWidth: 160,
        flex: 1,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 16, color: "#1677ff" }}>{icon}</span>
        <Text strong style={{ fontSize: 13 }}>{label}</Text>
      </div>
      {features.map((f, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
          <span style={{ width: 4, height: 4, borderRadius: "50%", background: "#bfbfbf", flexShrink: 0 }} />
          <Text type="secondary" style={{ fontSize: 12 }}>{f}</Text>
        </div>
      ))}
    </div>
  );
}

export function WelcomePage() {
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        gap: 0,
        padding: "0 32px 48px",
      }}
    >
      {/* Icon + Title */}
      <img
        src="/icon.png"
        alt="Bridge"
        style={{ width: 96, height: 96, marginBottom: 16, borderRadius: 16 }}
      />
      <Title level={2} style={{ margin: "0 0 6px" }}>
        Bridge
      </Title>
      <Text type="secondary" style={{ fontSize: 14, marginBottom: 36 }}>
        Device Debugging Toolkit
      </Text>

      {/* Device type cards */}
      <div style={{ display: "flex", gap: 12, width: "100%", maxWidth: 620, marginBottom: 32 }}>
        <DeviceCard
          icon={<UsbOutlined />}
          label="ADB (Android)"
          features={["Shell", "Logcat", "File Manager", "App Manager"]}
        />
        <DeviceCard
          icon={<MobileOutlined />}
          label="OHOS"
          features={["Shell", "HiLog", "File Manager", "App Manager"]}
        />
        <DeviceCard
          icon={<ApiOutlined />}
          label="Serial / Telnet"
          features={["Shell"]}
        />
      </div>

      {/* Hint */}
      <Text type="secondary" style={{ fontSize: 12 }}>
        Click&nbsp;<Text strong style={{ fontSize: 12 }}>+</Text>&nbsp;in the sidebar to connect a device.
      </Text>
    </div>
  );
}
