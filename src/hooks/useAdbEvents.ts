import { useEffect, useRef, useState, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { useDeviceStore } from "../store/deviceStore";
import { getDevices } from "../utils/adb";
import type { AdbDevice, TransferProgress, LogcatBatch, ScrcpyState } from "../types/adb";

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

export function useLogcatEvents(onBatch: (batch: LogcatBatch) => void) {
  const callbackRef = useRef(onBatch);
  callbackRef.current = onBatch;

  useEffect(() => {
    const unlisten = listen<LogcatBatch>("logcat_lines", (event) => {
      callbackRef.current(event.payload);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);
}

export function useTlogcatEvents(onBatch: (batch: LogcatBatch) => void) {
  const callbackRef = useRef(onBatch);
  callbackRef.current = onBatch;

  useEffect(() => {
    const unlisten = listen<LogcatBatch>("tlogcat_lines", (event) => {
      callbackRef.current(event.payload);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);
}

/**
 * Track scrcpy running state per device serial.
 * Returns { running, setRunningOptimistic } for a given serial.
 */
export function useScrcpyState(serial: string | null) {
  const [runningMap, setRunningMap] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const unlisten = listen<ScrcpyState>("scrcpy_state", (event) => {
      const { serial: s, running } = event.payload;
      setRunningMap((prev) => ({ ...prev, [s]: running }));
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const running = serial ? runningMap[serial] ?? false : false;

  const setRunningOptimistic = useCallback(
    (value: boolean) => {
      if (serial) {
        setRunningMap((prev) => ({ ...prev, [serial]: value }));
      }
    },
    [serial]
  );

  return { running, setRunningOptimistic };
}
