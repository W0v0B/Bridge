import { useEffect, useState, useCallback, useRef } from "react";
import { App, Table, Button, Space, Popconfirm, Typography, Tag, Tooltip, Input } from "antd";
import {
  FolderOutlined,
  FileOutlined,
  UploadOutlined,
  DownloadOutlined,
  DeleteOutlined,
  ReloadOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { CatModal } from "./CatModal";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { useDeviceStore } from "../../store/deviceStore";
import { listFiles, pushFiles, pullFile, deleteFile } from "../../utils/adb";
import { UploadModal } from "../shared/UploadModal";
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
  const deviceObj = allDevices.find((d) => d.id === selectedDeviceId && d.type === "adb") ?? null;
  const selectedDevice = deviceObj?.serial ?? null;
  const isRoot = deviceObj?.isRoot ?? false;
  const rootInfo = deviceObj?.rootInfo ?? "";
  const isRemounted = deviceObj?.isRemounted ?? false;
  const remountInfo = deviceObj?.remountInfo ?? "";

  // Per-device path map
  const pathMap = useRef<Record<string, string>>({});
  const prevDeviceRef = useRef<string | null>(null);

  const [currentPath, setCurrentPathState] = useState("/sdcard");
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [uploadModalOpen, setUploadModalOpen] = useState(false);

  // Multi-selection state
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cat modal for viewing files
  const [catOpen, setCatOpen] = useState(false);
  const [catPath, setCatPath] = useState("");

  // Drag-drop overlay
  const [dragOver, setDragOver] = useState(false);
  const dragCountRef = useRef(0);

  const setCurrentPath = useCallback((path: string) => {
    if (selectedDevice) {
      pathMap.current[selectedDevice] = path;
    }
    setCurrentPathState(path);
  }, [selectedDevice]);

  useEffect(() => {
    const prev = prevDeviceRef.current;
    if (prev && prev !== selectedDevice) {
      pathMap.current[prev] = currentPath;
    }
    if (selectedDevice && selectedDevice !== prev) {
      const restored = pathMap.current[selectedDevice] ?? "/sdcard";
      setCurrentPathState(restored);
      setSelectedPaths(new Set());
      setSearchQuery("");
    }
    prevDeviceRef.current = selectedDevice;
  }, [selectedDevice]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadFiles = useCallback(async () => {
    if (!selectedDevice) return;
    setLoading(true);
    try {
      const entries = await listFiles(selectedDevice, currentPath);
      setFiles(entries);
      setSelectedPaths(new Set());
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
    // Clear all selections before opening
    setSelectedPaths(new Set());
    if (record.is_dir) {
      navigateTo(record.path);
    } else {
      // Open file viewer
      setCatPath(record.path);
      setCatOpen(true);
    }
  }, [navigateTo]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRowClick = useCallback((record: FileEntry) => {
    // Debounce: wait to see if this becomes a double-click
    if (clickTimerRef.current) {
      // Second click within timer = double-click
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

  // Cleanup click timer on unmount
  useEffect(() => {
    return () => {
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    };
  }, []);

  // --- Drag-drop for direct upload to current directory ---
  useEffect(() => {
    if (!selectedDevice) return;

    const unlisteners: Array<() => void> = [];

    listen("tauri://drag-enter", () => {
      // Don't show drag overlay if upload modal is open (modal handles its own drag)
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
      if (event.payload.paths?.length && selectedDevice) {
        pushFiles(selectedDevice, event.payload.paths, currentPath)
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
  }, [selectedDevice, currentPath, loadFiles, uploadModalOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Upload via modal ---
  const handleUpload = async (localPaths: string[], remotePath: string) => {
    if (!selectedDevice) return;
    try {
      await pushFiles(selectedDevice, localPaths, remotePath);
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
    if (!selectedDevice || selectedFiles.length === 0) return;

    if (selectedFiles.length === 1 && !selectedFiles[0].is_dir) {
      // Single file: save dialog
      const { save } = await import("@tauri-apps/plugin-dialog");
      const savePath = await save({ defaultPath: selectedFiles[0].name });
      if (!savePath) return;
      try {
        await pullFile(selectedDevice, selectedFiles[0].path, savePath);
        message.success("Download started");
      } catch (e) {
        message.error(String(e));
      }
    } else {
      // Multiple files or folders: pick directory
      const dir = await openDialog({ directory: true });
      if (!dir) return;
      const dirPath = typeof dir === "string" ? dir : Array.isArray(dir) ? dir[0] : null;
      if (!dirPath) return;
      try {
        for (const file of selectedFiles) {
          const localPath = `${dirPath}/${file.name}`;
          await pullFile(selectedDevice, file.path, localPath);
        }
        message.success(`Downloaded ${selectedFiles.length} item(s)`);
      } catch (e) {
        message.error(String(e));
      }
    }
  };

  // --- Batch delete ---
  const handleDelete = async () => {
    if (!selectedDevice || selectedFiles.length === 0) return;
    try {
      for (const file of selectedFiles) {
        await deleteFile(selectedDevice, file.path);
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

  const hasSelection = selectedPaths.size > 0;

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", padding: "0 12px 12px" }}>
      {/* Fixed header: path + toolbar */}
      <div style={{ flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          {pathLinks}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <Space>
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
              <Button
                icon={<DeleteOutlined />}
                danger
                disabled={!hasSelection}
              >
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

      {/* Scrollable file list with drag-drop overlay */}
      <div style={{ flex: 1, overflow: "auto", position: "relative" }}>
        {/* Drag-drop overlay */}
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
      {selectedDevice && catPath && (
        <CatModal
          open={catOpen}
          onClose={() => setCatOpen(false)}
          serial={selectedDevice}
          path={catPath}
        />
      )}
    </div>
  );
}
