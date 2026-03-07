import { useState } from "react";
import { ConfigProvider, Layout, Tabs, theme } from "antd";
import { Sidebar } from "./components/layout/Sidebar";
import { Toolbar } from "./components/layout/Toolbar";
import { StatusBar } from "./components/layout/StatusBar";
import { ConnectModal } from "./components/layout/ConnectModal";
import { WelcomePage } from "./components/layout/WelcomePage";
import { FileManager } from "./components/adb/FileManager";
import { AppManager } from "./components/adb/AppManager";
import { LogcatPanel } from "./components/adb/LogcatPanel";
import { TransferQueue } from "./components/adb/TransferQueue";
import { ShellPanel } from "./components/shell/ShellPanel";
import { useDeviceEvents } from "./hooks/useAdbEvents";
import { useSerialDisconnect } from "./hooks/useSerialEvents";
import { useDeviceStore } from "./store/deviceStore";

const { Content, Sider } = Layout;

// Tab item arrays are module-level constants so the component instances inside
// them are never recreated — their internal state (output buffers, logcat
// entries, file listings) survives device switches.
const adbTabs = [
  { key: "shell", label: "Shell", children: <ShellPanel /> },
  { key: "logcat", label: "Logcat", children: <LogcatPanel /> },
  { key: "files", label: "File Manager", children: <FileManager /> },
  { key: "apps", label: "Apps", children: <AppManager /> },
];

const serialTabs = [
  { key: "shell", label: "Shell", children: <ShellPanel /> },
];

function App() {
  useDeviceEvents();
  useSerialDisconnect();
  const [connectModalOpen, setConnectModalOpen] = useState(false);

  const selectedDeviceId = useDeviceStore((s) => s.selectedDeviceId);
  const devices = useDeviceStore((s) => s.devices);
  const selectedDevice = devices.find((d) => d.id === selectedDeviceId);
  const deviceType = selectedDevice?.type;

  return (
    <ConfigProvider
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: { colorBgContainer: "#fff", borderRadius: 6 },
      }}
    >
      <Layout style={{ height: "100vh", overflow: "hidden" }}>
        <Sider width={200} style={{ background: "#fff" }}>
          <Sidebar onConnect={() => setConnectModalOpen(true)} />
        </Sider>
        <Layout style={{ minHeight: 0 }}>
          <Toolbar />
          <Content
            style={{
              overflow: "hidden",
              flex: 1,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* Welcome page — rendered only when no device is selected */}
            {!selectedDevice && <WelcomePage />}

            {/*
              Both tab containers are always mounted once their device type has
              appeared. CSS display:none hides the inactive one without
              unmounting it, so all panel state is preserved across switches.
              destroyInactiveTabPane={false} keeps individual tab panels alive
              when the user switches between Shell / Logcat / Files / Apps.
            */}
            <div
              style={{
                display: deviceType === "adb" ? "flex" : "none",
                flex: 1,
                minHeight: 0,
                padding: 16,
                flexDirection: "column",
              }}
            >
              <Tabs
                items={adbTabs}
                destroyInactiveTabPane={false}
                style={{ flex: 1 }}
                tabBarStyle={{ marginBottom: 12 }}
              />
            </div>

            <div
              style={{
                display: deviceType === "serial" ? "flex" : "none",
                flex: 1,
                minHeight: 0,
                padding: 16,
                flexDirection: "column",
              }}
            >
              <Tabs
                items={serialTabs}
                destroyInactiveTabPane={false}
                style={{ flex: 1 }}
                tabBarStyle={{ marginBottom: 12 }}
              />
            </div>
          </Content>
          <TransferQueue />
          <StatusBar />
        </Layout>
      </Layout>
      <ConnectModal
        open={connectModalOpen}
        onClose={() => setConnectModalOpen(false)}
      />
    </ConfigProvider>
  );
}

export default App;
