import { Table, Button, Space } from "antd";
import { FolderOutlined, FileOutlined } from "@ant-design/icons";

export function FileManager() {
  const columns = [
    { title: "Name", dataIndex: "name", key: "name", render: (name: string, record: any) => (
      <Space><span>{record.isDir ? <FolderOutlined /> : <FileOutlined />}</span>{name}</Space>
    )},
    { title: "Size", dataIndex: "size", key: "size" },
    { title: "Modified", dataIndex: "modified", key: "modified" },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button>Upload</Button>
        <Button>Download</Button>
        <Button>New Folder</Button>
      </Space>
      <Table dataSource={[]} columns={columns} rowKey="name" />
    </div>
  );
}
