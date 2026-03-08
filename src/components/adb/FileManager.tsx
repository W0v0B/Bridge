import { useEffect, useState, useCallback } from "react";
import { App, Table, Button, Space, Popconfirm, Typography, Tag, Tooltip, Input } from "antd";
import {
  FolderOutlined,
  FileOutlined,
  UploadOutlined,
  DownloadOutlined,
  DeleteOutlined,
  ReloadOutlined,
  EyeOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { CatModal } from "./CatModal";
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
  const { message } = App.useApp();
  const selectedDeviceId = useDeviceStore((s) => s.selectedDeviceId);
  const allDevices = useDeviceStore((s) => s.devices);
  const deviceObj = allDevices.find((d) => d.id === selectedDeviceId) ?? null;
  const selectedDevice = deviceObj?.serial ?? null;
  const isRoot = deviceObj?.isRoot ?? false;
  const rootInfo = deviceObj?.rootInfo ?? "";
  const isRemounted = deviceObj?.isRemounted ?? false;
  const remountInfo = deviceObj?.remountInfo ?? "";

  const [currentPath, setCurrentPath] = useState("/sdcard");
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<FileEntry | null>(null);
  const [catOpen, setCatOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

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
    setSearchQuery("");
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

  const filteredFiles = searchQuery
    ? files.filter((f) => f.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : files;

  // Build breadcrumb items from path segments
  const pathSegments = currentPath.split("/").filter(Boolean);
  const pathLinks = [
    <Typography.Link key="/" onClick={() => navigateTo("/")}>/</Typography.Link>,
    ...pathSegments.map((seg, idx) => {
      const path = "/" + pathSegments.slice(0, idx + 1).join("/");
      return (
        <Typography.Link key={path} onClick={() => navigateTo(path)}>{seg}/</Typography.Link>
      );
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
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", padding: "0 12px 12px" }}>
      {/* Fixed header: path + toolbar */}
      <div style={{ flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          {pathLinks}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <Space>
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
            <Button
              icon={<EyeOutlined />}
              disabled={!selectedFile}
              onClick={() => setCatOpen(true)}
            >
              View
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
            <Input
              prefix={<SearchOutlined />}
              placeholder="Filter by name…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              allowClear
              style={{ width: 220 }}
            />
            <Tooltip title="Refresh">
              <Button icon={<ReloadOutlined />} onClick={loadFiles} loading={loading} />
            </Tooltip>
          </Space>

          <Space size={4}>
            {/* Root tag */}
            {(() => {
              const checking = !isRoot && rootInfo === "";
              const label = checking ? "checking..." : isRoot ? "root" : "no root";
              const color = isRoot ? "warning" : "default";
              const tip = isRoot
                ? "Running as root"
                : checking
                ? "Checking root status…"
                : rootInfo || "Not running as root";
              return (
                <Tooltip title={tip}>
                  <Tag color={color} style={{ cursor: "default", userSelect: "none" }}>
                    {label}
                  </Tag>
                </Tooltip>
              );
            })()}
            {/* Remount tag */}
            {(() => {
              const checking = isRoot && !isRemounted && remountInfo === "";
              const unavailable = !isRoot && rootInfo !== "";
              const label = isRemounted
                ? "remounted"
                : checking
                ? "checking..."
                : unavailable
                ? "read-only"
                : "remount failed";
              const color = isRemounted
                ? "processing"
                : !isRemounted && remountInfo !== "" && !unavailable
                ? "error"
                : "default";
              const tip = isRemounted
                ? "System partition is remounted (writable)"
                : checking
                ? "Remount in progress…"
                : unavailable
                ? "Remount requires root access"
                : `Remount failed: ${remountInfo}`;
              return (
                <Tooltip title={tip}>
                  <Tag color={color} style={{ cursor: "default", userSelect: "none" }}>
                    {label}
                  </Tag>
                </Tooltip>
              );
            })()}
          </Space>
        </div>
      </div>

      {/* Scrollable file list */}
      <div style={{ flex: 1, overflow: "auto" }}>
        <Table
          dataSource={filteredFiles}
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

      {selectedDevice && selectedFile && (
        <CatModal
          open={catOpen}
          onClose={() => setCatOpen(false)}
          serial={selectedDevice}
          path={selectedFile.path}
        />
      )}
    </div>
  );
}
