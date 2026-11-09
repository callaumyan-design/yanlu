import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { installOfflineGuard } from "./offline-guard";
import "./index.css";

if (import.meta.env.PROD) {
  installOfflineGuard();
  if ("serviceWorker" in navigator && window.location.protocol.startsWith("http")) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {
        // The page still works from the local files if the worker cannot install.
      });
    });
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
