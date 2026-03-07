import { useState } from "react";
import {
  Modal,
  Segmented,
  Form,
  Input,
  InputNumber,
  Select,
  Button,
  message,
  Tooltip,
} from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { connectNetworkDevice, getDevices } from "../../utils/adb";
import { listPorts, openPort } from "../../utils/serial";
import { useDeviceStore } from "../../store/deviceStore";

interface ConnectModalProps {
  open: boolean;
  onClose: () => void;
}

export function ConnectModal({ open, onClose }: ConnectModalProps) {
  const [mode, setMode] = useState<"ADB" | "Serial">("ADB");
  const [loading, setLoading] = useState(false);
  const [portsLoading, setPortsLoading] = useState(false);

  // ADB fields
  const [host, setHost] = useState("192.168.1.100");
  const [port, setPort] = useState(5555);
  const [adbName, setAdbName] = useState("");

  // Serial fields
  const [ports, setPorts] = useState<string[]>([]);
  const [selectedPort, setSelectedPort] = useState<string>("");
  const [baudRate, setBaudRate] = useState(115200);
  const [serialName, setSerialName] = useState("");

  const addDevice = useDeviceStore((s) => s.addDevice);
  const syncAdbDevices = useDeviceStore((s) => s.syncAdbDevices);

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
      // The device should now exist from syncAdbDevices; update its name if custom
      if (adbName.trim()) {
        useDeviceStore.getState().updateDevice(serial, { name });
      }

      onClose();
    } catch (e) {
      message.error(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleSerialConnect = async () => {
    if (!selectedPort) return;
    setLoading(true);
    try {
      await openPort(selectedPort, baudRate);
      const name = serialName.trim() || selectedPort;
      addDevice({
        id: selectedPort,
        type: "serial",
        name,
        serial: selectedPort,
        state: "connected",
      });
      message.success(`Connected to ${selectedPort}`);
      onClose();
    } catch (e) {
      message.error(String(e));
    } finally {
      setLoading(false);
    }
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
        <Button
          type="primary"
          loading={loading}
          onClick={mode === "ADB" ? handleAdbConnect : handleSerialConnect}
        >
          Connect
        </Button>
      }
    >
      <Segmented
        options={["ADB", "Serial"]}
        value={mode}
        onChange={(v) => {
          const next = v as "ADB" | "Serial";
          setMode(next);
          if (next === "Serial") fetchPorts();
        }}
        block
        style={{ marginBottom: 16 }}
      />

      {mode === "ADB" ? (
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
      ) : (
        <Form layout="vertical">
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
          <Form.Item label="Name (optional)">
            <Input
              value={serialName}
              onChange={(e) => setSerialName(e.target.value)}
              placeholder={selectedPort || "Device name"}
            />
          </Form.Item>
        </Form>
      )}
    </Modal>
  );
}
