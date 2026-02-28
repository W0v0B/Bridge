import { create } from "zustand";

interface Device {
  serial: string;
  model: string;
  status: string;
}

interface DeviceState {
  devices: Device[];
  selectedDevice: string | null;
  setDevices: (devices: Device[]) => void;
  selectDevice: (serial: string | null) => void;
}

export const useDeviceStore = create<DeviceState>((set) => ({
  devices: [],
  selectedDevice: null,
  setDevices: (devices) => set({ devices }),
  selectDevice: (serial) => set({ selectedDevice: serial }),
}));
