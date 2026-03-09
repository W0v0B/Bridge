import { useEffect, useState, useCallback, useRef } from "react";
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
  SearchOutlined,
} from "@ant-design/icons";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { HdcCatModal } from "./HdcCatModal";
import { useDeviceStore } from "../../store/deviceStore";
import {
  listHdcFiles,
  sendHdcFiles,
  recvHdcFile,
  deleteHdcFile,
} from "../../utils/hdc";
import { UploadModal } from "../shared/UploadModal";
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
  const deviceObj = allDevices.find((d) => d.id === selectedDeviceId && d.type === "ohos") ?? null;
  const connectKey = deviceObj?.serial ?? null;
  const isRemounted = deviceObj?.isRemounted ?? false;
  const remountInfo = deviceObj?.remountInfo ?? "";

  // Per-device path map
  const pathMap = useRef<Record<string, string>>({});
  const prevDeviceRef = useRef<string | null>(null);

  const [currentPath, setCurrentPathState] = useState("/data");
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [uploadModalOpen, setUploadModalOpen] = useState(false);

  // Multi-selection state
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cat modal for viewing files
  const [catOpen, setCatOpen] = useState(false);
  const [catFilePath, setCatFilePath] = useState("");

  // Drag-drop overlay
  const [dragOver, setDragOver] = useState(false);
  const dragCountRef = useRef(0);

  const setCurrentPath = useCallback((path: string) => {
    if (connectKey) {
      pathMap.current[connectKey] = path;
    }
    setCurrentPathState(path);
  }, [connectKey]);

  useEffect(() => {
    const prev = prevDeviceRef.current;
    if (prev && prev !== connectKey) {
      pathMap.current[prev] = currentPath;
    }
    if (connectKey && connectKey !== prev) {
      const restored = pathMap.current[connectKey] ?? "/data";
      setCurrentPathState(restored);
      setSelectedPaths(new Set());
      setSearchQuery("");
    }
    prevDeviceRef.current = connectKey;
  }, [connectKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadFiles = useCallback(async () => {
    if (!connectKey) return;
    setLoading(true);
    try {
      const entries = await listHdcFiles(connectKey, currentPath);
      setFiles(entries);
      setSelectedPaths(new Set());
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

  // --- Multi-selection click handlers ---
  const toggleSelection = useCallback((record: FileEntry) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(record.path)) {
        next.delete(record.path);
      } else {
        next.add(record.path);
      }
      return next;
    });
  }, []);

  const handleDoubleClick = useCallback((record: FileEntry) => {
    setSelectedPaths(new Set());
    if (record.is_dir) {
      navigateTo(record.path);
    } else {
      setCatFilePath(record.path);
      setCatOpen(true);
    }
  }, [navigateTo]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRowClick = useCallback((record: FileEntry) => {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
      handleDoubleClick(record);
    } else {
      clickTimerRef.current = setTimeout(() => {
        clickTimerRef.current = null;
        toggleSelection(record);
      }, 250);
    }
  }, [handleDoubleClick, toggleSelection]);

  useEffect(() => {
    return () => {
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    };
  }, []);

  // --- Drag-drop ---
  useEffect(() => {
    if (!connectKey) return;

    const unlisteners: Array<() => void> = [];

    listen("tauri://drag-enter", () => {
      if (uploadModalOpen) return;
      dragCountRef.current++;
      setDragOver(true);
    }).then((fn) => unlisteners.push(fn));

    listen("tauri://drag-leave", () => {
      dragCountRef.current--;
      if (dragCountRef.current <= 0) {
        dragCountRef.current = 0;
        setDragOver(false);
      }
    }).then((fn) => unlisteners.push(fn));

    listen<{ paths: string[] }>("tauri://drag-drop", (event) => {
      dragCountRef.current = 0;
      setDragOver(false);
      if (uploadModalOpen) return;
      if (event.payload.paths?.length && connectKey) {
        sendHdcFiles(connectKey, event.payload.paths, currentPath)
          .then(() => {
            message.success(`Uploading ${event.payload.paths.length} file(s)`);
            loadFiles();
          })
          .catch((e) => message.error(String(e)));
      }
    }).then((fn) => unlisteners.push(fn));

    return () => {
      unlisteners.forEach((fn) => fn());
      dragCountRef.current = 0;
      setDragOver(false);
    };
  }, [connectKey, currentPath, loadFiles, uploadModalOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Upload via modal ---
  const handleUpload = async (localPaths: string[], remotePath: string) => {
    if (!connectKey) return;
    try {
      await sendHdcFiles(connectKey, localPaths, remotePath);
      message.success(`Uploading ${localPaths.length} file(s)`);
      loadFiles();
    } catch (e) {
      message.error(String(e));
      throw e;
    }
  };

  // --- Batch download ---
  const selectedFiles = files.filter((f) => selectedPaths.has(f.path));

  const handleDownload = async () => {
    if (!connectKey || selectedFiles.length === 0) return;

    if (selectedFiles.length === 1 && !selectedFiles[0].is_dir) {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const savePath = await save({ defaultPath: selectedFiles[0].name });
      if (!savePath) return;
      try {
        await recvHdcFile(connectKey, selectedFiles[0].path, savePath);
        message.success("Download started");
      } catch (e) {
        message.error(String(e));
      }
    } else {
      const dir = await openDialog({ directory: true });
      if (!dir) return;
      const dirPath = typeof dir === "string" ? dir : Array.isArray(dir) ? dir[0] : null;
      if (!dirPath) return;
      try {
        for (const file of selectedFiles) {
          const localPath = `${dirPath}/${file.name}`;
          await recvHdcFile(connectKey, file.path, localPath);
        }
        message.success(`Downloaded ${selectedFiles.length} item(s)`);
      } catch (e) {
        message.error(String(e));
      }
    }
  };

  // --- Batch delete ---
  const handleDelete = async () => {
    if (!connectKey || selectedFiles.length === 0) return;
    try {
      for (const file of selectedFiles) {
        await deleteHdcFile(connectKey, file.path);
      }
      message.success(`Deleted ${selectedFiles.length} item(s)`);
      loadFiles();
    } catch (e) {
      message.error(String(e));
    }
  };

  const filteredFiles = searchQuery
    ? files.filter((f) => f.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : files;

  // Breadcrumb
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
        record.is_dir ? "\u2014" : humanSize(size),
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

  const hasSelection = selectedPaths.size > 0;

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
          <Button icon={<UploadOutlined />} onClick={() => setUploadModalOpen(true)}>
            Upload
          </Button>
          <Button
            icon={<DownloadOutlined />}
            disabled={!hasSelection}
            onClick={handleDownload}
          >
            Download{hasSelection ? ` (${selectedPaths.size})` : ""}
          </Button>
          <Popconfirm
            title={`Delete ${selectedPaths.size} item(s)?`}
            onConfirm={handleDelete}
            disabled={!hasSelection}
          >
            <Button icon={<DeleteOutlined />} danger disabled={!hasSelection}>
              Delete{hasSelection ? ` (${selectedPaths.size})` : ""}
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

      {/* File table with drag-drop overlay */}
      <div style={{ flex: 1, overflow: "auto", position: "relative" }}>
        {dragOver && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 10,
              background: "rgba(22, 119, 255, 0.08)",
              border: "2px dashed var(--accent, #1677ff)",
              borderRadius: 8,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "none",
            }}
          >
            <div style={{ textAlign: "center", color: "var(--accent, #1677ff)" }}>
              <UploadOutlined style={{ fontSize: 36 }} />
              <div style={{ marginTop: 8, fontSize: 14 }}>
                Drop files to upload to {currentPath}
              </div>
            </div>
          </div>
        )}

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
              cursor: "pointer",
              background: selectedPaths.has(record.path)
                ? "var(--selected-bg)"
                : undefined,
              userSelect: "none",
            },
          })}
        />
      </div>

      {/* Upload modal */}
      <UploadModal
        open={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        defaultPath={currentPath}
        onUpload={handleUpload}
      />

      {/* File viewer */}
      {connectKey && catFilePath && (
        <HdcCatModal
          open={catOpen}
          onClose={() => setCatOpen(false)}
          connectKey={connectKey}
          path={catFilePath}
        />
      )}
    </div>
  );
}
