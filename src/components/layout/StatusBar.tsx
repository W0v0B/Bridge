import { Layout, Tag } from "antd";

const { Footer } = Layout;

export function StatusBar() {
  return (
    <Footer style={{ padding: "8px 16px", background: "#141414" }}>
      <Tag color="green">Ready</Tag>
      <span style={{ color: "#888" }}>No active connections</span>
    </Footer>
  );
}
