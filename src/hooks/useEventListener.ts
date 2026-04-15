import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";

/**
 * Generic Tauri event listener hook with stable callback ref.
 * Replaces the repeated callback-ref + listen pattern used across
 * useAdbEvents and useHdcEvents for log/batch streaming.
 */
export function useEventListener<T>(
  eventName: string,
  callback: (payload: T) => void
) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    const unlisten = listen<T>(eventName, (e) => callbackRef.current(e.payload));
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [eventName]);
}
