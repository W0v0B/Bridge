import { useState } from "react";
import { ConfigProvider, Layout, Tabs, theme } from "antd";
import { Sidebar } from "./components/layout/Sidebar";
import { Toolbar } from "./components/layout/Toolbar";
import { StatusBar } from "./components/layout/StatusBar";
import { ConnectModal } from "./components/layout/ConnectModal";
import { FileManager } from "./components/adb/FileManager";
import { AppManager } from "./components/adb/AppManager";
import { LogcatPanel } from "./components/adb/LogcatPanel";
import { TransferQueue } from "./components/adb/TransferQueue";
import { ShellPanel } from "./components/shell/ShellPanel";
import { useDeviceEvents } from "./hooks/useAdbEvents";
import { useSerialDisconnect } from "./hooks/useSerialEvents";

const { Content, Sider } = Layout;

function App() {
  useDeviceEvents();
  useSerialDisconnect();
  const [connectModalOpen, setConnectModalOpen] = useState(false);

  const tabItems = [
    { key: "shell", label: "Shell", children: <ShellPanel /> },
    { key: "logcat", label: "Logcat", children: <LogcatPanel /> },
    { key: "files", label: "File Manager", children: <FileManager /> },
    { key: "apps", label: "Apps", children: <AppManager /> },
  ];

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
              padding: 16,
              overflow: "hidden",
              flex: 1,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <Tabs
              items={tabItems}
              style={{ flex: 1 }}
              tabBarStyle={{ marginBottom: 12 }}
            />
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
