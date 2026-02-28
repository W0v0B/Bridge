import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useSerialStore } from "../store/serialStore";

export function useSerialEvents() {
  const setPorts = useSerialStore((s) => s.setPorts);

  useEffect(() => {
    const unlisten = listen("serial-ports", (event) => {
      setPorts(event.payload as any[]);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [setPorts]);
}
