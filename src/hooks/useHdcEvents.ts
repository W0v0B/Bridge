import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useDeviceStore } from "../store/deviceStore";
import { getOhosDevices, isHdcScreenMirrorRunning } from "../utils/hdc";
import type { OhosDevice, HdcScreenMirrorState, ScreenFrame } from "../types/hdc";

export function useOhosDeviceEvents() {
  const syncOhosDevices = useDeviceStore((s) => s.syncOhosDevices);

  useEffect(() => {
    getOhosDevices()
      .then((devices) => syncOhosDevices(devices))
      .catch(() => {});

    const unlisten = listen<OhosDevice[]>("hdc_devices_changed", (event) => {
      syncOhosDevices(event.payload);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [syncOhosDevices]);
}

export interface HdcShellOutputEvent {
  connect_key: string;
  data: string;
}

export interface HdcShellExitEvent {
  connect_key: string;
  code: number;
}

export function useHdcShellOutput(callback: (event: HdcShellOutputEvent) => void) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    const unlisten = listen<HdcShellOutputEvent>("hdc_shell_output", (event) => {
      callbackRef.current(event.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);
}

export function useHdcShellExit(callback: (event: HdcShellExitEvent) => void) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    const unlisten = listen<HdcShellExitEvent>("hdc_shell_exit", (event) => {
      callbackRef.current(event.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);
}

export function useHdcScreenMirrorState(connectKey: string | null) {
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!connectKey) {
      setRunning(false);
      return;
    }

    isHdcScreenMirrorRunning(connectKey)
      .then(setRunning)
      .catch(() => {});

    const unlisten = listen<HdcScreenMirrorState>("hdc_screen_state", (event) => {
      if (event.payload.connect_key === connectKey) {
        setRunning(event.payload.running);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [connectKey]);

  return { running };
}

export function useHdcScreenFrame(
  connectKey: string | null,
  onFrame: (data: string) => void
) {
  const callbackRef = useRef(onFrame);
  callbackRef.current = onFrame;

  useEffect(() => {
    if (!connectKey) return;

    const unlisten = listen<ScreenFrame>("hdc_screen_frame", (event) => {
      if (event.payload.connect_key === connectKey) {
        callbackRef.current(event.payload.data);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [connectKey]);
}
