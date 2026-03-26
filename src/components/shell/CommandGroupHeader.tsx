import { useState, useRef, useEffect } from "react";
import { Button, Dropdown, Input, Tooltip, Typography, type InputRef } from "antd";
import {
  RightOutlined,
  DownOutlined,
  FolderOutlined,
  FolderOpenOutlined,
  PlusOutlined,
  MoreOutlined,
} from "@ant-design/icons";
import type { CommandGroup } from "../../store/commandStore";

const { Text } = Typography;

interface CommandGroupHeaderProps {
  group: CommandGroup;
  commandCount: number;
  onToggleCollapse: () => void;
  onRename: (label: string) => void;
  onDelete: () => void;
  onAddCommand: () => void;
}

export function CommandGroupHeader({
  group,
  commandCount,
  onToggleCollapse,
  onRename,
  onDelete,
  onAddCommand,
}: CommandGroupHeaderProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(group.label);
  const [hovered, setHovered] = useState(false);
  const inputRef = useRef<InputRef>(null);

  // Keep editValue in sync if label changes externally
  useEffect(() => {
    if (!editing) setEditValue(group.label);
  }, [group.label, editing]);

  const commitRename = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== group.label) onRename(trimmed);
    else setEditValue(group.label);
    setEditing(false);
  };

  const startEditing = () => {
    setEditValue(group.label);
    setEditing(true);
    // Focus after render
    setTimeout(() => inputRef.current?.focus?.(), 0);
  };

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "4px 6px",
        marginBottom: 2,
        marginTop: 4,
        borderRadius: 4,
        background: hovered ? "var(--border)" : "var(--card-bg)",
        cursor: "pointer",
        userSelect: "none",
      }}
    >
      {/* Collapse toggle — left side clickable */}
      <div
        onClick={onToggleCollapse}
        style={{ display: "flex", alignItems: "center", gap: 4, flex: 1, minWidth: 0 }}
      >
        <span style={{ fontSize: 10, color: "var(--text-secondary)", flexShrink: 0 }}>
          {group.collapsed ? <RightOutlined /> : <DownOutlined />}
        </span>
        <span style={{ fontSize: 13, color: "#e6a817", flexShrink: 0 }}>
          {group.collapsed ? <FolderOutlined /> : <FolderOpenOutlined />}
        </span>
        {editing ? (
          <Input
            ref={inputRef}
            size="small"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onPressEnter={commitRename}
            onBlur={commitRename}
            onClick={(e) => e.stopPropagation()}
            style={{ height: 20, padding: "0 4px", fontSize: 12, flex: 1 }}
          />
        ) : (
          <Text
            strong
            style={{ fontSize: 12, flex: 1, minWidth: 0 }}
            ellipsis
            onDoubleClick={(e) => { e.stopPropagation(); startEditing(); }}
          >
            {group.label}
          </Text>
        )}
        {!editing && (
          <Text type="secondary" style={{ fontSize: 10, flexShrink: 0 }}>
            {commandCount}
          </Text>
        )}
      </div>

      {/* Action buttons — only visible on hover */}
      {!editing && (
        <div
          style={{ display: "flex", gap: 2, opacity: hovered ? 1 : 0, transition: "opacity 0.15s" }}
          onClick={(e) => e.stopPropagation()}
        >
          <Tooltip title="Add command to group">
            <Button
              size="small"
              icon={<PlusOutlined />}
              onClick={onAddCommand}
              style={{ width: 20, height: 20, minWidth: 20, padding: 0, fontSize: 10 }}
            />
          </Tooltip>
          <Dropdown
            trigger={["click"]}
            menu={{
              items: [
                { key: "rename", label: "Rename" },
                { key: "delete", label: "Delete Group", danger: true },
              ],
              onClick: ({ key }) => {
                if (key === "rename") startEditing();
                if (key === "delete") onDelete();
              },
            }}
          >
            <Button
              size="small"
              icon={<MoreOutlined />}
              style={{ width: 20, height: 20, minWidth: 20, padding: 0, fontSize: 10 }}
            />
          </Dropdown>
        </div>
      )}
    </div>
  );
}
