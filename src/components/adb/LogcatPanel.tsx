import { Input, Select, Button, Space } from "antd";

export function LogcatPanel() {
  return (
    <div>
      <Space style={{ marginBottom: 16, width: "100%" }}>
        <Input placeholder="Filter..." style={{ width: 200 }} />
        <Select defaultValue="all" style={{ width: 100 }} options={[
          { value: "all", label: "All" },
          { value: "verbose", label: "Verbose" },
          { value: "debug", label: "Debug" },
          { value: "info", label: "Info" },
          { value: "warn", label: "Warn" },
          { value: "error", label: "Error" },
        ]} />
        <Button>Clear</Button>
        <Button>Export</Button>
      </Space>
      <div style={{ background: "#000", padding: 8, height: 400, overflow: "auto", fontFamily: "monospace" }}>
        <div style={{ color: "#888" }}>Logcat output will appear here...</div>
      </div>
    </div>
  );
}
