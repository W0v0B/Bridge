import { useState } from "react";
import { Button, Input, Space, Typography, message } from "antd";
import { DeleteOutlined, SendOutlined, PlusOutlined } from "@ant-design/icons";
import { useCommandStore } from "../../store/commandStore";
import { useDeviceStore } from "../../store/deviceStore";
import { runShellCommand } from "../../utils/adb";
import { writeToPort } from "../../utils/serial";

const { Text } = Typography;

interface QuickCommandsPanelProps {
  onOutput?: (text: string) => void;
}

export function QuickCommandsPanel({ onOutput }: QuickCommandsPanelProps) {
  const commands = useCommandStore((s) => s.commands);
  const addCommand = useCommandStore((s) => s.addCommand);
  const removeCommand = useCommandStore((s) => s.removeCommand);
  const selectedDeviceId = useDeviceStore((s) => s.selectedDeviceId);
  const devices = useDeviceStore((s) => s.devices);

  const [newLabel, setNewLabel] = useState("");
  const [newCommand, setNewCommand] = useState("");

  const selectedDevice = devices.find((d) => d.id === selectedDeviceId);

  const handleSend = async (command: string) => {
    if (!selectedDevice) {
      message.warning("No device selected");
      return;
    }
    try {
      if (selectedDevice.type === "adb") {
        const result = await runShellCommand(selectedDevice.serial, command);
        onOutput?.(`$ ${command}\n${result}\n`);
      } else {
        onOutput?.(`> ${command}\n`);
        await writeToPort(selectedDevice.serial, command + "\r\n");
      }
    } catch (e) {
      const prefix = selectedDevice.type === "adb" ? "$" : ">";
      onOutput?.(`${prefix} ${command}\nError: ${e}\n`);
    }
  };

  const handleAdd = () => {
    const label = newLabel.trim();
    const cmd = newCommand.trim();
    if (!label || !cmd) return;
    addCommand(label, cmd);
    setNewLabel("");
    setNewCommand("");
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        padding: 12,
        overflow: "auto",
      }}
    >
      <Text strong style={{ marginBottom: 8 }}>
        Quick Commands
      </Text>

      <div style={{ flex: 1, overflow: "auto" }}>
        {commands.map((cmd) => (
          <div
            key={cmd.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 8px",
              marginBottom: 4,
              borderRadius: 6,
              border: "1px solid #f0f0f0",
              background: "#fafafa",
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <Text strong style={{ fontSize: 13, display: "block" }}>
                {cmd.label}
              </Text>
              <Text
                type="secondary"
                style={{ fontSize: 11, fontFamily: "monospace" }}
                ellipsis
              >
                {cmd.command}
              </Text>
            </div>
            <Button
              size="small"
              type="primary"
              icon={<SendOutlined />}
              onClick={() => handleSend(cmd.command)}
            />
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={() => removeCommand(cmd.id)}
            />
          </div>
        ))}
      </div>

      {/* Add command form */}
      <div
        style={{
          borderTop: "1px solid #f0f0f0",
          paddingTop: 8,
          marginTop: 8,
        }}
      >
        <Space direction="vertical" style={{ width: "100%" }} size={4}>
          <Input
            size="small"
            placeholder="Label"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
          />
          <Input
            size="small"
            placeholder="Command"
            value={newCommand}
            onChange={(e) => setNewCommand(e.target.value)}
            onPressEnter={handleAdd}
          />
          <Button
            size="small"
            icon={<PlusOutlined />}
            onClick={handleAdd}
            block
          >
            Add Command
          </Button>
        </Space>
      </div>
    </div>
  );
}
