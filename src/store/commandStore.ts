import { create } from "zustand";
import { persist } from "zustand/middleware";

export type DeviceType = "adb" | "ohos" | "serial";

export interface CommandGroup {
  id: string;
  label: string;
  collapsed: boolean;
  sortOrder: number;
}

export interface QuickCommand {
  id: string;
  label: string;
  command: string;
  /** undefined = not in sequence; 1,2,3… = run order */
  sequenceOrder?: number;
  /** If set, this is a local script — command field is ignored and this path is executed instead */
  scriptPath?: string;
  /** undefined = ungrouped (root level) */
  groupId?: string;
}

interface CommandsByType {
  adb: QuickCommand[];
  ohos: QuickCommand[];
  serial: QuickCommand[];
}

interface GroupsByType {
  adb: CommandGroup[];
  ohos: CommandGroup[];
  serial: CommandGroup[];
}

interface CommandState {
  commandsByType: CommandsByType;
  groupsByType: GroupsByType;
  addCommand: (deviceType: DeviceType, label: string, command: string, groupId?: string) => void;
  addScript: (deviceType: DeviceType, label: string, scriptPath: string, groupId?: string) => void;
  removeCommand: (deviceType: DeviceType, id: string) => void;
  setSequenceOrder: (deviceType: DeviceType, id: string, order: number | undefined) => void;
  addGroup: (deviceType: DeviceType, label: string) => string;
  renameGroup: (deviceType: DeviceType, groupId: string, label: string) => void;
  removeGroup: (deviceType: DeviceType, groupId: string) => void;
  toggleGroupCollapsed: (deviceType: DeviceType, groupId: string) => void;
  moveCommandToGroup: (deviceType: DeviceType, commandId: string, groupId: string | undefined) => void;
}

const DEFAULT_GROUPS: GroupsByType = {
  adb: [
    { id: "default-adb-group-1", label: "System", collapsed: false, sortOrder: 0 },
  ],
  ohos: [
    { id: "default-ohos-group-1", label: "System", collapsed: false, sortOrder: 0 },
  ],
  serial: [],
};

const DEFAULT_COMMANDS: CommandsByType = {
  adb: [
    { id: "default-adb-1", label: "Reboot", command: "reboot", groupId: "default-adb-group-1" },
    { id: "default-adb-2", label: "Get Props", command: "getprop", groupId: "default-adb-group-1" },
    { id: "default-adb-3", label: "List Packages", command: "pm list packages", groupId: "default-adb-group-1" },
  ],
  ohos: [
    { id: "default-ohos-1", label: "Reboot", command: "reboot", groupId: "default-ohos-group-1" },
    { id: "default-ohos-2", label: "Device Info", command: "param get const.product.model", groupId: "default-ohos-group-1" },
  ],
  serial: [],
};

export const useCommandStore = create<CommandState>()(
  persist(
    (set) => ({
      commandsByType: DEFAULT_COMMANDS,
      groupsByType: DEFAULT_GROUPS,

      addCommand: (deviceType, label, command, groupId) =>
        set((state) => ({
          commandsByType: {
            ...state.commandsByType,
            [deviceType]: [
              ...state.commandsByType[deviceType],
              { id: `cmd-${Date.now()}`, label, command, groupId },
            ],
          },
        })),

      addScript: (deviceType, label, scriptPath, groupId) =>
        set((state) => ({
          commandsByType: {
            ...state.commandsByType,
            [deviceType]: [
              ...state.commandsByType[deviceType],
              { id: `cmd-${Date.now()}`, label, command: scriptPath, scriptPath, groupId },
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

      addGroup: (deviceType, label) => {
        const id = `grp-${Date.now()}`;
        set((state) => ({
          groupsByType: {
            ...state.groupsByType,
            [deviceType]: [
              ...state.groupsByType[deviceType],
              { id, label, collapsed: false, sortOrder: state.groupsByType[deviceType].length },
            ],
          },
        }));
        return id;
      },

      renameGroup: (deviceType, groupId, label) =>
        set((state) => ({
          groupsByType: {
            ...state.groupsByType,
            [deviceType]: state.groupsByType[deviceType].map((g) =>
              g.id === groupId ? { ...g, label } : g
            ),
          },
        })),

      removeGroup: (deviceType, groupId) =>
        set((state) => {
          const remaining = state.groupsByType[deviceType].filter((g) => g.id !== groupId);
          return {
            groupsByType: {
              ...state.groupsByType,
              [deviceType]: remaining.map((g, i) => ({ ...g, sortOrder: i })),
            },
            commandsByType: {
              ...state.commandsByType,
              [deviceType]: state.commandsByType[deviceType].map((c) =>
                c.groupId === groupId ? { ...c, groupId: undefined } : c
              ),
            },
          };
        }),

      toggleGroupCollapsed: (deviceType, groupId) =>
        set((state) => ({
          groupsByType: {
            ...state.groupsByType,
            [deviceType]: state.groupsByType[deviceType].map((g) =>
              g.id === groupId ? { ...g, collapsed: !g.collapsed } : g
            ),
          },
        })),

      moveCommandToGroup: (deviceType, commandId, groupId) =>
        set((state) => ({
          commandsByType: {
            ...state.commandsByType,
            [deviceType]: state.commandsByType[deviceType].map((c) =>
              c.id === commandId ? { ...c, groupId } : c
            ),
          },
        })),
    }),
    {
      name: "bridge-commands",
      version: 2,
      migrate: (persisted: unknown, version: number) => {
        const state = persisted as Partial<CommandState> & { commandsByType?: CommandsByType };
        if (version < 2) {
          return {
            ...state,
            groupsByType: { adb: [], ohos: [], serial: [] },
          };
        }
        return state;
      },
    }
  )
);
