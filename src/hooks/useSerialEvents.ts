import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useDeviceStore } from "../store/deviceStore";

interface SerialDataEvent {
  port: string;
  data: string;
}

export function useSerialData(callback: (event: SerialDataEvent) => void) {
  useEffect(() => {
    const unlisten = listen<SerialDataEvent>("serial_data", (e) => {
      callback(e.payload);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [callback]);
}

export function useSerialDisconnect() {
  const removeDevice = useDeviceStore((s) => s.removeDevice);

  useEffect(() => {
    const unlisten = listen<string>("serial_disconnected", (e) => {
      const portName = e.payload;
      // Remove the serial device whose serial matches the disconnected port
      const devices = useDeviceStore.getState().devices;
      const device = devices.find(
        (d) => d.type === "serial" && d.serial === portName
      );
      if (device) {
        removeDevice(device.id);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [removeDevice]);
}
