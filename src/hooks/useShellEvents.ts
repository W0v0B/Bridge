import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";

export interface ShellOutputEvent {
  serial: string;
  data: string;
}

export interface ShellExitEvent {
  serial: string;
  code: number;
}

export function useShellOutput(callback: (event: ShellOutputEvent) => void) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    const unlisten = listen<ShellOutputEvent>("shell_output", (event) => {
      callbackRef.current(event.payload);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);
}

export function useShellExit(callback: (event: ShellExitEvent) => void) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    const unlisten = listen<ShellExitEvent>("shell_exit", (event) => {
      callbackRef.current(event.payload);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);
}
