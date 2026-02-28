import { ConfigProvider, Layout, Tabs, theme } from "antd";
import { Sidebar } from "./components/layout/Sidebar";
import { Toolbar } from "./components/layout/Toolbar";
import { StatusBar } from "./components/layout/StatusBar";
import { DeviceList } from "./components/adb/DeviceList";
import { FileManager } from "./components/adb/FileManager";
import { LogcatPanel } from "./components/adb/LogcatPanel";
import { SerialTerminal } from "./components/serial/SerialTerminal";
import { QuickCommandPanel } from "./components/serial/QuickCommandPanel";

const { Content, Sider } = Layout;

function App() {
  const tabItems = [
    { key: "devices", label: "Devices", children: <DeviceList /> },
    { key: "files", label: "File Manager", children: <FileManager /> },
    { key: "logcat", label: "Logcat", children: <LogcatPanel /> },
    { key: "serial", label: "Serial", children: <SerialTerminal /> },
    { key: "commands", label: "Quick Commands", children: <QuickCommandPanel /> },
  ];

  return (
    <ConfigProvider theme={{ algorithm: theme.darkAlgorithm }}>
      <Layout style={{ minHeight: "100vh" }}>
        <Sider width={200} theme="dark">
          <Sidebar />
        </Sider>
        <Layout>
          <Toolbar />
          <Content style={{ padding: 16, overflow: "auto" }}>
            <Tabs items={tabItems} />
          </Content>
          <StatusBar />
        </Layout>
      </Layout>
    </ConfigProvider>
  );
}

export default App;
