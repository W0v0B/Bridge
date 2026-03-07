import { create } from "zustand";
import type { AdbDevice } from "../types/adb";
import type { OhosDevice } from "../types/hdc";
import type { ConnectedDevice } from "../types/device";

interface DeviceState {
  devices: ConnectedDevice[];
  selectedDeviceId: string | null;
  addDevice: (device: ConnectedDevice) => void;
  removeDevice: (id: string) => void;
  updateDevice: (id: string, partial: Partial<ConnectedDevice>) => void;
  selectDevice: (id: string | null) => void;
  syncAdbDevices: (adbDevices: AdbDevice[]) => void;
  syncOhosDevices: (ohosDevices: OhosDevice[]) => void;
}

export const useDeviceStore = create<DeviceState>((set) => ({
  devices: [],
  selectedDeviceId: null,

  addDevice: (device) =>
    set((state) => {
      if (state.devices.some((d) => d.id === device.id)) return state;
      return { devices: [...state.devices, device] };
    }),

  removeDevice: (id) =>
    set((state) => ({
      devices: state.devices.filter((d) => d.id !== id),
      selectedDeviceId:
        state.selectedDeviceId === id ? null : state.selectedDeviceId,
    })),

  updateDevice: (id, partial) =>
    set((state) => ({
      devices: state.devices.map((d) =>
        d.id === id ? { ...d, ...partial } : d
      ),
    })),

  selectDevice: (id) => set({ selectedDeviceId: id }),

  syncAdbDevices: (adbDevices) =>
    set((state) => {
      const existing = new Map(
        state.devices
          .filter((d) => d.type === "adb")
          .map((d) => [d.serial, d])
      );
      const nonAdb = state.devices.filter((d) => d.type !== "adb");

      const synced: ConnectedDevice[] = adbDevices.map((ad) => {
        const prev = existing.get(ad.serial);
        return {
          id: ad.serial,
          type: "adb" as const,
          name: prev?.name || ad.model || ad.serial,
          serial: ad.serial,
          state: ad.state,
          model: ad.model,
          product: ad.product,
          isRoot: ad.is_root,
          isRemounted: ad.is_remounted,
        };
      });

      return { devices: [...nonAdb, ...synced] };
    }),

  syncOhosDevices: (ohosDevices) =>
    set((state) => {
      const existing = new Map(
        state.devices
          .filter((d) => d.type === "ohos")
          .map((d) => [d.serial, d])
      );
      const nonOhos = state.devices.filter((d) => d.type !== "ohos");

      const synced: ConnectedDevice[] = ohosDevices.map((od) => {
        const prev = existing.get(od.connect_key);
        return {
          id: od.connect_key,
          type: "ohos" as const,
          name: prev?.name || od.name || od.connect_key,
          serial: od.connect_key,
          state: od.state.toLowerCase(),
          model: od.conn_type, // "USB" or "TCP"
          isRemounted: od.is_remounted,
          remountInfo: od.remount_info,
        };
      });

      return { devices: [...nonOhos, ...synced] };
    }),
}));
