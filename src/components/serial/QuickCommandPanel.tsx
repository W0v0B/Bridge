import { Button, Card, Space } from "antd";

export function QuickCommandPanel() {
  const commands = [
    { label: "Reboot", cmd: "reboot" },
    { label: "Get Props", cmd: "getprop" },
    { label: "List Packages", cmd: "pm list packages" },
  ];

  return (
    <Space direction="vertical" style={{ width: "100%" }}>
      {commands.map((c) => (
        <Card key={c.cmd} size="small">
          <Button type="primary">{c.label}</Button>
          <span style={{ marginLeft: 16, color: "#888" }}>{c.cmd}</span>
        </Card>
      ))}
    </Space>
  );
}
