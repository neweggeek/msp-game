import { useEffect, useMemo, useRef, useState } from "react";
import {
  type Device,
  type Priority,
  SLOTS,
  docsDiff,
  formatTime,
  netState,
  prompt,
} from "../../engine";
import { data, useUi } from "../store";

const fmt = (min: number) => formatTime(data.calendar, min);
const roomName = (game: NonNullable<ReturnType<typeof useUi.getState>["game"]>, id: string) =>
  game.world.site.rooms.find((r) => r.id === id)?.name ?? id;

export function DebugView() {
  const { game, loadSlot, generate } = useUi();
  useEffect(() => {
    // Resume slot 1 if it has a save, otherwise start a fresh seed.
    loadSlot(1).then(() => {
      if (!useUi.getState().game) generate("camera-day");
    });
  }, [loadSlot, generate]);

  return (
    <div className="app">
      <TopBar />
      {game ? (
        <main className="grid">
          <section className="col">
            <ClientPanel />
            <SiteTree />
          </section>
          <section className="col">
            <DeviceDetail />
            <Terminal />
          </section>
          <section className="col">
            <CasePanel />
            <TicketsPanel />
          </section>
        </main>
      ) : (
        <p className="empty">Generating...</p>
      )}
    </div>
  );
}

function TopBar() {
  const { game, generate, slot, setSlot, loadSlot, exportFile, importFile, message } = useUi();
  const [seed, setSeed] = useState("camera-day");
  const file = useRef<HTMLInputElement>(null);
  return (
    <header className="topbar">
      <strong>MSP Game: Phase 0 debug</strong>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          generate(seed.trim() || "seed");
        }}
      >
        <input value={seed} onChange={(e) => setSeed(e.target.value)} aria-label="Seed" />
        <button type="submit">Generate</button>
        <button
          type="button"
          onClick={() => {
            const s = Math.random().toString(36).slice(2, 8);
            setSeed(s);
            generate(s);
          }}
        >
          Random
        </button>
      </form>
      <span className="sep" />
      <label>
        Slot{" "}
        <select value={slot} onChange={(e) => setSlot(Number(e.target.value))}>
          {SLOTS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <button type="button" onClick={() => loadSlot(slot)}>
        Load slot
      </button>
      <button type="button" onClick={exportFile} disabled={!game}>
        Export
      </button>
      <button type="button" onClick={() => file.current?.click()}>
        Import
      </button>
      <input
        ref={file}
        type="file"
        accept="application/json"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) importFile(await f.text());
          e.target.value = "";
        }}
      />
      <span className="msg">{message}</span>
      {game && (
        <span className="muted">
          seed "{game.seed}" · {game.log.length} actions · autosaves to slot {slot}
        </span>
      )}
    </header>
  );
}

