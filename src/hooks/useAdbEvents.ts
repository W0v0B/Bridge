import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { useDeviceStore } from "../store/deviceStore";
import { getDevices } from "../utils/adb";
import type { AdbDevice, TransferProgress, LogEntry } from "../types/adb";

export function useDeviceEvents() {
  const syncAdbDevices = useDeviceStore((s) => s.syncAdbDevices);

  useEffect(() => {
    // Fetch initial device list on mount
    getDevices()
      .then((devices) => syncAdbDevices(devices))
      .catch(() => {});

    // Listen for subsequent changes from the backend watcher
    const unlisten = listen<AdbDevice[]>("devices_changed", (event) => {
      syncAdbDevices(event.payload);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [syncAdbDevices]);
}

export function useTransferEvents(
  onProgress: (progress: TransferProgress) => void
) {
  const callbackRef = useRef(onProgress);
  callbackRef.current = onProgress;

  useEffect(() => {
    const unlisten = listen<TransferProgress>("transfer_progress", (event) => {
      callbackRef.current(event.payload);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);
}

export function useLogcatEvents(onLine: (entry: LogEntry) => void) {
  const callbackRef = useRef(onLine);
  callbackRef.current = onLine;

  useEffect(() => {
    const unlisten = listen<LogEntry>("logcat_line", (event) => {
      callbackRef.current(event.payload);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);
}

export function useTlogcatEvents(onLine: (entry: LogEntry) => void) {
  const callbackRef = useRef(onLine);
  callbackRef.current = onLine;

  useEffect(() => {
    const unlisten = listen<LogEntry>("tlogcat_line", (event) => {
      callbackRef.current(event.payload);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);
}
