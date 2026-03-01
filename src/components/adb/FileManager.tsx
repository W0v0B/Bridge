import { useEffect, useState, useCallback } from "react";
import { Table, Button, Space, Breadcrumb, Popconfirm, message, Typography } from "antd";
import {
  FolderOutlined,
  FileOutlined,
  UploadOutlined,
  DownloadOutlined,
  DeleteOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useDeviceStore } from "../../store/deviceStore";
import { listFiles, pushFiles, pullFile, deleteFile } from "../../utils/adb";
import type { FileEntry } from "../../types/adb";

function humanSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + " " + units[i];
}

export function FileManager() {
  const selectedDeviceId = useDeviceStore((s) => s.selectedDeviceId);
  const allDevices = useDeviceStore((s) => s.devices);
  const selectedDevice = allDevices.find((d) => d.id === selectedDeviceId)?.serial ?? null;
  const [currentPath, setCurrentPath] = useState("/sdcard");
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<FileEntry | null>(null);

  const loadFiles = useCallback(async () => {
    if (!selectedDevice) return;
    setLoading(true);
    try {
      const entries = await listFiles(selectedDevice, currentPath);
      setFiles(entries);
      setSelectedFile(null);
    } catch (e) {
      message.error(String(e));
    } finally {
      setLoading(false);
    }
  }, [selectedDevice, currentPath]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  const navigateTo = (path: string) => {
    setCurrentPath(path);
  };

  const handleRowClick = (record: FileEntry) => {
    if (record.is_dir) {
      navigateTo(record.path);
    } else {
      setSelectedFile(record);
    }
  };

  const handleUpload = async () => {
    if (!selectedDevice) return;
    const selected = await open({ multiple: true });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    try {
      await pushFiles(selectedDevice, paths, currentPath);
      message.success("Upload started");
      loadFiles();
    } catch (e) {
      message.error(String(e));
    }
  };

  const handleDownload = async () => {
    if (!selectedDevice || !selectedFile) return;
    const savePath = await save({
      defaultPath: selectedFile.name,
    });
    if (!savePath) return;
    try {
      await pullFile(selectedDevice, selectedFile.path, savePath);
      message.success("Download started");
    } catch (e) {
      message.error(String(e));
    }
  };

  const handleDelete = async () => {
    if (!selectedDevice || !selectedFile) return;
    try {
      await deleteFile(selectedDevice, selectedFile.path);
      message.success("Deleted " + selectedFile.name);
      loadFiles();
    } catch (e) {
      message.error(String(e));
    }
  };

  // Build breadcrumb items from path segments
  const pathSegments = currentPath.split("/").filter(Boolean);
  const breadcrumbItems = [
    {
      title: <a onClick={() => navigateTo("/")}>/</a>,
      key: "/",
    },
    ...pathSegments.map((seg, idx) => {
      const path = "/" + pathSegments.slice(0, idx + 1).join("/");
      return {
        title: <a onClick={() => navigateTo(path)}>{seg}</a>,
        key: path,
      };
    }),
  ];

  const columns = [
    {
      title: "Name",
      dataIndex: "name",
      key: "name",
      render: (name: string, record: FileEntry) => (
        <Space>
          {record.is_dir ? (
            <FolderOutlined style={{ color: "#faad14" }} />
          ) : (
            <FileOutlined />
          )}
          {name}
        </Space>
      ),
    },
    {
      title: "Size",
      dataIndex: "size",
      key: "size",
      width: 100,
      render: (size: number, record: FileEntry) =>
        record.is_dir ? "-" : humanSize(size),
    },
    {
      title: "Permissions",
      dataIndex: "permissions",
      key: "permissions",
      width: 120,
    },
    {
      title: "Modified",
      dataIndex: "modified",
      key: "modified",
      width: 160,
    },
  ];

  if (!selectedDevice) {
    return (
      <Typography.Text type="secondary">
        Select a device to browse files
      </Typography.Text>
    );
  }

  return (
    <div>
      <Breadcrumb items={breadcrumbItems} style={{ marginBottom: 12 }} />

      <Space style={{ marginBottom: 12 }}>
        <Button icon={<UploadOutlined />} onClick={handleUpload}>
          Upload
        </Button>
        <Button
          icon={<DownloadOutlined />}
          disabled={!selectedFile || selectedFile.is_dir}
          onClick={handleDownload}
        >
          Download
        </Button>
        <Popconfirm
          title={`Delete ${selectedFile?.name}?`}
          onConfirm={handleDelete}
          disabled={!selectedFile}
        >
          <Button
            icon={<DeleteOutlined />}
            danger
            disabled={!selectedFile}
          >
            Delete
          </Button>
        </Popconfirm>
        <Button icon={<ReloadOutlined />} onClick={loadFiles}>
          Refresh
        </Button>
      </Space>

      <Table
        dataSource={files}
        columns={columns}
        rowKey="path"
        size="small"
        loading={loading}
        pagination={false}
        onRow={(record) => ({
          onClick: () => handleRowClick(record),
          style: {
            cursor: record.is_dir ? "pointer" : "default",
            background:
              selectedFile?.path === record.path
                ? "#e6f4ff"
                : undefined,
          },
        })}
      />
    </div>
  );
}
