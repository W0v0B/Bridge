import { useEffect, useRef } from "react";

export function SerialTerminal() {
  const terminalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // xterm initialization will go here
  }, []);

  return (
    <div
      ref={terminalRef}
      style={{ background: "#000", height: 400, padding: 8, fontFamily: "monospace", color: "#0f0" }}
    >
      Terminal ready...
    </div>
  );
}
