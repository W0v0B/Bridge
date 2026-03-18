import { useState, useCallback, useRef, useEffect } from "react";
import { List, Progress } from "antd";
import { useTransferEvents } from "../../hooks/useAdbEvents";
import type { TransferProgress } from "../../types/adb";

export function TransferQueue() {
  const [transfers, setTransfers] = useState<Map<string, TransferProgress>>(
    new Map()
  );
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  );

  const handleProgress = useCallback((progress: TransferProgress) => {
    setTransfers((prev) => {
      const next = new Map(prev);
      next.set(progress.id, progress);
      return next;
    });

    // Auto-remove completed or failed transfers after 3 seconds
    if (progress.percent >= 100 || progress.percent < 0) {
      const existing = timersRef.current.get(progress.id);
      if (existing) clearTimeout(existing);

      timersRef.current.set(
        progress.id,
        setTimeout(() => {
          setTransfers((prev) => {
            const next = new Map(prev);
            next.delete(progress.id);
            return next;
          });
          timersRef.current.delete(progress.id);
        }, 3000)
      );
    }
  }, []);

  useTransferEvents(handleProgress);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      timersRef.current.forEach((t) => clearTimeout(t));
    };
  }, []);

  const items = Array.from(transfers.values());

  if (items.length === 0) return null;

  return (
    <div
      style={{
        padding: "8px 16px",
        background: "var(--content-bg)",
        borderTop: "1px solid var(--border)",
      }}
    >
      <List
        size="small"
        dataSource={items}
        renderItem={(item) => (
          <List.Item style={{ padding: "4px 0" }}>
            <List.Item.Meta
              title={
                <span style={{ fontSize: 12 }}>{item.file_name}</span>
              }
            />
            <Progress
              percent={item.percent < 0 ? 100 : Math.round(item.percent)}
              size="small"
              style={{ width: 200 }}
              status={item.percent < 0 ? "exception" : item.percent >= 100 ? "success" : "active"}
              trailColor="var(--card-bg)"
            />
          </List.Item>
        )}
      />
    </div>
  );
}
