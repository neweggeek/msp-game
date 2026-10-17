import { type ReactNode, useState } from "react";
import { formatTime } from "../engine";
import { clearDiag, diagReport, reportBug } from "./diag";
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

/** Snapshot of what the player is looking at, so a bug report can be traced. */
function bugContext(): string[] {
  const { game, tab, ticket, session, message } = useUi.getState();
  if (!game) return ["No game loaded."];
  const t = game.book.tickets.find((x) => x.id === ticket);
  const s = session ? game.sessions[session] : undefined;
  const dev = s && game.world.devices.find((d) => d.id === s.deviceId);
  const out = [
    `Seed: ${game.seed}  Scenario: ${game.scenario ?? ""}${game.caseId ? ` case ${game.caseId}` : ""}`,
    `Game time: ${formatTime(data.calendar, game.clock.now)}  Actions so far: ${game.log.length}`,
    `Tab: ${tab}`,
    `Ticket: ${t ? `${t.id} ${t.title}` : "none"}`,
    `Status bar: ${message ?? ""}`,
  ];
  if (s) {
    out.push(
      `Terminal: ${s.kind} session on ${dev?.hostname ?? s.deviceId} ${dev?.ip ?? ""}${s.closed ? " (closed)" : ""}`,
      "Last terminal lines:",
      ...s.transcript.slice(-25).map((l) => `| ${l}`),
    );
  }
  const last = game.log.slice(-5);
  if (last.length) out.push("Last actions:", ...last.map((a) => `  ${JSON.stringify(a)}`));
  return out;
}

type ModalProps = { title: string; children: ReactNode; footer: ReactNode };

export function BugReportDialog({ Modal }: { Modal: (p: ModalProps) => ReactNode }) {
  const [text, setText] = useState("");
  const [saved, setSaved] = useState(false);
  const setDialog = useUi((s) => s.setDialog);
  if (saved)
    return (
      <Modal title="Bug saved" footer={<DiagnosticsButtons />}>
        <p style={{ marginTop: 0 }}>
          Saved to the diagnostics log with the seed, game time, what was on screen and the full
          action log. It stays there until you clear the log. Copy it now to send it, or keep
          playing and send it later from Diagnostics.
        </p>
      </Modal>
    );
  return (
    <Modal
      title="Report a bug"
      footer={
        <>
          <button type="button" className="btn small" onClick={() => setDialog(null)}>
            Cancel
          </button>
          <button
            type="button"
            className="btn small primary"
            disabled={!text.trim()}
            onClick={() => {
              reportBug(text.trim(), bugContext());
              setSaved(true);
            }}
          >
            Save report
          </button>
        </>
      }
    >
      <p className="dim" style={{ marginTop: 0 }}>
        What went wrong, or what was confusing? What did you expect? The game adds the details.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        style={{ width: "100%", height: 140 }}
        aria-label="Bug description"
        // biome-ignore lint/a11y/noAutofocus: the dialog exists to type this
        autoFocus
      />
    </Modal>
  );
}
