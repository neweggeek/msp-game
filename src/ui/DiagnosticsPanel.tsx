import { useState } from "react";
import { clearDiag, diagReport } from "./diag";
import { data, useUi } from "./store";

function report() {
  return diagReport(useUi.getState().game, data.calendar);
}

export function DiagnosticsBody() {
  const [text] = useState(report);
  return (
    <>
      <p className="dim" style={{ marginTop: 0 }}>
        Errors, warnings and every action this game. Copy it and paste it back to us, or save it as
        a file.
      </p>
      <textarea
        readOnly
        value={text}
        className="mono"
        style={{ width: "100%", height: 320, fontSize: 11 }}
        aria-label="Diagnostics report"
      />
    </>
  );
}

/** Copy, save and clear. Works outside the store-driven UI too, for the crash screen. */
export function DiagnosticsButtons() {
  const [note, setNote] = useState("");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report());
      setNote("Copied.");
    } catch {
      setNote("Copy blocked. Use Save instead.");
    }
  };
  const save = () => {
    const blob = new Blob([report()], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `msp-diagnostics-${new Date().toISOString().slice(0, 19).replace(/:/g, "")}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
    setNote("Saved.");
  };
  return (
    <>
      {note && <span className="dim">{note}</span>}
      <button
        type="button"
        className="btn small"
        onClick={() => {
          clearDiag();
          setNote("Log cleared.");
        }}
      >
        Clear log
      </button>
      <button type="button" className="btn small" onClick={save}>
        Save .txt
      </button>
      <button type="button" className="btn small primary" onClick={copy}>
        Copy
      </button>
    </>
  );
}
