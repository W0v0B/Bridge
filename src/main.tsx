import React from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Fade out and remove the splash screen once React has painted its first frame
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    const splash = document.getElementById("splash");
    if (!splash) return;
    splash.style.opacity = "0";
    splash.addEventListener("transitionend", () => splash.remove(), { once: true });
  });
});
