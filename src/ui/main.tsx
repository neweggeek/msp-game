import { Component, type ErrorInfo, type ReactNode, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { DiagnosticsButtons } from "./DiagnosticsPanel";
import "./app.css";
import { diag, errorText, installDiag } from "./diag";

installDiag();

/** Keeps a render crash from blanking the page, and logs it. */
class Crash extends Component<{ children: ReactNode }, { error?: unknown }> {
  state: { error?: unknown } = {};
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  componentDidCatch(error: unknown, info: ErrorInfo) {
    diag("error", `Render crash ${errorText(error)}\nComponents:${info.componentStack ?? ""}`);
  }
  render() {
    if (this.state.error === undefined) return this.props.children;
    return (
      <div style={{ padding: 24, maxWidth: 640 }}>
        <h2>Something broke.</h2>
        <p className="mono">{errorText(this.state.error).split("\n")[0]}</p>
        <p>Copy the diagnostics and send them over. Your save is still in its slot.</p>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <DiagnosticsButtons />
          <button
            type="button"
            className="btn small"
            onClick={() => this.setState({ error: undefined })}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Crash>
        <App />
      </Crash>
    </StrictMode>,
  );
}
