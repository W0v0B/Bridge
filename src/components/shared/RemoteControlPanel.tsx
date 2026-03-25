import { Button, Tooltip, Typography } from "antd";
import {
  ArrowUpOutlined,
  ArrowDownOutlined,
  ArrowLeftOutlined,
  ArrowRightOutlined,
  HomeOutlined,
  RollbackOutlined,
  MenuOutlined,
  SoundOutlined,
  PoweroffOutlined,
  CheckOutlined,
} from "@ant-design/icons";

const { Text } = Typography;

export const KEYCODE_HOME = 3;
export const KEYCODE_BACK = 4;
export const KEYCODE_DPAD_UP = 19;
export const KEYCODE_DPAD_DOWN = 20;
export const KEYCODE_DPAD_LEFT = 21;
export const KEYCODE_DPAD_RIGHT = 22;
export const KEYCODE_DPAD_CENTER = 23;
export const KEYCODE_VOLUME_UP = 24;
export const KEYCODE_VOLUME_DOWN = 25;
export const KEYCODE_POWER = 26;
export const KEYCODE_MENU = 82;


interface RemoteControlPanelProps {
  disabled: boolean;
  onSendKey: (keyCode: number) => Promise<void>;
}

export function RemoteControlPanel({ disabled, onSendKey }: RemoteControlPanelProps) {
  return (
    <div style={{
      width: 180,
      flexShrink: 0,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 10,
      paddingLeft: 12,
      borderLeft: "1px solid rgba(255,255,255,0.08)",
    }}>
      <Text type="secondary" style={{ fontSize: 11, letterSpacing: 1 }}>REMOTE</Text>

      {/* D-pad grid: 3x3, corners empty */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 44px)", gridTemplateRows: "repeat(3, 44px)", gap: 4 }}>
        {/* Row 1 */}
        <div />
        <Tooltip title="Up"><Button size="small" icon={<ArrowUpOutlined />} disabled={disabled} onClick={() => onSendKey(KEYCODE_DPAD_UP)} style={{ width: 44, height: 44 }} /></Tooltip>
        <div />
        {/* Row 2 */}
        <Tooltip title="Left"><Button size="small" icon={<ArrowLeftOutlined />} disabled={disabled} onClick={() => onSendKey(KEYCODE_DPAD_LEFT)} style={{ width: 44, height: 44 }} /></Tooltip>
        <Tooltip title="OK"><Button size="small" type="primary" icon={<CheckOutlined />} disabled={disabled} onClick={() => onSendKey(KEYCODE_DPAD_CENTER)} style={{ width: 44, height: 44 }} /></Tooltip>
        <Tooltip title="Right"><Button size="small" icon={<ArrowRightOutlined />} disabled={disabled} onClick={() => onSendKey(KEYCODE_DPAD_RIGHT)} style={{ width: 44, height: 44 }} /></Tooltip>
        {/* Row 3 */}
        <div />
        <Tooltip title="Down"><Button size="small" icon={<ArrowDownOutlined />} disabled={disabled} onClick={() => onSendKey(KEYCODE_DPAD_DOWN)} style={{ width: 44, height: 44 }} /></Tooltip>
        <div />
      </div>

      {/* Utility row 1: Home, Back, Menu */}
      <div style={{ display: "flex", gap: 4 }}>
        <Tooltip title="Home"><Button size="small" icon={<HomeOutlined />} disabled={disabled} onClick={() => onSendKey(KEYCODE_HOME)} style={{ width: 44, height: 44 }} /></Tooltip>
        <Tooltip title="Back"><Button size="small" icon={<RollbackOutlined />} disabled={disabled} onClick={() => onSendKey(KEYCODE_BACK)} style={{ width: 44, height: 44 }} /></Tooltip>
        <Tooltip title="Menu"><Button size="small" icon={<MenuOutlined />} disabled={disabled} onClick={() => onSendKey(KEYCODE_MENU)} style={{ width: 44, height: 44 }} /></Tooltip>
      </div>

      {/* Utility row 2: Vol+, Vol-, Power */}
      <div style={{ display: "flex", gap: 4 }}>
        <Tooltip title="Vol+"><Button size="small" icon={<SoundOutlined />} disabled={disabled} onClick={() => onSendKey(KEYCODE_VOLUME_UP)} style={{ width: 44, height: 44 }} /></Tooltip>
        <Tooltip title="Vol-"><Button size="small" disabled={disabled} onClick={() => onSendKey(KEYCODE_VOLUME_DOWN)} style={{ width: 44, height: 44, fontSize: 11 }}>V-</Button></Tooltip>
        <Tooltip title="Power"><Button size="small" icon={<PoweroffOutlined />} disabled={disabled} onClick={() => onSendKey(KEYCODE_POWER)} style={{ width: 44, height: 44 }} /></Tooltip>
      </div>
    </div>
  );
}
