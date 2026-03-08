import { create } from "zustand";
import type { ThemeId } from "../theme";

interface Config {
  adbPath: string;
  theme: ThemeId;
  autoConnect: boolean;
  shellMaxLines: number;
  logcatMaxLines: number;
}

interface ConfigState {
  config: Config;
  setConfig: (config: Partial<Config>) => void;
}

export const useConfigStore = create<ConfigState>((set) => ({
  config: {
    adbPath: "",
    theme: "snow",
    autoConnect: true,
    shellMaxLines: 5000,
    logcatMaxLines: 5000,
  },
  setConfig: (partial) => set((state) => ({ config: { ...state.config, ...partial } })),
}));
