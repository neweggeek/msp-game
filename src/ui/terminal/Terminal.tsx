import { useEffect, useRef, useState } from "react";
import { useGame, useUi } from "../store";

/** Tabs over every open shell: device CLIs and RMM background shells. */
export function Terminal() {
  const game = useGame();
  const { session, setSession, act } = useUi();
  const [line, setLine] = useState("");
  const out = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = Object.values(game.sessions);
  const s = session ? game.sessions[session] : undefined;
  const lines = s?.transcript ?? [];
  useEffect(() => {
    out.current?.scrollTo(0, out.current.scrollHeight);
  });
  const name = (id: string) => {
    const x = game.sessions[id];
    const dev = game.world.devices.find((d) => d.id === x?.deviceId);
    return x?.kind === "rmm"
      ? `${dev?.hostname} (agent)`
      : `SSH ${dev?.hostname} ${x && "address" in x && x.address ? x.address : (dev?.ip ?? "")}`;
  };
  const password = s?.kind === "device" && !!s.login;
  const submit = () => {
    if (!s || s.closed) return;
    const r = act(
      s.kind === "rmm" ? { t: "rmm", session: s.id, line } : { t: "cli", session: s.id, line },
    );
    setLine("");
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
            onClick={() => act({ t: "session-close", session: s.id })}
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
        {lines.slice(0, s && !s.closed ? -1 : undefined).join("\n")}
        {s && !s.closed && (
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
