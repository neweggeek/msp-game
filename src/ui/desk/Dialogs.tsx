import { type ReactNode, useState } from "react";
import {
  closeBlockers,
  handoffNotes,
  plainResolutionNotes,
  resolutionNotes,
  webPage,
} from "../../engine";
import { BugReportDialog, DiagnosticsBody, DiagnosticsButtons } from "../DiagnosticsPanel";
import { ScoreDialog } from "../score/Score";
import { data, useGame, useUi } from "../store";

function Modal({
  title,
  children,
  footer,
}: { title: string; children: ReactNode; footer: ReactNode }) {
  const setDialog = useUi((s) => s.setDialog);
  return (
    <div
      className="modal-back"
      onClick={() => setDialog(null)}
      onKeyDown={(e) => e.key === "Escape" && setDialog(null)}
      role="presentation"
    >
      <dialog
        open
        className="modal"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        aria-label={title}
      >
        <header>
          <h2>{title}</h2>
          <button type="button" className="btn small" onClick={() => setDialog(null)}>
            Close
          </button>
        </header>
        <div className="body">{children}</div>
        <footer>{footer}</footer>
      </dialog>
    </div>
  );
}

export function Dialogs() {
  const dialog = useUi((s) => s.dialog);
  useUi((s) => s.rev);
  if (!dialog) return null;
  if (dialog.kind === "bug") return <BugReportDialog Modal={Modal} />;
  if (dialog.kind === "diag")
    return (
      <Modal title="Diagnostics" footer={<DiagnosticsButtons />}>
        <DiagnosticsBody />
      </Modal>
    );
  if (dialog.kind === "score") return <ScoreDialog Modal={Modal} summary={!!dialog.summary} />;
  if (dialog.kind === "web") return <Web from={dialog.from} address={dialog.address} />;
  if (dialog.kind === "handoff") return <Handoff ticket={dialog.ticket} />;
  if (dialog.kind === "resolve") return <Resolve ticket={dialog.ticket} />;
  return <SendBack ticket={dialog.ticket} />;
}

function Handoff({ ticket }: { ticket: string }) {
  const game = useGame();
  const { act, setDialog } = useUi();
  const t = game.book.tickets.find((x) => x.id === ticket);
  const types = data.handoffs.handoffs;
  const [type, setType] = useState(types[1]?.id ?? "");
  const [detail, setDetail] = useState("");
  const [note, setNote] = useState<number>();
  const [askClose, setAskClose] = useState(false);
  if (!t) return null;
  const def = types.find((h) => h.id === type);
  const notes = type !== "resolved" ? handoffNotes(data, game.world, t, type) : [];
  return (
    <Modal
      title={`Hand ${t.id} to dispatch`}
      footer={
        <button
          type="button"
          className="btn primary"
          disabled={type === "resolved" || note === undefined}
          onClick={() => {
            const r = act({
              t: "handoff",
              ticket: t.id,
              handoff: type,
              note: note ?? 0,
              detail: detail.trim(),
              askClose: type === "customer-question" && askClose,
            });
            if (r.ok) setDialog(null);
          }}
        >
          Send to dispatch
        </button>
      }
    >
      <h3>What does dispatch need to do?</h3>
      {types.map((h) => (
        <label key={h.id} className={`choice ${type === h.id ? "on" : ""}`}>
          <input
            type="radio"
            checked={type === h.id}
            onChange={() => {
              setType(h.id);
              setNote(undefined);
            }}
          />
          <span>
            <b>{h.name}</b> <span className="dim">· {h.detail}</span>
          </span>
        </label>
      ))}
      {type === "resolved" ? (
        <p className="warn">Use Resolve on the ticket to close it with a resolution note.</p>
      ) : (
        <>
          <h3>{def?.detail}</h3>
          <input
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            style={{ width: "100%" }}
            aria-label="Detail"
          />
          {type === "customer-question" && (
            <label className="choice" style={{ marginTop: 8 }}>
              <input
                type="checkbox"
                checked={askClose}
                onChange={(e) => setAskClose(e.target.checked)}
              />
              <span>Ask the client to test it and confirm it is good to close.</span>
            </label>
          )}
          <h3>Ticket note</h3>
          {notes.map((n, i) => (
            <label key={n.text} className={`choice ${note === i ? "on" : ""}`}>
              <input type="radio" checked={note === i} onChange={() => setNote(i)} />
              <span>{n.text}</span>
            </label>
          ))}
        </>
      )}
    </Modal>
  );
}

