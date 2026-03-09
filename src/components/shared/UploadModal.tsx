import { useState, useEffect, useCallback, useRef } from "react";
import { Modal, Input, Button, List, Typography, Space } from "antd";
import {
  InboxOutlined,
  FolderOpenOutlined,
  DeleteOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";

const { Text } = Typography;

interface UploadModalProps {
  open: boolean;
  onClose: () => void;
  defaultPath: string;
  onUpload: (localPaths: string[], remotePath: string) => Promise<void>;
}

export function UploadModal({
  open: isOpen,
  onClose,
  defaultPath,
  onUpload,
}: UploadModalProps) {
  const [files, setFiles] = useState<string[]>([]);
  const [remotePath, setRemotePath] = useState(defaultPath);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const dragCountRef = useRef(0);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setFiles([]);
      setRemotePath(defaultPath);
      setUploading(false);
      setDragOver(false);
      dragCountRef.current = 0;
    }
  }, [isOpen, defaultPath]);

  // Listen for Tauri drag-drop events when modal is open
  useEffect(() => {
    if (!isOpen) return;

    const unlisteners: Array<() => void> = [];

    listen("tauri://drag-enter", () => {
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
      if (event.payload.paths?.length) {
        setFiles((prev) => {
          const existing = new Set(prev);
          const newPaths = event.payload.paths.filter((p) => !existing.has(p));
          return [...prev, ...newPaths];
        });
      }
    }).then((fn) => unlisteners.push(fn));

    return () => {
      unlisteners.forEach((fn) => fn());
    };
  }, [isOpen]);

  const handleBrowse = async () => {
    const selected = await open({ multiple: true });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    setFiles((prev) => {
      const existing = new Set(prev);
      const newPaths = paths.filter((p) => !existing.has(p));
      return [...prev, ...newPaths];
    });
  };

  const handleRemoveFile = useCallback((path: string) => {
    setFiles((prev) => prev.filter((f) => f !== path));
  }, []);

  const handleUpload = async () => {
    if (files.length === 0 || !remotePath.trim()) return;
    setUploading(true);
    try {
      await onUpload(files, remotePath.trim());
      onClose();
    } catch (e) {
      // Error handling is done in the parent component
    } finally {
      setUploading(false);
    }
  };

  const getFileName = (path: string) => {
    const parts = path.replace(/\\/g, "/").split("/");
    return parts[parts.length - 1] || path;
  };

  return (
    <Modal
      open={isOpen}
      onCancel={onClose}
      title="Upload Files"
      width={560}
      destroyOnClose
      footer={
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {files.length} file{files.length !== 1 ? "s" : ""} selected
          </Text>
          <Space>
            <Button onClick={onClose}>Cancel</Button>
            <Button
              type="primary"
              icon={<UploadOutlined />}
              onClick={handleUpload}
              loading={uploading}
              disabled={files.length === 0 || !remotePath.trim()}
            >
              Upload
            </Button>
          </Space>
        </div>
      }
    >
      {/* Destination path */}
      <div style={{ marginBottom: 12 }}>
        <Text type="secondary" style={{ fontSize: 12, display: "block", marginBottom: 4 }}>
          Destination path on device
        </Text>
        <Input
          value={remotePath}
          onChange={(e) => setRemotePath(e.target.value)}
          placeholder="/sdcard"
          prefix={<FolderOpenOutlined style={{ color: "var(--text-secondary)" }} />}
        />
      </div>

      {/* Drop zone */}
      <div
        onClick={handleBrowse}
        style={{
          border: `2px dashed ${dragOver ? "var(--accent, #1677ff)" : "var(--border, #424242)"}`,
          borderRadius: 8,
          padding: "24px 16px",
          textAlign: "center",
          cursor: "pointer",
          background: dragOver ? "rgba(22, 119, 255, 0.06)" : "transparent",
          transition: "all 0.2s",
          marginBottom: 12,
        }}
      >
        <InboxOutlined style={{ fontSize: 36, color: dragOver ? "var(--accent, #1677ff)" : "var(--text-secondary, #999)" }} />
        <div style={{ marginTop: 8, color: "var(--text-secondary, #999)" }}>
          Click to browse or drag files here
        </div>
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div
          style={{
            maxHeight: 200,
            overflow: "auto",
            border: "1px solid var(--border, #424242)",
            borderRadius: 6,
          }}
        >
          <List
            size="small"
            dataSource={files}
            renderItem={(path) => (
              <List.Item
                style={{ padding: "4px 12px" }}
                actions={[
                  <Button
                    key="rm"
                    type="text"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveFile(path);
                    }}
                  />,
                ]}
              >
                <Text
                  ellipsis={{ tooltip: path }}
                  style={{ fontSize: 12, fontFamily: "monospace", flex: 1 }}
                >
                  {getFileName(path)}
                </Text>
              </List.Item>
            )}
          />
        </div>
      )}
    </Modal>
  );
}
