import { useState } from "react";
import { ConfigProvider, Layout, Tabs, theme } from "antd";
import { Sidebar } from "./components/layout/Sidebar";
import { Toolbar } from "./components/layout/Toolbar";
import { StatusBar } from "./components/layout/StatusBar";
import { ConnectModal } from "./components/layout/ConnectModal";
import { FileManager } from "./components/adb/FileManager";
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
  ];

  return (
    <ConfigProvider
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: { colorBgContainer: "#fff", borderRadius: 6 },
      }}
    >
      <Layout style={{ minHeight: "100vh" }}>
        <Sider width={200} style={{ background: "#fff" }}>
          <Sidebar onConnect={() => setConnectModalOpen(true)} />
        </Sider>
        <Layout>
          <Toolbar />
          <Content
            style={{
              padding: 16,
              overflow: "auto",
              flex: 1,
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
