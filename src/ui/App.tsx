import { useEffect, useRef, useState } from "react";
import { SLOTS, formatTime, ovikView, totalScore } from "../engine";
import { DebugView } from "./debug/DebugView";
import { Desk } from "./desk/Desk";
import { Dialogs } from "./desk/Dialogs";
import { diagCounts } from "./diag";
import { DocsView } from "./docs/Docs";
import { KbView } from "./kb/Kb";
import { OvikPage } from "./ovik/Ovik";
import { RmmPage } from "./rmm/Rmm";
import { ScoreToast } from "./score/Score";
import { type Tab, data, openCount, useGame, useUi } from "./store";
import { Terminal } from "./terminal/Terminal";

export const fmt = (min: number) => formatTime(data.calendar, min);

export function App() {
  const { game, loadSlot, start, tab } = useUi();
  useEffect(() => {
    // Resume slot 1 if it has a save, otherwise start a fresh shift.
    loadSlot(1).then(() => {
      if (!useUi.getState().game) start("first-shift");
    });
  }, [loadSlot, start]);
  if (!game)
    return (
      <p className="dim" style={{ padding: 16 }}>
        Building the client...
      </p>
    );
  return (
    <div className="app">
      <TopBar />
      {tab === "desk" && <Desk />}
      {tab === "rmm" && <RmmPage />}
      {tab === "ovik" && <OvikPage />}
      {tab === "docs" && (
        <main className="main single">
          <DocsView full />
        </main>
      )}
      {tab === "terminal" && (
        <main className="main single">
          <section className="panel grow">
            <Terminal />
          </section>
        </main>
      )}
      {tab === "kb" && (
        <main className="main single">
          <KbView />
        </main>
      )}
      {tab === "debug" && <DebugView />}
      <StatusBar />
      <Dialogs />
      <ScoreToast />
    </div>
  );
}

const tabs: { id: Tab | null; label: string; group?: string }[] = [
  { id: "desk", label: "LinkWise Desk", group: "ATRIUM" },
  { id: "rmm", label: "Shinobi RMM" },
  { id: null, label: "ScreenLink" },
  { id: "ovik", label: "Ovik" },
  { id: "docs", label: "Hoodoo Docs", group: "|" },
  { id: null, label: "VPN clients" },
  { id: "terminal", label: "Terminal" },
  { id: "kb", label: "Vendor KB" },
];

function TopBar() {
  const game = useGame();
  const { tab, setTab } = useUi();
  const setDialog = useUi((s) => s.setDialog);
  const queue = openCount(game);
  return (
    <header className="topbar">
      <span className="brand">ATRIUM</span>
      <nav className="tabs">
        {tabs.map((t) => (
          <span key={t.label} style={{ display: "contents" }}>
            {t.group === "|" && <span className="sep" />}
            <button
              type="button"
              className={`tab ${tab === t.id ? "on" : ""}`}
              disabled={!t.id}
              title={t.id ? undefined : "Not in this build yet."}
              onClick={() => t.id && setTab(t.id)}
            >
              {t.label}
            </button>
          </span>
        ))}
        <span className="sep" />
        <button
          type="button"
          className={`tab ${tab === "debug" ? "on" : ""}`}
          onClick={() => setTab("debug")}
        >
          Debug
        </button>
      </nav>
      <Clock />
      <div className="stats">
        <span>
          QUEUE <b>{queue}</b>
        </span>
        <button
          type="button"
          className="score-btn"
          onClick={() => setDialog({ kind: "score" })}
          title="Where your points came from"
        >
          SCORE <b>{totalScore(game)}</b>
        </button>
      </div>
    </header>
  );
}

function Clock() {
  const game = useGame();
  const act = useUi((s) => s.act);
  const now = game.clock.now;
  const toMorning = 1440 - (now % 1440) + 480;
  return (
    <div className="actions">
      <span className="mono" style={{ color: "var(--text-hi)" }}>
        {fmt(now).toUpperCase()}
      </span>
      <button
        type="button"
        className="btn small"
        onClick={() => act({ t: "advance", minutes: 15 })}
        title="Wait 15 minutes"
      >
        +15m
      </button>
      <button
        type="button"
        className="btn small"
        onClick={() => act({ t: "advance", minutes: 60 })}
        title="Wait an hour"
      >
        +1h
      </button>
      <button
        type="button"
        className="btn small"
        onClick={() => act({ t: "advance", minutes: toMorning })}
        title="Go home. Back at 08:00."
      >
        Next day
      </button>
    </div>
  );
}

