import { useEffect, useRef, useState } from "react";
import { useGame, useUi } from "../store";
import { playOut, skip, usePace } from "./pace";

/** Commands whose output plays out over time instead of all at once. */
const PACED = /\b(ping|tracert|traceroute|nslookup|ssh)\b/i;

/** Tabs over every open shell: device CLIs and RMM background shells. */
export function Terminal() {
  const game = useGame();
  const { session, setSession, act } = useUi();
  const [line, setLine] = useState("");
  const out = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = Object.values(game.sessions);
  const s = session ? game.sessions[session] : undefined;
  const shown = usePace((p) => (session ? p.shown[session] : undefined));
  const all = s?.transcript ?? [];
  const busy = shown !== undefined;
  const lines = busy ? all.slice(0, shown) : all;
  useEffect(() => {
    out.current?.scrollTo(0, out.current.scrollHeight);
  });
  // Keep the keyboard on the terminal while output plays and when the prompt comes back.
  useEffect(() => {
    if (session) input.current?.focus();
  }, [busy, session]);
  const name = (id: string) => {
    const x = game.sessions[id];
    const dev = game.world.devices.find((d) => d.id === x?.deviceId);
    return x?.kind === "rmm"
      ? `${dev?.hostname} (agent)`
      : `SSH ${dev?.hostname} ${x && "address" in x && x.address ? x.address : (dev?.ip ?? "")}`;
  };
  const password = s?.kind === "device" && !!s.login;
  const submit = () => {
    if (!s || s.closed || busy) return;
    const before = s.transcript.length;
    const r = act(
      s.kind === "rmm" ? { t: "rmm", session: s.id, line } : { t: "cli", session: s.id, line },
    );
    setLine("");
    if (PACED.test(line)) playOut(s.id, s.transcript, before);
    if (r.session && r.session !== s.id) setSession(r.session);
  };
  return (
    <div className="term">
      <div className="term-tabs">
        {list.length === 0 && (
          <span className="term-tab">No sessions. Open a background shell from Shinobi RMM.</span>
        )}
        {list.map((x) => (
          <button
            key={x.id}
            type="button"
            className={`term-tab ${x.id === session ? "on" : ""} ${x.closed ? "closed" : ""}`}
            onClick={() => setSession(x.id)}
          >
            {name(x.id)}
          </button>
        ))}
        {s && !s.closed && (
          <button
            type="button"
            className="term-tab"
            onClick={() => {
              skip(s.id);
              act({ t: "session-close", session: s.id });
            }}
            title="Close this session"
          >
            ×
          </button>
        )}
      </div>
      <div
        className="term-out"
        ref={out}
        onClick={() => input.current?.focus()}
        onKeyDown={() => input.current?.focus()}
        role="log"
      >
        {lines.slice(0, s && !s.closed && !busy ? -1 : undefined).join("\n")}
        {busy && s && (
          <input
            ref={input}
            className="term-busy"
            value=""
            readOnly
            onKeyDown={(e) => {
              if ((e.ctrlKey && e.key === "c") || e.key === "Escape") skip(s.id);
            }}
            aria-label="Command running. Ctrl+C to skip."
            title="Ctrl+C or Esc to skip the wait"
          />
        )}
        {s && !s.closed && !busy && (
          <div className="term-line">
            <span>{lines[lines.length - 1]}</span>
            <input
              ref={input}
              value={line}
              type={password ? "password" : "text"}
              onChange={(e) => setLine(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              spellCheck={false}
              autoComplete="off"
              aria-label="Command"
            />
          </div>
        )}
        {s?.closed && <div className="dim">[session closed]</div>}
      </div>
    </div>
  );
}
