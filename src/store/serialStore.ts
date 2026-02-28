import { create } from "zustand";

interface SerialPort {
  name: string;
  connected: boolean;
}

interface SerialState {
  ports: SerialPort[];
  activePort: string | null;
  baudRate: number;
  setPorts: (ports: SerialPort[]) => void;
  setActivePort: (port: string | null) => void;
  setBaudRate: (rate: number) => void;
}

export const useSerialStore = create<SerialState>((set) => ({
  ports: [],
  activePort: null,
  baudRate: 115200,
  setPorts: (ports) => set({ ports }),
  setActivePort: (port) => set({ activePort: port }),
  setBaudRate: (rate) => set({ baudRate: rate }),
}));
