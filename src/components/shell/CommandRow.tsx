import { useState, useMemo } from "react";
import { Button, Dropdown, InputNumber, Tag, Tooltip, Typography } from "antd";
import { SendOutlined, MoreOutlined } from "@ant-design/icons";
import type { CommandGroup, QuickCommand } from "../../store/commandStore";

const UNGROUPED_KEY = "__ungrouped__";

const { Text } = Typography;

interface CommandRowProps {
  cmd: QuickCommand;
  groups: CommandGroup[];
  indented?: boolean;
  onSend: (command: string, scriptPath?: string) => void;
  onDelete: () => void;
  onSetSequenceOrder: (order: number | undefined) => void;
  onMove: (groupId: string | undefined) => void;
}

export function CommandRow({
  cmd,
  groups,
  indented,
  onSend,
  onDelete,
  onSetSequenceOrder,
  onMove,
}: CommandRowProps) {
  const [hovered, setHovered] = useState(false);

  const moveItems = useMemo(() => [
    { key: UNGROUPED_KEY, label: "Ungrouped", disabled: cmd.groupId === undefined },
    ...groups.map((g) => ({ key: g.id, label: g.label, disabled: cmd.groupId === g.id })),
  ], [cmd.groupId, groups]);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 8px",
        paddingLeft: indented ? 24 : 8,
        marginBottom: 3,
        borderRadius: 6,
        border: "1px solid var(--border)",
        background: hovered ? "var(--border)" : "var(--card-bg)",
        transition: "background 0.1s",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <Text strong style={{ fontSize: 13 }}>{cmd.label}</Text>
          {cmd.scriptPath && (
            <Tag color="purple" style={{ fontSize: 10, lineHeight: "16px", padding: "0 4px" }}>
              script
            </Tag>
          )}
        </div>
        <Text
          type="secondary"
          style={{ fontSize: 11, fontFamily: "monospace", display: "block" }}
          ellipsis
        >
          {cmd.scriptPath ?? cmd.command}
        </Text>
      </div>
      <Tooltip title="Sequence order (blank = skip)">
        <InputNumber
          size="small"
          min={1}
          value={cmd.sequenceOrder ?? null}
          onChange={(v) => onSetSequenceOrder(v ?? undefined)}
          placeholder="#"
          style={{ width: 44 }}
        />
      </Tooltip>
      <Button
        size="small"
        type="primary"
        icon={<SendOutlined />}
        onClick={() => onSend(cmd.command, cmd.scriptPath)}
      />
      <Dropdown
        trigger={["click"]}
        menu={{
          items: [
            {
              key: "move",
              label: "Move to",
              children: moveItems,
            },
            { type: "divider" },
            { key: "delete", label: "Delete", danger: true },
          ],
          onClick: ({ key }) => {
            if (key === "delete") { onDelete(); return; }
            if (key === UNGROUPED_KEY) { onMove(undefined); return; }
            onMove(key);
          },
        }}
      >
        <Button size="small" icon={<MoreOutlined />} />
      </Dropdown>
    </div>
  );
}
