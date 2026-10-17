import { type ReactNode, useEffect, useState } from "react";
import { type GameState, totalScore } from "../../engine";
import { fmt } from "../App";
import { data, useGame, useUi } from "../store";

type ModalProps = { title: string; children: ReactNode; footer: ReactNode };

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/** Points per ticket, plus a row for points that belong to no ticket (doc fixes, lockouts). */
function byTicket(game: GameState) {
  const rows = new Map<string, number>();
  for (const e of game.score) {
    const k = e.ticketId ?? "Other";
    rows.set(k, (rows.get(k) ?? 0) + e.points);
  }
  return [...rows.entries()];
}

/** The score ledger. At the end of a shift it opens on its own as the shift summary. */
export function ScoreDialog({
  Modal,
  summary,
}: {
  Modal: (p: ModalProps) => ReactNode;
  summary: boolean;
}) {
  const game = useGame();
  const setDialog = useUi((s) => s.setDialog);
  const tickets = game.book.tickets;
  const closed = tickets.filter((t) => t.closedAt !== undefined).length;
  const sentBack = tickets.filter((t) => t.sentBack).length;
  const reopened = game.score.filter((e) => e.points < 0 && /reopened/.test(e.reason)).length;
  const worked = game.clock.now - data.calendar.startMinute;
  const title = (id: string) => tickets.find((t) => t.id === id)?.title ?? "";
  return (
    <Modal
      title={summary ? "Shift summary: queue is empty" : "Score"}
      footer={
        <button type="button" className="btn primary" onClick={() => setDialog(null)}>
          {summary ? "Back to the desk" : "Close"}
        </button>
      }
    >
      <p style={{ marginTop: 0 }}>
        Score <b>{totalScore(game)}</b>. {closed} closed, {sentBack} sent back
        {reopened > 0 ? `, ${reopened} reopened` : ""}. {Math.floor(worked / 60)}h{" "}
        {String(worked % 60).padStart(2, "0")}m on the clock.
      </p>
      {summary && (
        <p className="dim">
          Every ticket is closed or sent back. Keep playing on this client, or start a new shift
          from the status bar.
        </p>
      )}
      {game.score.length > 0 && <h3>By ticket</h3>}
      <table className="grid">
        <tbody>
          {byTicket(game).map(([id, pts]) => (
            <tr key={id}>
              <td className="mono">{id}</td>
              <td>{id === "Other" ? "Docs, lockouts and other work" : title(id)}</td>
              <td className={pts >= 0 ? "ok" : "bad"}>{signed(pts)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Every change</h3>
      <div className="scroll" style={{ maxHeight: 260 }}>
        <table className="grid">
          <tbody>
            {[...game.score].reverse().map((e, i) => (
              <tr key={`${e.at}-${i}`}>
                <td className="mono dim">{fmt(e.at)}</td>
                <td className={e.points >= 0 ? "ok" : "bad"}>{signed(e.points)}</td>
                <td>{e.reason}</td>
              </tr>
            ))}
            {game.score.length === 0 && (
              <tr>
                <td className="dim">No points yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

/** A short pop-up with the reason for every score change. */
export function ScoreToast() {
  const toast = useUi((s) => s.toast);
  const [shown, setShown] = useState<number>();
  useEffect(() => {
    if (!toast) return;
    setShown(toast.id);
    const t = window.setTimeout(() => setShown(undefined), 6000);
    return () => window.clearTimeout(t);
  }, [toast]);
  if (!toast || shown !== toast.id) return null;
  return (
    <output className="score-toast" aria-live="polite">
      {toast.entries.map((e, i) => (
        <div key={`${e.at}-${i}`}>
          <b className={e.points >= 0 ? "ok" : "bad"}>{signed(e.points)}</b> {e.reason}
        </div>
      ))}
    </output>
  );
}
