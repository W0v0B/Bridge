import { useState, useEffect, useRef, useCallback } from "react";
import {
  Modal,
  Radio,
  InputNumber,
  Switch,
  Button,
  Space,
  Alert,
  Spin,
  Typography,
} from "antd";
import { CopyOutlined, ReloadOutlined } from "@ant-design/icons";
import { runShellCommand } from "../../utils/adb";

interface CatModalProps {
  open: boolean;
  onClose: () => void;
  serial: string;
  path: string;
}

export function CatModal({ open, onClose, serial, path }: CatModalProps) {
  const [output, setOutput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sizeKB, setSizeKB] = useState(8);
  const [viewMode, setViewMode] = useState<"text" | "hex">("text");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [intervalSec, setIntervalSec] = useState(2);
  const [lastUpdated, setLastUpdated] = useState("");
  const [byteCount, setByteCount] = useState(0);

  // Refs so fetchContent doesn't need to re-bind when settings change
  const sizeKBRef = useRef(sizeKB);
  sizeKBRef.current = sizeKB;
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;
  const loadingRef = useRef(false);

  const fetchContent = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError(null);

    const maxBytes = sizeKBRef.current * 1024;
    const cmd =
      viewModeRef.current === "hex"
        ? `xxd -l ${maxBytes} "${path}" 2>&1`
        : `head -c ${maxBytes} "${path}" 2>&1`;

    try {
      const result = await runShellCommand(serial, cmd);
      setOutput(result);
      setByteCount(result.length);
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (e) {
      setError(String(e));
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [serial, path]);

  // Fetch on open
  useEffect(() => {
    fetchContent();
  }, [fetchContent]);

  // Auto-refresh interval
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(fetchContent, intervalSec * 1000);
    return () => clearInterval(id);
  }, [autoRefresh, intervalSec, fetchContent]);

  const truncated = byteCount > 0 && byteCount >= sizeKBRef.current * 1024 * 0.95;
  const parts = path.split("/").filter(Boolean);
  const fileName = parts[parts.length - 1] ?? path;

  const handleCopy = () => {
    navigator.clipboard.writeText(output).catch(() => {});
  };

  const footer = (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {byteCount > 0
          ? `${byteCount.toLocaleString()} chars · ${lastUpdated}`
          : lastUpdated || "—"}
      </Typography.Text>
      <Space>
        <Button size="small" icon={<CopyOutlined />} onClick={handleCopy} disabled={!output}>
          Copy
        </Button>
        <Button size="small" icon={<ReloadOutlined />} onClick={fetchContent} loading={loading}>
          Refresh
        </Button>
        <Button size="small" onClick={onClose}>
          Close
        </Button>
      </Space>
    </div>
  );

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={fileName}
      width={720}
      footer={footer}
      destroyOnClose
      maskClosable
    >
      {/* Settings */}
      <Space wrap style={{ marginBottom: 10 }}>
        <Radio.Group
          value={viewMode}
          onChange={(e) => setViewMode(e.target.value)}
          size="small"
          optionType="button"
          buttonStyle="solid"
          options={[
            { label: "Text", value: "text" },
            { label: "Hex (xxd)", value: "hex" },
          ]}
        />
        <Space size={4}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>Limit:</Typography.Text>
          <InputNumber
            size="small"
            min={1}
            max={512}
            value={sizeKB}
            onChange={(v) => v !== null && setSizeKB(v)}
            style={{ width: 70 }}
            addonAfter="KB"
          />
        </Space>
        <Space size={4}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>Auto-refresh:</Typography.Text>
          <Switch size="small" checked={autoRefresh} onChange={setAutoRefresh} />
          {autoRefresh && (
            <>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>every</Typography.Text>
              <InputNumber
                size="small"
                min={1}
                max={60}
                value={intervalSec}
                onChange={(v) => v !== null && setIntervalSec(v)}
                style={{ width: 60 }}
                addonAfter="s"
              />
            </>
          )}
        </Space>
      </Space>

      {/* Truncation warning */}
      {truncated && (
        <Alert
          type="warning"
          showIcon
          message={`Output truncated at ${sizeKB} KB — increase the limit to see more`}
          style={{ marginBottom: 8, fontSize: 12 }}
        />
      )}

      {/* Output area */}
      <div style={{ position: "relative" }}>
        {loading && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(0,0,0,0.15)",
              zIndex: 1,
            }}
          >
            <Spin />
          </div>
        )}
        {error ? (
          <Alert type="error" message={error} />
        ) : (
          <pre
            style={{
              margin: 0,
              padding: "8px 10px",
              height: 420,
              overflow: "auto",
              background: "var(--card-bg)",
              borderRadius: 4,
              border: "1px solid var(--border)",
              color: "var(--text-primary)",
              fontFamily: "monospace",
              fontSize: 12,
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
            }}
          >
            {output || (loading ? "" : "(empty)")}
          </pre>
        )}
      </div>
    </Modal>
  );
}
