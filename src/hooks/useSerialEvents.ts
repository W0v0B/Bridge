import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { useDeviceStore } from "../store/deviceStore";
import { stopLocalScript } from "../utils/script";

interface SerialDataEvent {
  port: string;
  data: string;
}

export function useSerialData(callback: (event: SerialDataEvent) => void) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    const unlisten = listen<SerialDataEvent>("serial_data", (e) => {
      callbackRef.current(e.payload);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []); // register once — callbackRef absorbs updates
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
        stopLocalScript(device.id).catch(() => {});
        removeDevice(device.id);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [removeDevice]);
}
