import { Typography, Divider } from "antd";
import {
  AndroidOutlined,
  GlobalOutlined,
  ApiOutlined,
  CodeOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  AppstoreOutlined,
} from "@ant-design/icons";

const { Title, Text, Paragraph } = Typography;

interface Step {
  icon: React.ReactNode;
  title: string;
  lines: string[];
}

function StepCard({ icon, title, lines }: Step) {
  return (
    <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
      <div
        style={{
          fontSize: 22,
          color: "#1677ff",
          width: 28,
          flexShrink: 0,
          paddingTop: 2,
        }}
      >
        {icon}
      </div>
      <div>
        <Text strong style={{ fontSize: 14 }}>
          {title}
        </Text>
        {lines.map((line, i) => (
          <Paragraph
            key={i}
            type="secondary"
            style={{ margin: "2px 0 0", fontSize: 13 }}
          >
            {line}
          </Paragraph>
        ))}
      </div>
    </div>
  );
}

interface Feature {
  icon: React.ReactNode;
  label: string;
  description: string;
}

function FeatureRow({ icon, label, description }: Feature) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
      <span style={{ color: "#1677ff", fontSize: 15, flexShrink: 0 }}>{icon}</span>
      <Text strong style={{ width: 100, flexShrink: 0, fontSize: 13 }}>
        {label}
      </Text>
      <Text type="secondary" style={{ fontSize: 13 }}>
        {description}
      </Text>
    </div>
  );
}

export function WelcomePage() {
  return (
    <div
      style={{
        height: "100%",
        overflow: "auto",
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        padding: "40px 24px 24px",
      }}
    >
      <div style={{ width: "100%", maxWidth: 680 }}>
        {/* Header */}
        <Title level={2} style={{ marginBottom: 4 }}>
          DevBridge
        </Title>
        <Text type="secondary" style={{ fontSize: 14 }}>
          ADB &amp; Serial Port Debugging Tool
        </Text>

        <Divider style={{ margin: "24px 0 20px" }} />

        {/* Get Started */}
        <Title level={5} style={{ marginBottom: 16, color: "#8c8c8c", fontWeight: 600, letterSpacing: 1 }}>
          GET STARTED
        </Title>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 40px" }}>
          <div>
            <StepCard
              icon={<AndroidOutlined />}
              title="Connect an ADB Device (USB)"
              lines={[
                "Plug in your Android device via USB.",
                "Enable USB Debugging in Settings → Developer Options.",
                "The device appears in the sidebar automatically.",
              ]}
            />
            <StepCard
              icon={<GlobalOutlined />}
              title="Connect an ADB Device (Network)"
              lines={[
                'Click "+ Connect" in the sidebar.',
                "Enter the device IP address and port (default 5555).",
                "Requires USB Debugging or adb tcpip to be active.",
              ]}
            />
          </div>
          <div>
            <StepCard
              icon={<ApiOutlined />}
              title="Open a Serial Port"
              lines={[
                'Click "+ Connect" in the sidebar.',
                "Select the COM port and baud rate.",
                "Send and receive data in the Shell tab.",
              ]}
            />
            <StepCard
              icon={<AndroidOutlined />}
              title="Root &amp; Remount (ADB)"
              lines={[
                "DevBridge automatically attempts adb root and",
                "adb remount when a device connects.",
                "Status is shown in the File Manager toolbar.",
              ]}
            />
          </div>
        </div>

        <Divider style={{ margin: "8px 0 20px" }} />

        {/* Features */}
        <Title level={5} style={{ marginBottom: 16, color: "#8c8c8c", fontWeight: 600, letterSpacing: 1 }}>
          WHAT YOU CAN DO
        </Title>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 40px" }}>
          <div>
            <FeatureRow
              icon={<CodeOutlined />}
              label="Shell"
              description="Run commands on any ADB or serial device in real time"
            />
            <FeatureRow
              icon={<FileTextOutlined />}
              label="Logcat"
              description="Stream, filter, and export Android system logs"
            />
          </div>
          <div>
            <FeatureRow
              icon={<FolderOpenOutlined />}
              label="File Manager"
              description="Browse, upload, download, delete, and view device files"
            />
            <FeatureRow
              icon={<AppstoreOutlined />}
              label="Apps"
              description="List, install, and uninstall packages (including system apps)"
            />
          </div>
        </div>

        <Divider style={{ margin: "20px 0 16px" }} />

        {/* Footer tip */}
        <Text type="secondary" style={{ fontSize: 12 }}>
          Select a device from the sidebar to get started. ADB devices show all four tabs; serial devices show the Shell tab only.
        </Text>
      </div>
    </div>
  );
}
