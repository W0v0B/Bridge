import { useState } from "react";
import {
  App,
  Modal,
  Segmented,
  Form,
  Input,
  InputNumber,
  Radio,
  Select,
  Button,
  Tooltip,
  Typography,
} from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { connectNetworkDevice, getDevices } from "../../utils/adb";
import { connectOhosDevice, getOhosDevices } from "../../utils/hdc";
import { listPorts, openPort, openTelnetSession } from "../../utils/serial";
import { useDeviceStore } from "../../store/deviceStore";
import { useConfigStore } from "../../store/configStore";

const { Text } = Typography;

interface ConnectModalProps {
  open: boolean;
  onClose: () => void;
}

export function ConnectModal({ open, onClose }: ConnectModalProps) {
  const { message } = App.useApp();
  const cfg = useConfigStore((s) => s.config);
  const setConfig = useConfigStore((s) => s.setConfig);
  const [mode, setMode] = useState<"ADB" | "OHOS" | "Serial">("ADB");
  const [loading, setLoading] = useState(false);
  const [portsLoading, setPortsLoading] = useState(false);

  // ADB fields
  const [host, setHost] = useState(cfg.adbHost);
  const [port, setPort] = useState(cfg.adbPort);
  const [adbName, setAdbName] = useState("");

  // OHOS fields
  const [ohosHost, setOhosHost] = useState(cfg.ohosHost);
  const [ohosPort, setOhosPort] = useState(cfg.ohosPort);
  const [ohosName, setOhosName] = useState("");

  // Serial fields
  const [serialMode, setSerialMode] = useState<"com" | "telnet">("com");
  const [ports, setPorts] = useState<string[]>([]);
  const [selectedPort, setSelectedPort] = useState<string>("");
  const [baudRate, setBaudRate] = useState(cfg.baudRate);
  const [serialName, setSerialName] = useState("");
  // Telnet fields
  const [telnetHost, setTelnetHost] = useState(cfg.telnetHost);
  const [telnetPort, setTelnetPort] = useState(cfg.telnetPort);

  const addDevice = useDeviceStore((s) => s.addDevice);
  const syncAdbDevices = useDeviceStore((s) => s.syncAdbDevices);
  const syncOhosDevices = useDeviceStore((s) => s.syncOhosDevices);

  const fetchPorts = async () => {
    setPortsLoading(true);
    try {
      const available = await listPorts();
      setPorts(available);
    } catch {
      // ignore
    } finally {
      setPortsLoading(false);
    }
  };

  const handleOpen = async () => {
    if (mode === "Serial") fetchPorts();
  };

  const handleAdbConnect = async () => {
    if (!host) return;
    setLoading(true);
    try {
      const result = await connectNetworkDevice(host, port);
      message.success(result);
      const devices = await getDevices();
      syncAdbDevices(devices);

      const serial = `${host}:${port}`;
      const name = adbName.trim() || serial;
      if (adbName.trim()) {
        useDeviceStore.getState().updateDevice(serial, { name });
      }

      setConfig({ adbHost: host, adbPort: port });
      onClose();
    } catch (e) {
      message.error(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleOhosConnect = async () => {
    if (!ohosHost) return;
    const addr = `${ohosHost}:${ohosPort}`;
    setLoading(true);
    try {
      const result = await connectOhosDevice(addr);
      message.success(result || `Connected to ${addr}`);
      const devices = await getOhosDevices();
      syncOhosDevices(devices);

      if (ohosName.trim()) {
        useDeviceStore.getState().updateDevice(addr, { name: ohosName.trim() });
      }

      setConfig({ ohosHost, ohosPort });
      onClose();
    } catch (e) {
      message.error(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleSerialConnect = async () => {
    setLoading(true);
    try {
      if (serialMode === "telnet") {
        if (!telnetHost) return;
        const id = `${telnetHost}:${telnetPort}`;
        await openTelnetSession(telnetHost, telnetPort);
        const name = serialName.trim() || id;
        addDevice({ id, type: "serial", name, serial: id, state: "connected" });
        message.success(`Connected to ${id}`);
        setConfig({ telnetHost, telnetPort });
      } else {
        if (!selectedPort) return;
        await openPort(selectedPort, baudRate);
        const name = serialName.trim() || selectedPort;
        addDevice({ id: selectedPort, type: "serial", name, serial: selectedPort, state: "connected" });
        message.success(`Connected to ${selectedPort}`);
        setConfig({ baudRate });
      }
      onClose();
    } catch (e) {
      message.error(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = () => {
    if (mode === "ADB") return handleAdbConnect();
    if (mode === "OHOS") return handleOhosConnect();
    return handleSerialConnect();
  };

  return (
    <Modal
      title="Connect Device"
      open={open}
      onCancel={onClose}
      afterOpenChange={(visible) => {
        if (visible) handleOpen();
      }}
      footer={
        <Button type="primary" loading={loading} onClick={handleConnect}>
          Connect
        </Button>
      }
    >
      <Segmented
        options={["ADB", "OHOS", "Serial"]}
        value={mode}
        onChange={(v) => {
          const next = v as "ADB" | "OHOS" | "Serial";
          setMode(next);
          if (next === "Serial") fetchPorts();
        }}
        block
        style={{ marginBottom: 16 }}
      />

      {mode === "ADB" && (
        <Form layout="vertical">
          <Form.Item label="Host">
            <Input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="192.168.1.100"
            />
          </Form.Item>
          <Form.Item label="Port">
            <InputNumber
              min={1}
              max={65535}
              value={port}
              onChange={(v) => setPort(v ?? 5555)}
              style={{ width: "100%" }}
            />
          </Form.Item>
          <Form.Item label="Name (optional)">
            <Input
              value={adbName}
              onChange={(e) => setAdbName(e.target.value)}
              placeholder={`${host}:${port}`}
            />
          </Form.Item>
        </Form>
      )}

      {mode === "OHOS" && (
        <Form layout="vertical">
          <Form.Item label="Host">
            <Input
              value={ohosHost}
              onChange={(e) => setOhosHost(e.target.value)}
              placeholder="192.168.1.100"
            />
          </Form.Item>
          <Form.Item label="Port">
            <InputNumber
              min={1}
              max={65535}
              value={ohosPort}
              onChange={(v) => setOhosPort(v ?? 5555)}
              style={{ width: "100%" }}
            />
          </Form.Item>
          <Form.Item
            label="Name (optional)"
            extra={
              <Text type="secondary" style={{ fontSize: 12 }}>
                USB devices appear automatically in the sidebar. Use this to connect over TCP (hdc tconn).
              </Text>
            }
          >
            <Input
              value={ohosName}
              onChange={(e) => setOhosName(e.target.value)}
              placeholder={`${ohosHost}:${ohosPort}`}
            />
          </Form.Item>
        </Form>
      )}

      {mode === "Serial" && (
        <Form layout="vertical">
          <Form.Item>
            <Radio.Group
              value={serialMode}
              onChange={(e) => setSerialMode(e.target.value)}
              optionType="button"
              buttonStyle="solid"
              size="small"
              options={[
                { label: "COM Port", value: "com" },
                { label: "Telnet", value: "telnet" },
              ]}
            />
          </Form.Item>

          {serialMode === "com" ? (
            <>
              <Form.Item label="Port">
                <div style={{ display: "flex", gap: 8 }}>
                  <Select
                    value={selectedPort || undefined}
                    onChange={setSelectedPort}
                    placeholder="Select port"
                    options={ports.map((p) => ({ value: p, label: p }))}
                    loading={portsLoading}
                    style={{ flex: 1 }}
                  />
                  <Tooltip title="Refresh port list">
                    <Button
                      icon={<ReloadOutlined />}
                      onClick={fetchPorts}
                      loading={portsLoading}
                    />
                  </Tooltip>
                </div>
              </Form.Item>
              <Form.Item label="Baud Rate">
                <Select
                  value={baudRate}
                  onChange={setBaudRate}
                  options={[
                    { value: 9600, label: "9600" },
                    { value: 19200, label: "19200" },
                    { value: 38400, label: "38400" },
                    { value: 57600, label: "57600" },
                    { value: 115200, label: "115200" },
                    { value: 230400, label: "230400" },
                    { value: 460800, label: "460800" },
                    { value: 921600, label: "921600" },
                  ]}
                />
              </Form.Item>
            </>
          ) : (
            <>
              <Form.Item label="Host">
                <Input
                  value={telnetHost}
                  onChange={(e) => setTelnetHost(e.target.value)}
                  placeholder="192.168.1.100"
                />
              </Form.Item>
              <Form.Item label="Port">
                <InputNumber
                  min={1}
                  max={65535}
                  value={telnetPort}
                  onChange={(v) => setTelnetPort(v ?? 23)}
                  style={{ width: "100%" }}
                />
              </Form.Item>
            </>
          )}

          <Form.Item label="Name (optional)">
            <Input
              value={serialName}
              onChange={(e) => setSerialName(e.target.value)}
              placeholder={
                serialMode === "telnet"
                  ? `${telnetHost}:${telnetPort}`
                  : selectedPort || "Device name"
              }
            />
          </Form.Item>
        </Form>
      )}
    </Modal>
  );
}
