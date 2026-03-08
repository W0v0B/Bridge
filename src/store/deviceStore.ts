import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AdbDevice } from "../types/adb";
import type { OhosDevice } from "../types/hdc";
import type { ConnectedDevice } from "../types/device";

interface DeviceState {
  devices: ConnectedDevice[];
  selectedDeviceId: string | null;
  // Persisted map of serial → custom name set by the user
  customNames: Record<string, string>;
  addDevice: (device: ConnectedDevice) => void;
  removeDevice: (id: string) => void;
  updateDevice: (id: string, partial: Partial<ConnectedDevice>) => void;
  selectDevice: (id: string | null) => void;
  syncAdbDevices: (adbDevices: AdbDevice[]) => void;
  syncOhosDevices: (ohosDevices: OhosDevice[]) => void;
}

export const useDeviceStore = create<DeviceState>()(
  persist(
    (set) => ({
      devices: [],
      selectedDeviceId: null,
      customNames: {},

      addDevice: (device) =>
        set((state) => {
          const existing = state.devices.find((d) => d.id === device.id);
          // Same id AND same type → truly duplicate, skip
          if (existing && existing.type === device.type) return state;
          // Same id but different type (e.g. OHOS phantom vs serial) → replace
          const filtered = state.devices.filter((d) => d.id !== device.id);
          // Apply any saved custom name
          const name = state.customNames[device.serial] ?? device.name;
          return { devices: [...filtered, { ...device, name }] };
        }),

      removeDevice: (id) =>
        set((state) => ({
          devices: state.devices.filter((d) => d.id !== id),
          selectedDeviceId:
            state.selectedDeviceId === id ? null : state.selectedDeviceId,
        })),

      updateDevice: (id, partial) =>
        set((state) => {
          const updated = state.devices.map((d) =>
            d.id === id ? { ...d, ...partial } : d
          );
          // If the name was changed, persist it keyed by serial
          if (partial.name !== undefined) {
            const device = state.devices.find((d) => d.id === id);
            if (device) {
              return {
                devices: updated,
                customNames: { ...state.customNames, [device.serial]: partial.name },
              };
            }
          }
          return { devices: updated };
        }),

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
            const customName = state.customNames[ad.serial];
            return {
              id: ad.serial,
              type: "adb" as const,
              name: customName ?? prev?.name ?? ad.model ?? ad.serial,
              serial: ad.serial,
              state: ad.state,
              model: ad.model,
              product: ad.product,
              isRoot: ad.is_root,
              rootInfo: ad.root_info,
              isRemounted: ad.is_remounted,
              remountInfo: ad.remount_info,
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
            const customName = state.customNames[od.connect_key];
            return {
              id: od.connect_key,
              type: "ohos" as const,
              name: customName ?? prev?.name ?? od.name ?? od.connect_key,
              serial: od.connect_key,
              state: od.state.toLowerCase(),
              model: od.conn_type, // "USB" or "TCP"
              isRemounted: od.is_remounted,
              remountInfo: od.remount_info,
            };
          });

          return { devices: [...nonOhos, ...synced] };
        }),
    }),
    {
      name: "bridge-devices",
      // Only persist the custom names map — the live device list is rebuilt on startup
      partialize: (state) => ({ customNames: state.customNames }),
    }
  )
);
