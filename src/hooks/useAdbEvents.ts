import { useEffect, useRef, useState, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { useDeviceStore } from "../store/deviceStore";
import { getDevices, isAdbScreenCaptureRunning } from "../utils/adb";
import type { AdbDevice, TransferProgress, ScrcpyState, AdbScreenFrame, AdbScreenCaptureState } from "../types/adb";

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

export function useAdbScreenCaptureState(serial: string | null) {
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!serial) {
      setRunning(false);
      return;
    }

    isAdbScreenCaptureRunning(serial)
      .then(setRunning)
      .catch(() => {});

    const unlisten = listen<AdbScreenCaptureState>("adb_screen_state", (event) => {
      if (event.payload.serial === serial) {
        setRunning(event.payload.running);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [serial]);

  return { running };
}

export function useAdbScreenFrame(
  serial: string | null,
  onFrame: (data: string) => void
) {
  const callbackRef = useRef(onFrame);
  callbackRef.current = onFrame;

  useEffect(() => {
    if (!serial) return;

    const unlisten = listen<AdbScreenFrame>("adb_screen_frame", (event) => {
      if (event.payload.serial === serial) {
        callbackRef.current(event.payload.data);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [serial]);
}