function ClientPanel() {
  const { game } = useUi();
  if (!game) return null;
  const c = game.world.client;
  const hh = (m: number) =>
    `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return (
    <div className="panel">
      <h2>{c.name}</h2>
      <dl>
        <dt>Tier</dt>
        <dd>
          {c.tier} · {c.industry} · {c.headcount} staff
        </dd>
        <dt>Docs</dt>
        <dd>{c.staleness}</dd>
        <dt>Hours (hidden)</dt>
        <dd>
          {hh(c.businessHours.start)} to {hh(c.businessHours.end)}
        </dd>
        <dt>After hours</dt>
        <dd>{c.afterHoursWindow.label}</dd>
        <dt>Contact pref</dt>
        <dd>{c.contactPreference}</dd>
        <dt>ISP</dt>
        <dd>
          {game.world.network.isp.name} · {game.world.network.isp.circuitId} ·{" "}
          {game.world.network.isp.wanIp}
        </dd>
      </dl>
      <h3>Contacts</h3>
      <ul className="plain">
        {c.contacts.map((p) => (
          <li key={p.id}>
            {p.name}, {p.role} · competence {p.competence} · {p.availability}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SiteTree() {
  const { game, rev, selected, select } = useUi();
  const ns = useMemo(() => (game ? netState(game.world) : null), [game, rev]);
  if (!game || !ns) return null;
  const w = game.world;
  return (
    <div className="panel">
      <h2>{w.site.name}</h2>
      <p className="muted">
        {w.site.address} · {w.site.rooms.length} rooms · floor plan in docs:{" "}
        {w.docs.floorPlan ? "yes" : "no"}
      </p>
      {w.site.rooms.map((r) => {
        const devs = w.devices.filter((d) => d.roomId === r.id);
        return (
          <div key={r.id} className="room">
            <div className="roomname">
              {r.name}
              {r.locked ? " (locked)" : ""}
              {r.networkCloset ? " · closet" : ""}
            </div>
            {devs.map((d) => (
              <button
                type="button"
                key={d.id}
                className={`dev ${selected === d.id ? "sel" : ""}`}
                onClick={() => select(d.id)}
              >
                <span className={`dot ${ns.online.get(d.id) ? "up" : "down"}`} />
                {d.hostname}{" "}
                <span className="muted">
                  {d.kind}
                  {d.undocumented ? " · undocumented" : ""}
                </span>
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function DeviceDetail() {
  const { game, rev, selected, showDocs, setShowDocs, act, setSession } = useUi();
  const ns = useMemo(() => (game ? netState(game.world) : null), [game, rev]);
  if (!game || !ns) return null;
  const w = game.world;
  const d =
    w.devices.find((x) => x.id === selected) ?? w.devices.find((x) => x.kind === "firewall");
  if (!d) return null;
  const doc = w.docs.devices.find((x) => x.deviceId === d.id);
  const diffs = docsDiff(w).filter((x) => x.deviceId === d.id);
  const bad = (f: string) => (diffs.some((x) => x.field === f) ? "stale" : "");
  const poe = d.kind === "switch" ? ns.poe.get(d.id) : undefined;
  const cred = w.docs.credentials.find((c) => c.deviceId === d.id);

  return (
    <div className="panel">
      <div className="row">
        <h2>{d.hostname}</h2>
        <label className="toggle">
          <input
            type="checkbox"
            checked={showDocs}
            onChange={(e) => setShowDocs(e.target.checked)}
          />{" "}
          show docs view
        </label>
        {d.dialect && (
          <button
            type="button"
            onClick={() => {
              const r = act({ t: "cli-open", device: d.id });
              if (r.session) setSession(r.session);
            }}
          >
            Open terminal
          </button>
        )}
      </div>
      {showDocs ? (
        doc ? (
          <dl>
            <dt>Model</dt>
            <dd>{doc.model}</dd>
            <dt>IP</dt>
            <dd className={bad("ip")}>{doc.ip ?? "none"}</dd>
            <dt>Firmware</dt>
            <dd className={bad("firmware")}>{doc.firmware}</dd>
            <dt>Room</dt>
            <dd>{roomName(game, doc.roomId)}</dd>
            <dt>Credentials</dt>
            <dd className={bad("credential")}>
              {cred ? `${cred.username} / ${cred.password}` : d.credentials ? "missing" : "n/a"}
            </dd>
          </dl>
        ) : (
          <p className="stale">
            Not in docs{d.undocumented ? " (added by a fault)" : " (lost to staleness)"}.
          </p>
        )
      ) : (
        <dl>
          <dt>Model</dt>
          <dd>
            {d.model} ({d.brand})
          </dd>
          <dt>IP</dt>
          <dd className={bad("ip")}>
            {d.ip ?? "none"} {d.vlan ? `· VLAN ${d.vlan}` : ""}
          </dd>
          <dt>Firmware</dt>
          <dd className={bad("firmware")}>{d.firmware}</dd>
          <dt>Serial / MAC</dt>
          <dd>
            {d.serial} · {d.mac}
          </dd>
          <dt>Room</dt>
          <dd>{roomName(game, d.roomId)}</dd>
          <dt>State</dt>
          <dd>
            {ns.online.get(d.id) ? "online" : "offline"}
            {d.poe
              ? ` · PoE class ${d.poe.class}, ${d.poe.drawW} W, ${ns.powered.get(d.id) ? "powered" : "no power"}`
              : ""}
          </dd>
          <dt>RMM agent</dt>
          <dd>{d.rmmAgent ? "yes" : "no"}</dd>
          {d.credentials && (
            <>
              <dt>Credentials</dt>
              <dd className={bad("credential")}>
                {d.credentials.username} / {d.credentials.password}
              </dd>
            </>
          )}
          {d.addedBy && (
            <>
              <dt>Added by</dt>
              <dd className="stale">{d.addedBy}</dd>
            </>
          )}
        </dl>
      )}
      {poe && <PoeTable sw={d} />}
      {!poe && d.ports.some((p) => p.link) && (
        <p className="muted">
          Ports:{" "}
          {d.ports
            .filter((p) => p.link)
            .map(
              (p) =>
                `${p.name} to ${w.devices.find((x) => x.id === p.link?.device)?.hostname}:${p.link?.port}`,
            )
            .join(", ")}
        </p>
      )}
    </div>
  );
}

function PoeTable({ sw }: { sw: Device }) {
  const { game, rev } = useUi();
  const poe = useMemo(
    () => (game ? netState(game.world).poe.get(sw.id) : undefined),
    [game, rev, sw.id],
  );
  if (!game || !poe) return null;
  const over = poe.requestedW > poe.budgetW;
  return (
    <>
      <p className={over ? "stale" : "muted"}>
        PoE budget {poe.budgetW} W · requested {poe.requestedW.toFixed(1)} W · allocated{" "}
        {poe.allocatedW.toFixed(1)} W
      </p>
      <table>
        <thead>
          <tr>
            <th>Port</th>
            <th>Device</th>
            <th>VLAN</th>
            <th>PoE</th>
            <th>Prio</th>
            <th>W</th>
          </tr>
        </thead>
        <tbody>
          {sw.ports.map((p) => {
            const ps = poe.ports.find((x) => x.port === p.name);
            const peer = game.world.devices.find((x) => x.id === p.link?.device);
            return (
              <tr key={p.name} className={ps?.state === "denied" ? "deny" : ""}>
                <td>{p.name}</td>
                <td>{peer?.hostname ?? ""}</td>
                <td>{p.mode === "trunk" ? "trunk" : (p.vlan ?? "")}</td>
                <td>{ps?.state ?? ""}</td>
                <td>{p.poeCapable ? p.poePriority : ""}</td>
                <td>{ps && ps.powerW > 0 ? ps.powerW.toFixed(1) : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

function Terminal() {
  const { game, rev, session, act, setSession } = useUi();
  const [line, setLine] = useState("");
  const [hist, setHist] = useState<string[]>([]);
  const [hi, setHi] = useState(-1);
  const box = useRef<HTMLPreElement>(null);
  const s = session ? game?.sessions[session] : undefined;
  useEffect(() => {
    box.current?.scrollTo(0, box.current.scrollHeight);
  }, [rev, session]);
  if (!game) return null;
  const open = Object.values(game.sessions);
  return (
    <div className="panel">
      <div className="row">
        <h2>Terminal</h2>
        <select value={session ?? ""} onChange={(e) => setSession(e.target.value || undefined)}>
          <option value="">No session</option>
          {open.map((x) => (
            <option key={x.id} value={x.id}>
              {x.id} · {game.world.devices.find((d) => d.id === x.deviceId)?.hostname}
              {x.closed ? " (closed)" : ""}
            </option>
          ))}
        </select>
      </div>
      {s ? (
        <>
          <pre className="term" ref={box}>
            {s.transcript.slice(0, -1).join("\n")}
          </pre>
          <form
            className="termline"
            onSubmit={(e) => {
              e.preventDefault();
              act({ t: "cli", session: s.id, line });
              if (line.trim()) setHist([line, ...hist]);
              setHi(-1);
              setLine("");
            }}
          >
            <span>
              {s.closed
                ? "(closed) "
                : (s.transcript[s.transcript.length - 1] ??
                  prompt(s, {
                    world: game.world,
                    dialect: data.dialects.get(s.dialect) as never,
                    time: "",
                  }))}
            </span>
            <input
              value={line}
              disabled={s.closed}
              spellCheck={false}
              onChange={(e) => setLine(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowUp" && hist.length) {
                  const n = Math.min(hi + 1, hist.length - 1);
                  setHi(n);
                  setLine(hist[n] ?? "");
                  e.preventDefault();
                }
                if (e.key === "ArrowDown") {
                  const n = Math.max(hi - 1, -1);
                  setHi(n);
                  setLine(n < 0 ? "" : (hist[n] ?? ""));
                  e.preventDefault();
                }
              }}
            />
          </form>
        </>
      ) : (
        <p className="muted">
          Pick the firewall and press Open terminal. Try diagnose switch poe status.
        </p>
      )}
    </div>
  );
}

function CasePanel() {
  const { game, rev } = useUi();
  const diffs = useMemo(() => (game ? docsDiff(game.world) : []), [game, rev]);
  if (!game) return null;
  const { case: c, solvability: sol } = game.world;
  return (
    <div className="panel">
      <h2>Case: {c.name}</h2>
      <p>
        <b>Ticket says:</b> {c.ticketBody}
      </p>
      <p>
        <b>Red herring:</b> {c.redHerring}
      </p>
      <p>
        <b>Root cause:</b> {c.rootCause}
      </p>
      <p>
        <b>Fix:</b> {c.fix}
      </p>
      <h3>Clues</h3>
      <ul className="plain">
        {c.faults
          .flatMap((f) => f.clues)
          .map((cl) => {
            const ok = sol.clues.find((x) => x.id === cl.id)?.reachable;
            return (
              <li key={cl.id}>
                <span className={ok ? "ok" : "stale"}>{ok ? "reachable" : "blocked"}</span> [
                {cl.surface}, needs {cl.requires}] {cl.text}
              </li>
            );
          })}
      </ul>
      <p className="muted">
        Solvable: {sol.solvable ? "yes" : "no"} · access: {sol.access.join(", ")} · tries: world{" "}
        {sol.attempts.world}, faults {sol.attempts.faults}, docs {sol.attempts.docs}
      </p>
      <h3>Docs vs truth ({diffs.length})</h3>
      <ul className="plain">
        {diffs.map((x) => (
          <li key={`${x.deviceId}-${x.field}`}>
            {x.hostname}: {x.field} · truth {x.truth} · docs {x.docs}
          </li>
        ))}
      </ul>
    </div>
  );
}

function TicketsPanel() {
  const { game, act } = useUi();
  const [note, setNote] = useState("");
  if (!game) return null;
  const statuses = data.tickets.statuses.filter((s) => !s.automatic);
  return (
    <div className="panel">
      <div className="row">
        <h2>Tickets</h2>
        <span className="clock">{fmt(game.clock.now)}</span>
      </div>
      <div className="row">
        {[
          ["+15m", 15],
          ["+1h", 60],
          ["+4h", 240],
          ["+1 day", 1440],
          ["+3 days", 4320],
        ].map(([label, m]) => (
          <button
            type="button"
            key={label}
            onClick={() => act({ t: "advance", minutes: m as number })}
          >
            {label}
          </button>
        ))}
      </div>
      {game.book.tickets.map((t) => (
        <div key={t.id} className="ticket">
          <div className="row">
            <b>{t.id}</b> <span className={`prio ${t.priority}`}>{t.priority}</span> {t.title}
          </div>
          <div className="muted">
            {data.tickets.statuses.find((s) => s.id === t.status)?.name} · response due{" "}
            {fmt(t.responseDue)}
            {t.breaches.response !== undefined && <span className="stale"> (breached)</span>} ·
            resolve due {fmt(t.resolveDue)}
            {t.breaches.resolve !== undefined && <span className="stale"> (breached)</span>}
            {t.flaggedP1 && <span className="stale"> · flagged for P1</span>}
          </div>
          <div className="row">
            <select
              value=""
              onChange={(e) =>
                e.target.value && act({ t: "ticket-status", ticket: t.id, status: e.target.value })
              }
            >
              <option value="">Set status...</option>
              {statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <select
              value=""
              onChange={(e) =>
                e.target.value &&
                act({ t: "ticket-priority", ticket: t.id, priority: e.target.value as Priority })
              }
            >
              <option value="">Set priority...</option>
              {(["P1", "P2", "P3", "P4"] as const).map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() =>
                act({ t: "ticket-flag-p1", ticket: t.id, reason: "Flagged from debug view" })
              }
            >
              Flag P1
            </button>
          </div>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              if (note.trim()) act({ t: "ticket-note", ticket: t.id, text: note.trim() });
              setNote("");
            }}
          >
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add note" />
            <button type="submit">Add</button>
          </form>
          <ul className="plain history">
            {[...t.history].reverse().map((h, i) => (
              <li key={`${h.at}-${i}`}>
                <span className="muted">
                  {fmt(h.at)} {h.by}
                </span>{" "}
                {h.text}
              </li>
            ))}
          </ul>
        </div>
      ))}
      <h3>Events</h3>
      <ul className="plain">
        {[...game.events].reverse().map((e, i) => (
          <li key={`${e.at}-${i}`}>
            <span className="muted">{fmt(e.at)}</span> {e.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
