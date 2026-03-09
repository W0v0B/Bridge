import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { useDeviceStore } from "../store/deviceStore";
import { getOhosDevices } from "../utils/hdc";
import type { OhosDevice, HilogBatch } from "../types/hdc";

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

export function useHilogEvents(onBatch: (batch: HilogBatch) => void) {
  const callbackRef = useRef(onBatch);
  callbackRef.current = onBatch;

  useEffect(() => {
    const unlisten = listen<HilogBatch>("hilog_lines", (event) => {
      callbackRef.current(event.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);
}