function StatusBar() {
  const game = useGame();
  const { message, slot, setSlot, loadSlot, exportFile, importFile, start, setDialog } = useUi();
  const issues = diagCounts();
  const file = useRef<HTMLInputElement>(null);
  const [seed, setSeed] = useState(game.seed);
  const [pick, setPick] = useState(
    game.caseId ? `case:${game.caseId}` : (game.scenario ?? "slice"),
  );
  const v = ovikView(game.world, game.clock.now);
  const last = game.events[game.events.length - 1];
  const next = game.calendar.filter((c) => c.at >= game.clock.now).sort((a, b) => a.at - b.at)[0];
  return (
    <footer className="statusbar">
      <span>
        {v.collector.online
          ? `Ovik: ${v.alerts.length} active alert${v.alerts.length === 1 ? "" : "s"}`
          : "Ovik: collector offline"}
      </span>
      {next && (
        <span>
          Next: {fmt(next.at)} {next.title}
        </span>
      )}
      {last && (
        <span>
          {fmt(last.at)} {last.text}
        </span>
      )}
      {message && <span className="msg">{message}</span>}
      <span style={{ flex: 1 }} />
      <form
        className="actions"
        onSubmit={(e) => {
          e.preventDefault();
          // A new shift replaces the save in this slot. Ask before throwing work away.
          if (
            game.log.length > 0 &&
            !window.confirm(`Start a new shift? It replaces the save in slot ${slot}.`)
          )
            return;
          start(seed, pick);
        }}
      >
        <select
          value={pick}
          onChange={(e) => setPick(e.target.value)}
          style={{ height: 22, fontSize: 11, padding: "0 4px" }}
          aria-label="Scenario"
          title="What the shift plants on the client"
        >
          {[...data.scenarios.values()].map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
          <optgroup label="One case">
            {/* A single case is built on the one-site quick client. */}
            {[...data.cases.values()]
              .filter((c) =>
                c.requires.sites.every((s) =>
                  (data.scenarios.get("quick")?.sites as string[]).includes(s),
                ),
              )
              .map((c) => (
                <option key={c.id} value={`case:${c.id}`}>
                  {c.name}
                </option>
              ))}
          </optgroup>
        </select>
        <input
          value={seed}
          onChange={(e) => setSeed(e.target.value)}
          style={{ height: 22, width: 120, fontSize: 11 }}
          aria-label="Seed"
        />
        <button type="submit" className="btn small">
          New shift
        </button>
      </form>
      <select
        value={slot}
        onChange={(e) => setSlot(Number(e.target.value))}
        style={{ height: 22, fontSize: 11, padding: "0 4px" }}
        aria-label="Save slot"
      >
        {SLOTS.map((s) => (
          <option key={s} value={s}>
            Slot {s}
          </option>
        ))}
      </select>
      <button type="button" className="btn small" onClick={() => loadSlot(slot)}>
        Load
      </button>
      <button type="button" className="btn small" onClick={exportFile}>
        Export
      </button>
      <button type="button" className="btn small" onClick={() => file.current?.click()}>
        Import
      </button>
      <button
        type="button"
        className="btn small"
        onClick={() => setDialog({ kind: "diag" })}
        title="Errors and the action log, to copy and send back"
      >
        Diagnostics
        {issues.errors > 0 && ` (${issues.errors} error${issues.errors === 1 ? "" : "s"})`}
      </button>
      <button
        type="button"
        className="btn small"
        onClick={() => setDialog({ kind: "bug" })}
        title="Something wrong or confusing? Tell us. It saves with the game details."
      >
        Report bug
      </button>
      <input
        ref={file}
        type="file"
        accept=".json"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) importFile(await f.text());
          e.target.value = "";
        }}
      />
    </footer>
  );
}
