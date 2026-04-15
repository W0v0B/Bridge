import { useMemo } from "react";
import { useDeviceStore } from "../../store/deviceStore";
import {
  startHilog,
  stopHilog,
  startHdcTlogcat,
  stopHdcTlogcat,
  clearHilog,
  exportHilog,
} from "../../utils/hdc";
import { LogPanel } from "../shared/LogPanel";
import type { LogPanelConfig } from "../shared/LogPanel";
import type { HilogFilter } from "../../types/hdc";

export function HilogPanel() {
  const selectedDeviceId = useDeviceStore((s) => s.selectedDeviceId);
  const allDevices = useDeviceStore((s) => s.devices);
  const deviceKey =
    allDevices.find((d) => d.id === selectedDeviceId && d.type === "ohos")?.serial ?? null;

  const config = useMemo((): LogPanelConfig => ({
    modes: [
      { label: "HiLog", value: "hilog" },
      { label: "tlogcat", value: "tlogcat" },
    ],
    levels: [
      { value: "All", label: "All" },
      { value: "D", label: "Debug" },
      { value: "I", label: "Info" },
      { value: "W", label: "Warn" },
      { value: "E", label: "Error" },
      { value: "F", label: "Fatal" },
    ],
    levelOrder: ["D", "I", "W", "E", "F"],
    deviceKey,
    startStream: async (key, mode, filter) => {
      if (mode === "hilog") {
        const f: HilogFilter = { level: filter.level, keyword: filter.keyword };
        await startHilog(key, f);
      } else {
        await startHdcTlogcat(key);
      }
    },
    stopStream: async (key, mode) => {
      if (mode === "hilog") await stopHilog(key);
      else await stopHdcTlogcat(key);
    },
    clearDevice: clearHilog,
    exportEntries: exportHilog,
    eventNames: { hilog: "hilog_lines", tlogcat: "hdc_tlogcat_lines" },
    exitEventName: "hilog_exit",
    extractDeviceKey: (p) => p.connect_key as string,
    clearTooltip: (mode) =>
      mode === "hilog"
        ? "Clear display and device hilog buffer (hilog -r)"
        : "Clear display",
    primaryMode: "hilog",
  }), [deviceKey]);

  return <LogPanel config={config} />;
}
