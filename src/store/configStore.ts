import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ThemeId } from "../theme";

export interface QuickAccessPath {
  label: string;
  path: string;
}

interface Config {
  adbPath: string;
  theme: ThemeId;
  autoConnect: boolean;
  shellMaxLines: number;
  logcatMaxLines: number;
  // Last-used connection defaults
  adbHost: string;
  adbPort: number;
  ohosHost: string;
  ohosPort: number;
  telnetHost: string;
  telnetPort: number;
  baudRate: number;
  // Background image
  bgImagePath: string | null;
  bgOpacity: number;
  // Quick access paths for file managers
  adbQuickPaths: QuickAccessPath[];
  ohosQuickPaths: QuickAccessPath[];
}

interface ConfigState {
  config: Config;
  setConfig: (config: Partial<Config>) => void;
}

export const useConfigStore = create<ConfigState>()(
  persist(
    (set) => ({
      config: {
        adbPath: "",
        theme: "snow",
        autoConnect: true,
        shellMaxLines: 5000,
        logcatMaxLines: 5000,
        adbHost: "192.168.1.100",
        adbPort: 5555,
        ohosHost: "192.168.1.100",
        ohosPort: 5555,
        telnetHost: "192.168.1.100",
        telnetPort: 23,
        baudRate: 115200,
        bgImagePath: null,
        bgOpacity: 0.5,
        adbQuickPaths: [
          { label: "sdcard", path: "/sdcard" },
          { label: "system", path: "/system" },
          { label: "data", path: "/data" },
        ],
        ohosQuickPaths: [
          { label: "data", path: "/data" },
          { label: "system", path: "/system" },
        ],
      },
      setConfig: (partial) => set((state) => ({ config: { ...state.config, ...partial } })),
    }),
    {
      name: "bridge-config",
      merge: (persisted, current) => {
        const p = persisted as Partial<ConfigState> | undefined;
        return {
          ...current,
          config: { ...current.config, ...(p?.config ?? {}) },
        };
      },
    }
  )
);
