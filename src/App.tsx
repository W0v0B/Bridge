import { useEffect, useState } from "react";
import { App as AntApp, ConfigProvider, Layout, Tabs } from "antd";
import { Sidebar } from "./components/layout/Sidebar";
import { TitleBar } from "./components/layout/TitleBar";
import { StatusBar } from "./components/layout/StatusBar";
import { SettingsPanel } from "./components/layout/SettingsPanel";
import { ConnectModal } from "./components/layout/ConnectModal";
import { WelcomePage } from "./components/layout/WelcomePage";
import { FileManager } from "./components/adb/FileManager";
import { AppManager } from "./components/adb/AppManager";
import { LogcatPanel } from "./components/adb/LogcatPanel";
import { TransferQueue } from "./components/adb/TransferQueue";
import { ShellPanel } from "./components/shell/ShellPanel";
import { HilogPanel } from "./components/hdc/HilogPanel";
import { HdcFileManager } from "./components/hdc/HdcFileManager";
import { HdcAppManager } from "./components/hdc/HdcAppManager";
import { useDeviceEvents } from "./hooks/useAdbEvents";
import { useOhosDeviceEvents } from "./hooks/useHdcEvents";
import { useSerialDisconnect } from "./hooks/useSerialEvents";
import { useDeviceStore } from "./store/deviceStore";
import { useConfigStore } from "./store/configStore";
import { THEMES } from "./theme";
import { getDevices } from "./utils/adb";
import { loadBgImage } from "./utils/background";

const { Content, Sider } = Layout;

// Isolated component so opacity slider changes only re-render this div,
// not the entire App tree.
function BgLayer({ dataUrl }: { dataUrl: string }) {
  const bgOpacity = useConfigStore((s) => s.config.bgOpacity);
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        backgroundImage: `url(${dataUrl})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        opacity: bgOpacity,
        pointerEvents: "none",
        zIndex: 0,
      }}
    />
  );
}

// Tab item arrays are module-level constants so the component instances inside
// them are never recreated — their internal state survives device switches.
const adbTabs = [
  { key: "shell", label: "Shell", children: <ShellPanel /> },
  { key: "logcat", label: "Logcat", children: <LogcatPanel /> },
  { key: "files", label: "File Manager", children: <FileManager /> },
  { key: "apps", label: "Apps", children: <AppManager /> },
];

const serialTabs = [
  { key: "shell", label: "Shell", children: <ShellPanel /> },
];

const ohosTabs = [
  { key: "shell", label: "Shell", children: <ShellPanel /> },
  { key: "hilog", label: "HiLog", children: <HilogPanel /> },
  { key: "files", label: "File Manager", children: <HdcFileManager /> },
  { key: "apps", label: "Apps", children: <HdcAppManager /> },
];

function App() {
  useDeviceEvents();
  useOhosDeviceEvents();
  useSerialDisconnect();

  const [connectModalOpen, setConnectModalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [bgDataUrl, setBgDataUrl] = useState<string | null>(null);

  const syncAdbDevices = useDeviceStore((s) => s.syncAdbDevices);
  const handleRefresh = async () => {
    try { syncAdbDevices(await getDevices()); } catch { /* ignore */ }
  };

  const selectedDeviceId = useDeviceStore((s) => s.selectedDeviceId);
  const devices = useDeviceStore((s) => s.devices);
  const selectedDevice = devices.find((d) => d.id === selectedDeviceId);
  const deviceType = selectedDevice?.type;

  const themeId = useConfigStore((s) => s.config.theme);
  const appTheme = THEMES[themeId];
  const bgImagePath = useConfigStore((s) => s.config.bgImagePath);

  // Apply CSS variables whenever theme changes
  useEffect(() => {
    const root = document.documentElement;
    Object.entries(appTheme.css).forEach(([k, v]) => root.style.setProperty(k, v));
  }, [appTheme]);

  // Load background image as data URL whenever the stored path changes
  useEffect(() => {
    if (!bgImagePath) {
      setBgDataUrl(null);
      return;
    }
    loadBgImage(bgImagePath)
      .then(setBgDataUrl)
      .catch(() => setBgDataUrl(null));
  }, [bgImagePath]);

  const hasBg = !!bgDataUrl;

  return (
    <ConfigProvider
      theme={{
        algorithm: appTheme.antdAlgorithm,
        token: {
          colorPrimary:     appTheme.antdToken.colorPrimary,
          colorBgContainer: appTheme.antdToken.colorBgContainer,
          colorBgElevated:  appTheme.antdToken.colorBgElevated,
          colorBgLayout:    appTheme.antdToken.colorBgLayout,
          colorBorder:      appTheme.antdToken.colorBorder,
          borderRadius:     appTheme.antdToken.borderRadius,
        },
        // In dark themes, button bottom shadows (dangerShadow, defaultShadow,
        // primaryShadow) use semi-transparent colors that become visible stripes
        // against coloured dark backgrounds. Disable them for a flat look.
        components: appTheme.isDark ? {
          Button: { defaultShadow: "none", primaryShadow: "none", dangerShadow: "none" },
        } : {},
      }}
    >
      <AntApp style={{ height: "100vh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <TitleBar />
        <Layout style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
          <Sider width={sidebarCollapsed ? 48 : 200} style={{ background: "var(--sidebar-bg)", borderRight: "1px solid var(--border)", transition: "width 0.2s" }}>
            <Sidebar
              onConnect={() => setConnectModalOpen(true)}
              onRefresh={handleRefresh}
              onSettings={() => setSettingsOpen(true)}
              collapsed={sidebarCollapsed}
              onCollapse={setSidebarCollapsed}
            />
          </Sider>
          {/* Content area — position:relative so the bg layer is contained */}
          <Layout style={{ minHeight: 0, background: hasBg ? "transparent" : "var(--content-bg)", position: "relative" }}>
            {/* Background image layer — isolated component to avoid re-rendering App on opacity change */}
            {hasBg && <BgLayer dataUrl={bgDataUrl!} />}
            <Content
              style={{
                overflow: "hidden",
                flex: 1,
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
                background: hasBg ? "transparent" : "var(--content-bg)",
                position: "relative",
                zIndex: 1,
              }}
            >
              {/* Welcome page — rendered only when no device is selected */}
              {!selectedDevice && <WelcomePage />}

              {/*
                All three tab containers are always mounted once their device type has
                appeared. CSS display:none hides the inactive ones without unmounting,
                preserving all panel state across device-type switches.
                destroyOnHidden={false} keeps individual tab panels alive.
              */}
              <div
                style={{
                  display: deviceType === "adb" ? "flex" : "none",
                  flex: 1,
                  minHeight: 0,
                  padding: 16,
                  flexDirection: "column",
                  background: hasBg ? "transparent" : undefined,
                }}
              >
                <Tabs
                  items={adbTabs}
                  destroyOnHidden={false}
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
                  background: hasBg ? "transparent" : undefined,
                }}
              >
                <Tabs
                  items={serialTabs}
                  destroyOnHidden={false}
                  style={{ flex: 1 }}
                  tabBarStyle={{ marginBottom: 12 }}
                />
              </div>

              <div
                style={{
                  display: deviceType === "ohos" ? "flex" : "none",
                  flex: 1,
                  minHeight: 0,
                  padding: 16,
                  flexDirection: "column",
                  background: hasBg ? "transparent" : undefined,
                }}
              >
                <Tabs
                  items={ohosTabs}
                  destroyOnHidden={false}
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
        <SettingsPanel
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
        />
      </AntApp>
    </ConfigProvider>
  );
}

export default App;
