import { create } from "zustand";
import { persist } from "zustand/middleware";

export type DeviceType = "adb" | "ohos" | "serial";

export interface QuickCommand {
  id: string;
  label: string;
  command: string;
  /** undefined = not in sequence; 1,2,3… = run order */
  sequenceOrder?: number;
  /** If set, this is a local script — command field is ignored and this path is executed instead */
  scriptPath?: string;
}

interface CommandsByType {
  adb: QuickCommand[];
  ohos: QuickCommand[];
  serial: QuickCommand[];
}

interface CommandState {
  commandsByType: CommandsByType;
  addCommand: (deviceType: DeviceType, label: string, command: string) => void;
  addScript: (deviceType: DeviceType, label: string, scriptPath: string) => void;
  removeCommand: (deviceType: DeviceType, id: string) => void;
  setSequenceOrder: (deviceType: DeviceType, id: string, order: number | undefined) => void;
}

const DEFAULT_COMMANDS: CommandsByType = {
  adb: [
    { id: "default-adb-1", label: "Reboot", command: "reboot" },
    { id: "default-adb-2", label: "Get Props", command: "getprop" },
    { id: "default-adb-3", label: "List Packages", command: "pm list packages" },
  ],
  ohos: [
    { id: "default-ohos-1", label: "Reboot", command: "reboot" },
    { id: "default-ohos-2", label: "Device Info", command: "param get const.product.model" },
  ],
  serial: [],
};

export const useCommandStore = create<CommandState>()(
  persist(
    (set) => ({
      commandsByType: DEFAULT_COMMANDS,

      addCommand: (deviceType, label, command) =>
        set((state) => ({
          commandsByType: {
            ...state.commandsByType,
            [deviceType]: [
              ...state.commandsByType[deviceType],
              { id: `cmd-${Date.now()}`, label, command },
            ],
          },
        })),

      addScript: (deviceType, label, scriptPath) =>
        set((state) => ({
          commandsByType: {
            ...state.commandsByType,
            [deviceType]: [
              ...state.commandsByType[deviceType],
              { id: `cmd-${Date.now()}`, label, command: scriptPath, scriptPath },
            ],
          },
        })),

      removeCommand: (deviceType, id) =>
        set((state) => ({
          commandsByType: {
            ...state.commandsByType,
            [deviceType]: state.commandsByType[deviceType].filter((c) => c.id !== id),
          },
        })),

      setSequenceOrder: (deviceType, id, order) =>
        set((state) => ({
          commandsByType: {
            ...state.commandsByType,
            [deviceType]: state.commandsByType[deviceType].map((c) =>
              c.id === id ? { ...c, sequenceOrder: order } : c
            ),
          },
        })),
    }),
    {
      name: "bridge-commands",
      version: 1,
    }
  )
);
