import { useMemo } from "react";
import { useDeviceStore } from "../../store/deviceStore";
import {
  startLogcat,
  stopLogcat,
  startTlogcat,
  stopTlogcat,
  clearDeviceLog,
  exportLogs,
} from "../../utils/adb";
import { LogPanel } from "../shared/LogPanel";
import type { LogPanelConfig } from "../shared/LogPanel";
import type { LogcatFilter } from "../../types/adb";

export function LogcatPanel() {
  const selectedDeviceId = useDeviceStore((s) => s.selectedDeviceId);
  const allDevices = useDeviceStore((s) => s.devices);
  const deviceKey =
    allDevices.find((d) => d.id === selectedDeviceId && d.type === "adb")?.serial ?? null;

  const config = useMemo((): LogPanelConfig => ({
    modes: [
      { label: "Logcat", value: "logcat" },
      { label: "tlogcat", value: "tlogcat" },
    ],
    levels: [
      { value: "All", label: "All" },
      { value: "V", label: "Verbose" },
      { value: "D", label: "Debug" },
      { value: "I", label: "Info" },
      { value: "W", label: "Warn" },
      { value: "E", label: "Error" },
      { value: "F", label: "Fatal" },
    ],
    levelOrder: ["V", "D", "I", "W", "E", "F"],
    deviceKey,
    startStream: async (key, mode, filter) => {
      if (mode === "logcat") {
        const f: LogcatFilter = { level: filter.level, tags: null, keyword: filter.keyword };
        await startLogcat(key, f);
      } else {
        await startTlogcat(key);
      }
    },
    stopStream: async (key, mode) => {
      if (mode === "logcat") await stopLogcat(key);
      else await stopTlogcat(key);
    },
    clearDevice: clearDeviceLog,
    exportEntries: exportLogs,
    eventNames: { logcat: "logcat_lines", tlogcat: "tlogcat_lines" },
    extractDeviceKey: (p) => p.serial as string,
    clearTooltip: (mode) =>
      mode === "logcat"
        ? "Clear display and device log buffer (adb logcat -c)"
        : "Clear display",
    primaryMode: "logcat",
  }), [deviceKey]);

  return <LogPanel config={config} />;
}
