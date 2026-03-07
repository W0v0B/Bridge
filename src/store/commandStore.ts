import { create } from "zustand";

export interface QuickCommand {
  id: string;
  label: string;
  command: string;
  sequenceOrder?: number; // undefined = not in sequence; 1,2,3… = run order
}

interface CommandState {
  commands: QuickCommand[];
  addCommand: (label: string, command: string) => void;
  removeCommand: (id: string) => void;
  setSequenceOrder: (id: string, order: number | undefined) => void;
}

export const useCommandStore = create<CommandState>((set) => ({
  commands: [
    { id: "default-1", label: "Reboot", command: "reboot" },
    { id: "default-2", label: "Get Props", command: "getprop" },
    { id: "default-3", label: "List Packages", command: "pm list packages" },
  ],

  addCommand: (label, command) =>
    set((state) => ({
      commands: [
        ...state.commands,
        { id: `cmd-${Date.now()}`, label, command },
      ],
    })),

  removeCommand: (id) =>
    set((state) => ({
      commands: state.commands.filter((c) => c.id !== id),
    })),

  setSequenceOrder: (id, order) =>
    set((state) => ({
      commands: state.commands.map((c) =>
        c.id === id ? { ...c, sequenceOrder: order } : c
      ),
    })),
}));
