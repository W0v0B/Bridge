import { useEffect, useState, useCallback } from "react";
import {
  App,
  Table,
  Button,
  Space,
  Popconfirm,
  Typography,
  Tooltip,
  Input,
  Tag,
} from "antd";
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
import { open, save } from "@tauri-apps/plugin-dialog";
import { HdcCatModal } from "./HdcCatModal";
import { useDeviceStore } from "../../store/deviceStore";
import {
  listHdcFiles,
  sendHdcFiles,
  recvHdcFile,
  deleteHdcFile,
} from "../../utils/hdc";
import type { FileEntry } from "../../types/adb";

const { Text, Link } = Typography;

function humanSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + " " + units[i];
}

export function HdcFileManager() {
  const { message } = App.useApp();
  const selectedDeviceId = useDeviceStore((s) => s.selectedDeviceId);
  const allDevices = useDeviceStore((s) => s.devices);
  const deviceObj = allDevices.find((d) => d.id === selectedDeviceId) ?? null;
  const connectKey = deviceObj?.serial ?? null;
  const isRemounted = deviceObj?.isRemounted ?? false;
  const remountInfo = deviceObj?.remountInfo ?? "";

  const [currentPath, setCurrentPath] = useState("/data");
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<FileEntry | null>(null);
  const [catOpen, setCatOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const loadFiles = useCallback(async () => {
    if (!connectKey) return;
    setLoading(true);
    try {
      const entries = await listHdcFiles(connectKey, currentPath);
      setFiles(entries);
      setSelectedFile(null);
    } catch (e) {
      message.error(String(e));
    } finally {
      setLoading(false);
    }
  }, [connectKey, currentPath]);

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
    if (!connectKey) return;
    const selected = await open({ multiple: true });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    try {
      await sendHdcFiles(connectKey, paths, currentPath);
      message.success("Upload started");
      loadFiles();
    } catch (e) {
      message.error(String(e));
    }
  };

  const handleDownload = async () => {
    if (!connectKey || !selectedFile) return;
    const savePath = await save({ defaultPath: selectedFile.name });
    if (!savePath) return;
    try {
      await recvHdcFile(connectKey, selectedFile.path, savePath);
      message.success("Download started");
    } catch (e) {
      message.error(String(e));
    }
  };

  const handleDelete = async () => {
    if (!connectKey || !selectedFile) return;
    try {
      await deleteHdcFile(connectKey, selectedFile.path);
      message.success(`Deleted ${selectedFile.name}`);
      setSelectedFile(null);
      loadFiles();
    } catch (e) {
      message.error(String(e));
    }
  };

  const filteredFiles = searchQuery
    ? files.filter((f) => f.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : files;

  // Build breadcrumb path links
  const pathSegments = currentPath.split("/").filter(Boolean);
  const pathLinks = [
    <Link key="/" onClick={() => navigateTo("/")}>/</Link>,
    ...pathSegments.map((seg, idx) => {
      const p = "/" + pathSegments.slice(0, idx + 1).join("/");
      return (
        <Link key={p} onClick={() => navigateTo(p)}>{seg}/</Link>
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
        record.is_dir ? "—" : humanSize(size),
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

  if (!connectKey) {
    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text type="secondary" style={{ fontSize: 16 }}>
          Select an OHOS device from the sidebar to browse files
        </Text>
      </div>
    );
  }

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        padding: "0 12px 12px",
      }}
    >
      {/* Breadcrumb path */}
      <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 4, marginBottom: 8 }}>
        {pathLinks}
      </div>

      {/* Toolbar */}
      <div
        style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 8,
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <Space wrap>
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
            disabled={!selectedFile || selectedFile.is_dir}
            onClick={() => setCatOpen(true)}
          >
            View
          </Button>
          <Popconfirm
            title={`Delete ${selectedFile?.name}?`}
            onConfirm={handleDelete}
            disabled={!selectedFile}
          >
            <Button icon={<DeleteOutlined />} danger disabled={!selectedFile}>
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

        {/* Remount status */}
        {(() => {
          const checking = !isRemounted && remountInfo === "";
          const label = checking ? "checking..." : isRemounted ? "remounted" : "remount failed";
          const color = isRemounted ? "processing" : checking ? "default" : "error";
          const tip = isRemounted
            ? "System partition is remounted (writable)"
            : checking
            ? "Auto-remount in progress…"
            : `Remount failed: ${remountInfo}`;
          return (
            <Tooltip title={tip}>
              <Tag color={color} style={{ cursor: "default", userSelect: "none" }}>
                {label}
              </Tag>
            </Tooltip>
          );
        })()}
      </div>

      {/* File table */}
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
                selectedFile?.path === record.path ? "#e6f4ff" : undefined,
            },
          })}
        />
      </div>

      {connectKey && selectedFile && !selectedFile.is_dir && (
        <HdcCatModal
          open={catOpen}
          onClose={() => setCatOpen(false)}
          connectKey={connectKey}
          path={selectedFile.path}
        />
      )}
    </div>
  );
}
