import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useDeviceStore } from "../store/deviceStore";

export function useAdbEvents() {
  const setDevices = useDeviceStore((s) => s.setDevices);

  useEffect(() => {
    const unlisten = listen("adb-devices", (event) => {
      setDevices(event.payload as any[]);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [setDevices]);
}
