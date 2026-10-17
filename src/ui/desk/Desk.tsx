import { useState } from "react";
import { type Ticket, agents, closeBlockers, ovikView } from "../../engine";
import { fmt } from "../App";
import { DocsView } from "../docs/Docs";
import { KbView } from "../kb/Kb";
import { data, useGame, useUi } from "../store";
import { Terminal } from "../terminal/Terminal";

const prioRank: Record<string, number> = { P1: 0, P2: 1, P3: 2, P4: 3 };

export function Desk() {
  return (
    <main className="main desk">
      <section className="col">
        <Queue />
        <Alerts />
        <Calendar />
      </section>
      <section className="col">
        <TicketView />
        <section className="panel grow" style={{ minHeight: 260 }}>
          <Terminal />
        </section>
      </section>
      <section className="col">
        <DocsView />
        <KbView compact />
      </section>
    </main>
  );
}

/** The response target, while nobody has touched the ticket yet. */
function respondBy(game: ReturnType<typeof useGame>, t: Ticket): string | undefined {
  if (t.respondedAt !== undefined || t.breaches.response !== undefined) return undefined;
  const due = fmt(t.responseDue);
  const sameDay = Math.floor(t.responseDue / 1440) === Math.floor(game.clock.now / 1440);
  return `Respond by ${sameDay ? due.slice(-5) : `${due.slice(0, 3)} ${due.slice(-5)}`}`;
}

function slaLeft(game: ReturnType<typeof useGame>, t: Ticket): string {
  const respond = respondBy(game, t);
  if (respond) return respond;
  const left = t.resolveDue - game.clock.now;
  if (left <= 0) return "SLA breached";
  const d = Math.floor(left / 1440);
  const h = Math.floor((left % 1440) / 60);
  const m = left % 60;
  return d > 0
    ? `SLA ${d}d ${String(h).padStart(2, "0")}h`
    : `SLA ${h}h ${String(m).padStart(2, "0")}m`;
}

