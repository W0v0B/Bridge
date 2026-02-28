import { Layout, Button, Space } from "antd";
import { ReloadOutlined, PlusOutlined } from "@ant-design/icons";

const { Header } = Layout;

export function Toolbar() {
  return (
    <Header style={{ background: "#1f1f1f", padding: "0 16px", display: "flex", alignItems: "center" }}>
      <Space>
        <Button icon={<ReloadOutlined />}>Refresh</Button>
        <Button icon={<PlusOutlined />}>Connect</Button>
      </Space>
    </Header>
  );
}
