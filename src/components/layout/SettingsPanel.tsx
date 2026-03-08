import { Drawer, Typography } from "antd";
import { useConfigStore } from "../../store/configStore";
import { THEMES, THEME_ORDER } from "../../theme";
import type { ThemeId } from "../../theme";

const { Text } = Typography;

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

function ThemeSwatch({ id }: { id: ThemeId }) {
  const t = THEMES[id];
  const currentTheme = useConfigStore((s) => s.config.theme);
  const setConfig = useConfigStore((s) => s.setConfig);
  const selected = currentTheme === id;

  return (
    <div
      onClick={() => setConfig({ theme: id })}
      title={t.label}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
        cursor: "pointer",
      }}
    >
      {/* Mini window preview */}
      <div
        style={{
          width: 72,
          height: 52,
          borderRadius: 6,
          overflow: "hidden",
          border: selected
            ? `2px solid ${t.swatch}`
            : "2px solid transparent",
          boxShadow: selected
            ? `0 0 0 1px ${t.swatch}40`
            : "0 1px 4px rgba(0,0,0,0.18)",
          transition: "border-color 0.15s, box-shadow 0.15s",
          flexShrink: 0,
        }}
      >
        {/* Titlebar strip */}
        <div
          style={{
            height: 12,
            background: t.css["--tb-bg"],
            borderBottom: `1px solid ${t.css["--border"]}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 3,
            paddingRight: 4,
          }}
        >
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: t.css["--border"] }} />
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: t.css["--border"] }} />
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#e81123" }} />
        </div>
        {/* Body: sidebar + content */}
        <div style={{ display: "flex", height: "calc(100% - 13px)" }}>
          <div
            style={{
              width: 18,
              background: t.css["--sidebar-bg"],
              borderRight: `1px solid ${t.css["--border"]}`,
              display: "flex",
              flexDirection: "column",
              gap: 3,
              padding: "4px 3px",
            }}
          >
            <div style={{ height: 3, borderRadius: 2, background: t.swatch, opacity: 0.9 }} />
            <div style={{ height: 3, borderRadius: 2, background: t.css["--border"] }} />
            <div style={{ height: 3, borderRadius: 2, background: t.css["--border"] }} />
          </div>
          <div style={{ flex: 1, background: t.css["--content-bg"] }} />
        </div>
      </div>

      <Text
        style={{
          fontSize: 11,
          color: selected ? t.swatch : "var(--text-secondary)",
          fontWeight: selected ? 600 : 400,
          transition: "color 0.15s",
          whiteSpace: "nowrap",
        }}
      >
        {t.label}
      </Text>
    </div>
  );
}

export function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  return (
    <Drawer
      title="Settings"
      placement="left"
      width={280}
      open={open}
      onClose={onClose}
      styles={{ body: { padding: "16px 20px" } }}
    >
      <div style={{ marginBottom: 16 }}>
        <Text
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: 0.5,
            color: "var(--text-secondary)",
            display: "block",
            marginBottom: 12,
          }}
        >
          Appearance
        </Text>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: "16px 8px",
          }}
        >
          {THEME_ORDER.map((id) => (
            <ThemeSwatch key={id} id={id} />
          ))}
        </div>
      </div>
    </Drawer>
  );
}