function Queue() {
  const game = useGame();
  const { ticket, openTicket } = useUi();
  const [showDone, setShowDone] = useState(false);
  const open = game.book.tickets
    .filter((t) => showDone || (t.closedAt === undefined && !t.sentBack))
    .sort(
      (a, b) =>
        (prioRank[a.priority] ?? 9) - (prioRank[b.priority] ?? 9) || a.resolveDue - b.resolveDue,
    );
  return (
    <section className="panel" style={{ flex: "1 1 50%" }}>
      <header>
        <h2>LinkWise Desk · My queue</h2>
        <label className="sub">
          <input
            type="checkbox"
            checked={showDone}
            onChange={(e) => setShowDone(e.target.checked)}
          />{" "}
          show done
        </label>
      </header>
      <div className="scroll">
        {open.length === 0 && <p className="body dim">Queue is empty. Nice work.</p>}
        {open.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`q-item ${ticket === t.id ? "on" : ""}`}
            onClick={() => openTicket(t.id)}
          >
            <span className="row">
              <span className={`prio-${t.priority}`}>
                {t.priority} · #{t.id.slice(2)}
              </span>
              <span className="accent">
                {t.closedAt !== undefined ? "Closed" : t.sentBack ? "Sent back" : slaLeft(game, t)}
              </span>
            </span>
            <span className="client">
              {game.world.client.name} <span className="dim">· {data_status(t.status)}</span>
            </span>
            <span className="title">{t.title}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

const data_status = (id: string) => data.tickets.statuses.find((s) => s.id === id)?.name ?? id;

function Alerts() {
  const game = useGame();
  const setTab = useUi((s) => s.setTab);
  const v = ovikView(game.world, game.clock.now);
  return (
    <section className="panel" style={{ flex: "0 1 30%" }}>
      <header>
        <h2>Ovik alerts</h2>
        <button type="button" className="btn small" onClick={() => setTab("ovik")}>
          Open Ovik
        </button>
      </header>
      <div className="scroll">
        {!v.collector.online && (
          <div className="alert bad">
            Collector {v.collector.hostname} is not reporting. Everything shows unknown.
          </div>
        )}
        {v.alerts.length === 0 && v.collector.online && (
          <div className="alert dim">No active alerts.</div>
        )}
        {v.alerts.map((a) => (
          <div key={a.deviceId} className="alert">
            <span className="mono">{a.hostname}</span> <span className="dim">{a.ip}</span> not
            responding{a.since ? ` since ${fmt(a.since)}` : ""}
          </div>
        ))}
      </div>
    </section>
  );
}

function Calendar() {
  const game = useGame();
  const items = [...game.calendar].sort((a, b) => a.at - b.at);
  return (
    <section className="panel" style={{ flex: "0 1 20%" }}>
      <header>
        <h2>Calendar</h2>
        <span className="sub">{fmt(game.clock.now).slice(0, 10)}</span>
      </header>
      <div className="scroll">
        {items.length === 0 && <div className="alert dim">Nothing booked.</div>}
        {items.map((c) => (
          <div
            key={`${c.at}${c.ticketId}`}
            className={`alert ${c.at < game.clock.now ? "dim" : ""}`}
          >
            <span className="mono">{fmt(c.at)}</span> {c.title}
          </div>
        ))}
      </div>
    </section>
  );
}

function TicketView() {
  const game = useGame();
  const { ticket, act, setDialog, setTab, session } = useUi();
  const [note, setNote] = useState("");
  const t = game.book.tickets.find((x) => x.id === ticket);
  if (!t)
    return (
      <section className="panel" style={{ flex: "1 1 auto" }}>
        <div className="body dim">Pick a ticket from the queue.</div>
      </section>
    );
  const closed = t.closedAt !== undefined || !!t.sentBack;
  const rows = agents(game.world, game.clock.now);
  const online = rows.filter((r) => r.online).length;
  const blockers = closeBlockers(t);
  const sessions = Object.values(game.sessions).filter((s) => s.last);
  const worked = t.openedAt !== undefined ? game.clock.now - t.openedAt : 0;
  const contact =
    game.world.client.contacts.find((c) => c.name === t.contact) ?? game.world.client.contacts[0];
  return (
    <section className="panel" style={{ flex: "1 1 auto", maxHeight: "60%" }}>
      <div className="body">
        <div className="ticket-head">
          <div className="meta">
            #{t.id.slice(2)} · <span className={`prio-${t.priority}`}>{t.priority}</span> ·{" "}
            {game.world.client.managed ? "Managed client" : "Not managed"} ·{" "}
            {t.origin === "alert"
              ? "From Ovik"
              : t.origin === "tech"
                ? "Opened by a tech"
                : `Reported by ${t.contact ?? "client"}`}{" "}
            · {data_status(t.status)}
          </div>
          {!closed && respondBy(game, t) && (
            <div className="warn" style={{ fontSize: 12, marginBottom: 4 }}>
              {respondBy(game, t)}. A ticket note, a handoff or a close counts as a response.
            </div>
          )}
          <h1>
            {game.world.client.name}: {t.title}
          </h1>
        </div>
        <div className="dispatch">
          <b>Dispatch note:</b> {t.body}
        </div>
        <div className="cards">
          <div className="card">
            <span className="k">RMM agents</span>
            <span>
              {online} of {rows.length} online
            </span>
            <button type="button" className="btn small" onClick={() => setTab("rmm")}>
              Open Shinobi RMM
            </button>
          </div>
          <div className="card off">
            <span className="k">Site VPN</span>
            <span>Not in this build</span>
          </div>
          <div className="card">
            <span className="k">Remote hands</span>
            <span>
              {contact?.name}, {contact?.role}
            </span>
            <span className="dim">{contact?.phone} · ask through Customer question</span>
          </div>
          <div className="card off">
            <span className="k">Console / truck roll</span>
            <span>Onsite work comes later</span>
          </div>
        </div>
        <h3>History</h3>
        <div className="history">
          {t.history.map((h, i) => (
            <div
              key={`${h.at}-${i}`}
              className={`entry ${h.by === "client" ? "client" : h.by === "dispatch" ? "dispatch" : ""}`}
            >
              <div className="who">
                {fmt(h.at)} · {h.by}
              </div>
              {h.text}
            </div>
          ))}
        </div>
        {t.proofs.length > 0 && (
          <>
            <h3>Proof attached</h3>
            {t.proofs.map((p, i) => (
              <details key={`${p.at}-${i}`} className="history">
                <summary className="mono">
                  {fmt(p.at)} {p.source}
                </summary>
                <pre className="term-out" style={{ margin: 0, minHeight: 0 }}>
                  {p.lines.join("\n")}
                </pre>
              </details>
            ))}
          </>
        )}
        {!closed && (
          <>
            <h3>Closing rule</h3>
            <ul className="checklist">
              {blockers.length === 0 ? (
                <li className="ok">Ready to close.</li>
              ) : (
                blockers.map((b) => (
                  <li key={b} className="warn">
                    {b}
                  </li>
                ))
              )}
            </ul>
            <h3>Ticket notes · root cause, fix, device name and IP</h3>
            <div className="actions">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                style={{ flex: 1 }}
                placeholder="Internal note"
              />
              <button
                type="button"
                className="btn"
                disabled={!note.trim()}
                onClick={() => {
                  act({ t: "ticket-note", ticket: t.id, text: note.trim() });
                  setNote("");
                }}
              >
                Add note
              </button>
            </div>
            <div className="actions" style={{ marginTop: 10 }}>
              <span className="mono dim">
                Time on ticket {String(Math.floor(worked / 60)).padStart(2, "0")}:
                {String(worked % 60).padStart(2, "0")}
              </span>
              <span style={{ flex: 1 }} />
              <select
                value=""
                onChange={(e) =>
                  e.target.value && act({ t: "attach-proof", ticket: t.id, source: e.target.value })
                }
                style={{ height: 30 }}
                aria-label="Attach output"
              >
                <option value="">Attach output...</option>
                <option value="ovik">Ovik status of the device</option>
                {sessions.map((s) => {
                  const host = game.world.devices.find((d) => d.id === s.deviceId)?.hostname;
                  const outs = s.outputs ?? (s.last ? [s.last] : []);
                  return (
                    <optgroup
                      key={s.id}
                      label={`${host}${s.id === session ? " (current tab)" : ""}`}
                    >
                      {outs
                        .map((o, i) => ({ o, i }))
                        .reverse()
                        .map(({ o, i }) => (
                          <option key={`${s.id}#${i}`} value={s.outputs ? `${s.id}#${i}` : s.id}>
                            {o.line}
                          </option>
                        ))}
                    </optgroup>
                  );
                })}
              </select>
              <button
                type="button"
                className="btn"
                onClick={() => setDialog({ kind: "send-back", ticket: t.id })}
              >
                Send back
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => setDialog({ kind: "handoff", ticket: t.id })}
              >
                Hand to dispatch
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={() => setDialog({ kind: "resolve", ticket: t.id })}
              >
                Resolve
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
