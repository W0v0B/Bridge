import { Table } from "antd";
import { useDeviceStore } from "../../store/deviceStore";

export function DeviceList() {
  const devices = useDeviceStore((s) => s.devices);

  const columns = [
    { title: "Serial", dataIndex: "serial", key: "serial" },
    { title: "Model", dataIndex: "model", key: "model" },
    { title: "Status", dataIndex: "status", key: "status" },
  ];

  return <Table dataSource={devices} columns={columns} rowKey="serial" />;
}
