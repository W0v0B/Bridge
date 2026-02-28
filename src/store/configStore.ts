import { create } from "zustand";

interface Config {
  adbPath: string;
  theme: "dark" | "light";
  autoConnect: boolean;
}

interface ConfigState {
  config: Config;
  setConfig: (config: Partial<Config>) => void;
}

export const useConfigStore = create<ConfigState>((set) => ({
  config: {
    adbPath: "",
    theme: "dark",
    autoConnect: true,
  },
  setConfig: (partial) => set((state) => ({ config: { ...state.config, ...partial } })),
}));
