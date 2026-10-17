import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DebugView } from "./debug/DebugView";
import "./debug/debug.css";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <DebugView />
    </StrictMode>,
  );
}