function Resolve({ ticket }: { ticket: string }) {
  const game = useGame();
  const { act, setDialog, say } = useUi();
  const [pick, setPick] = useState<number>();
  const t = game.book.tickets.find((x) => x.id === ticket);
  const c = game.world.cases.find((x) => x.caseId === t?.caseId);
  if (!t) return null;
  // A ticket with nothing to fix still gets notes, so the dialog does not give away a misroute.
  const notes = c ? resolutionNotes(game.world, t, c).map((n) => n.lines) : plainResolutionNotes(t);
  const blockers = closeBlockers(t);
  return (
    <Modal
      title={`Resolve ${t.id}`}
      footer={
        <button
          type="button"
          className="btn primary"
          disabled={pick === undefined}
          onClick={() => {
            const r = act({ t: "resolve", ticket: t.id, note: pick ?? 0 });
            if (r.ok) {
              setDialog(null);
              say(`${t.id} closed.`);
            }
          }}
        >
          Close ticket
        </button>
      }
    >
      <h3>Closing rule</h3>
      <ul className="checklist">
        {blockers.length === 0 ? (
          <li className="ok">
            Proof attached{t.origin === "client" ? " and the client confirmed" : ""}.
          </li>
        ) : (
          blockers.map((b) => (
            <li key={b} className="warn">
              {b}
            </li>
          ))
        )}
      </ul>
      {blockers.length > 0 && (
        <p className="dim">
          You can still close it. A close without proof costs rating, and if it is not really fixed
          it comes back.
        </p>
      )}
      <h3>Pick the resolution note</h3>
      {notes.map((n, i) => (
        <label key={n.join()} className={`choice ${pick === i ? "on" : ""}`}>
          <input type="radio" checked={pick === i} onChange={() => setPick(i)} />
          <span className="lines">{n.join("\n")}</span>
        </label>
      ))}
    </Modal>
  );
}

function SendBack({ ticket }: { ticket: string }) {
  const game = useGame();
  const { act, setDialog } = useUi();
  const [reason, setReason] = useState<string>();
  const t = game.book.tickets.find((x) => x.id === ticket);
  if (!t) return null;
  return (
    <Modal
      title={`Send ${t.id} back to dispatch`}
      footer={
        <button
          type="button"
          className="btn primary"
          disabled={!reason}
          onClick={() => {
            const r = act({ t: "send-back", ticket: t.id, reason: reason ?? "" });
            if (r.ok) setDialog(null);
          }}
        >
          Send back
        </button>
      }
    >
      <p className="dim">
        Send back only what the network team should not work. A real network problem sent back costs
        rating.
      </p>
      {data.handoffs.sendBack.map((r) => (
        <label key={r.id} className={`choice ${reason === r.id ? "on" : ""}`}>
          <input type="radio" checked={reason === r.id} onChange={() => setReason(r.id)} />
          <span>{r.name}</span>
        </label>
      ))}
    </Modal>
  );
}

function Web({ from, address }: { from: string; address: string }) {
  const game = useGame();
  const page = webPage(game.world, game.clock.now, from, address);
  const host = game.world.devices.find((d) => d.id === from)?.hostname;
  return (
    <Modal
      title={`Browser on ${host}`}
      footer={<span className="dim">Read only in this build. Make changes over SSH.</span>}
    >
      <div className="web">
        <div className="url">https://{address}</div>
        {page.ok ? (
          <>
            <div className="bar">{page.title}</div>
            {page.sections?.map((s) => (
              <div key={s.heading}>
                <h4>{s.heading}</h4>
                <table>
                  <tbody>
                    {s.rows.map((r) => (
                      <tr key={r.join("|")}>
                        {r.map((c, i) => (
                          <td key={`${i}-${c}`}>{c}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </>
        ) : (
          <p style={{ padding: 16 }}>{page.error}</p>
        )}
      </div>
    </Modal>
  );
}
