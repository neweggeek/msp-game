import { useState } from "react";
import { type DashPort, dashboard, formatTime } from "../../engine";
import { data, useGame, useUi } from "../store";

const priorities = ["low", "high", "critical"] as const;

/**
 * The vendor's cloud dashboard. No CLI here: sign in with the login from the docs, then look at
 * ports, read the event log, run a cable test, cycle a port or change a port's PoE.
 */
export function CloudPage() {
  const game = useGame();
  const { act } = useUi();
  const fmt = (m: number) => formatTime(data.calendar, m);
  const [form, setForm] = useState({ username: "", password: "" });
  const [picked, setPicked] = useState<string | undefined>();
  const [out, setOut] = useState<string[]>([]);
  const say = (r: { output?: string[]; error?: string }) =>
    setOut([...(r.output ?? []), ...(r.error ? [r.error] : [])]);
  const docs = game.world.docs.cloud;

  if (!game.cloud) {
    const fromDocs = () => {
      if (!docs) return setOut(["The docs have no cloud dashboard login for this client."]);
      const r = act({ t: "vault-view", device: "cloud" });
      setForm({ username: docs.username, password: r.output?.[1] ?? "" });
    };
    return (
      <main className="main">
        <section className="panel">
          <header>
            <h2>{data.cloud.name}</h2>
            <span className="sub">{data.cloud.url}</span>
          </header>
          <div className="body">
            <dl className="kv">
              <dt>Email</dt>
              <dd>
                <input
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  aria-label="Email"
                />
              </dd>
              <dt>Password</dt>
              <dd>
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  aria-label="Password"
                />
              </dd>
            </dl>
            <div className="actions">
              <button
                type="button"
                className="btn primary"
                onClick={() => say(act({ t: "cloud-login", ...form }))}
              >
                Sign in
              </button>
              <button
                type="button"
                className="btn"
                onClick={fromDocs}
                title="Copy the login from Hoodoo Docs and the password from the vault"
              >
                Fill from docs
              </button>
            </div>
            {out.map((l) => (
              <p key={l} className="mono">
                {l}
              </p>
            ))}
          </div>
        </section>
      </main>
    );
  }

  const view = dashboard(game.world, game.clock.now);
  const dev = view.devices.find((d) => d.id === picked) ?? view.devices[0];
  const run = (a: Parameters<typeof act>[0]) => say(act(a));
  const portRow = (p: DashPort) => (
    <tr key={p.port}>
      <td className="mono">
        {p.port}
        {p.uplink ? " (uplink)" : ""}
      </td>
      <td className={p.status === "connected" ? "ok" : p.status === "disabled" ? "dim" : "warn"}>
        {p.status}
        {p.speed ? ` · ${p.speed}` : ""}
      </td>
      <td className="mono">{p.client ?? ""}</td>
      <td>{p.vlan ?? ""}</td>
      <td>
        {p.poe.capable ? (
          <>
            <select
              value={p.poe.priority}
              aria-label={`PoE priority port ${p.port}`}
              onChange={(e) =>
                run({
                  t: "cloud-port",
                  device: dev?.id ?? "",
                  port: p.port,
                  change: { poePriority: e.target.value as (typeof priorities)[number] },
                })
              }
            >
              {priorities.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>{" "}
            <span className={p.poe.state === "denied" ? "bad" : "dim"}>
              {p.poe.state} {p.poe.powerW > 0 ? `${p.poe.powerW.toFixed(1)} W` : ""}
            </span>{" "}
            <button
              type="button"
              className="btn small"
              onClick={() =>
                run({
                  t: "cloud-port",
                  device: dev?.id ?? "",
                  port: p.port,
                  change: { poeEnabled: !p.poe.enabled },
                })
              }
            >
              {p.poe.enabled ? "PoE off" : "PoE on"}
            </button>
          </>
        ) : (
          <span className="dim">no PoE</span>
        )}
      </td>
      <td>
        <button
          type="button"
          className="btn small"
          title={`Takes about ${data.cloud.cableTestMinutes} minutes`}
          onClick={() => run({ t: "cloud-cable-test", device: dev?.id ?? "", port: p.port })}
        >
          Cable test
        </button>{" "}
        <button
          type="button"
          className="btn small"
          onClick={() => run({ t: "cloud-port-cycle", device: dev?.id ?? "", port: p.port })}
        >
          Cycle
        </button>{" "}
        <button
          type="button"
          className="btn small"
          onClick={() =>
            run({
              t: "cloud-port",
              device: dev?.id ?? "",
              port: p.port,
              change: { enabled: p.status === "disabled" },
            })
          }
        >
          {p.status === "disabled" ? "Enable" : "Disable"}
        </button>
      </td>
    </tr>
  );

  return (
    <main className="main split">
      <section className="col stack">
        <section className="panel">
          <header>
            <h2>{data.cloud.name}</h2>
            <button
              type="button"
              className="btn small"
              onClick={() => {
                act({ t: "cloud-logout" });
                setOut([]);
              }}
            >
              Sign out
            </button>
          </header>
          <table className="grid">
            <thead>
              <tr>
                <th>Name</th>
                <th>Model</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {view.devices.map((d) => (
                <tr key={d.id} className={d.id === dev?.id ? "on" : ""}>
                  <td className="mono">
                    <button type="button" className="btn small" onClick={() => setPicked(d.id)}>
                      {d.name}
                    </button>
                  </td>
                  <td>{d.model}</td>
                  <td className={d.online ? "ok" : "bad"}>
                    {d.online ? "Online" : `Offline since ${fmt(d.lastSeen)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        {out.length > 0 && (
          <section className="panel">
            <header>
              <h2>Tool output</h2>
            </header>
            <div className="body">
              {out.map((l) => (
                <p key={l} className="mono" style={{ margin: 0 }}>
                  {l}
                </p>
              ))}
            </div>
          </section>
        )}
        <section className="panel grow">
          <header>
            <h2>Event log</h2>
          </header>
          <div className="body" style={{ overflow: "auto" }}>
            {view.events.slice(0, 200).map((e) => (
              <p key={`${e.at}-${e.device}-${e.text}`} className="mono" style={{ margin: 0 }}>
                <span className="dim">{fmt(e.at)}</span> {e.device} {e.text}
              </p>
            ))}
          </div>
        </section>
      </section>
      <section className="col stack">
        {dev && (
          <section className="panel grow">
            <header>
              <h2>{dev.name}</h2>
              <span className="sub">
                {dev.model} · {dev.ip} · {dev.firmware} · serial {dev.serial}
                {dev.poe ? ` · PoE ${dev.poe.allocatedW.toFixed(1)} of ${dev.poe.budgetW} W` : ""}
              </span>
            </header>
            {dev.online ? (
              <table className="grid">
                <thead>
                  <tr>
                    <th>Port</th>
                    <th>Status</th>
                    <th>Client</th>
                    <th>VLAN</th>
                    <th>PoE</th>
                    <th>Tools</th>
                  </tr>
                </thead>
                <tbody>{dev.ports.map(portRow)}</tbody>
              </table>
            ) : (
              <div className="body">
                <p className="bad">
                  Offline. Last checked in {fmt(dev.lastSeen)}. Live tools need it online.
                </p>
              </div>
            )}
          </section>
        )}
      </section>
    </main>
  );
}
