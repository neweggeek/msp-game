import { useState } from "react";
import { authenticator, formatTime, newVpnState, vpnLink } from "../../engine";
import { data, useGame, useUi } from "../store";
import { Terminal } from "../terminal/Terminal";

/**
 * Your laptop's VPN apps, outside Atrium. Pick the app the firewall needs, type the profile from
 * the docs, then a code from the MSP authenticator. SSH from the laptop terminal once connected.
 */
export function VpnPage() {
  const game = useGame();
  const { act, setSession } = useUi();
  const fmt = (m: number) => formatTime(data.calendar, m);
  const vs = game.vpn ?? newVpnState(data);
  const installed = data.vpn.apps.filter((a) => vs.apps[a.brand]);
  const profile = game.world.docs.sites.find((s) => s.vpn)?.vpn;
  const [form, setForm] = useState({
    app: installed[0]?.name ?? "",
    gateway: "",
    port: "",
    username: "",
    password: "",
    code: "",
  });
  const [out, setOut] = useState<string[]>([]);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm({ ...form, [k]: e.target.value });
  const link = vpnLink(game.vpn, game.world, game.clock.now);
  const say = (lines: string[] | undefined, error?: string) =>
    setOut([...(lines ?? []), ...(error ? [error] : [])]);
  const fromDocs = () => {
    if (!profile) return say(["The docs have no VPN profile for this client."]);
    const r = act({ t: "vault-view", device: "vpn-hq" });
    setForm({
      ...form,
      app: profile.app,
      gateway: profile.gateway,
      port: String(profile.port),
      username: profile.username,
      password: r.output?.[1] ?? "",
    });
  };
  const connect = () => {
    const r = act({
      t: "vpn-connect",
      app: form.app,
      gateway: form.gateway.trim(),
      port: Number(form.port),
      username: form.username.trim(),
      password: form.password,
      code: form.code.trim() || undefined,
    });
    setForm({ ...form, code: "" });
    say(r.output, r.error);
  };
  const codes = authenticator(game.world, data, game.clock.now);
  return (
    <main className="main split">
      <section className="col stack">
        <section className="panel">
          <header>
            <h2>VPN clients</h2>
            <span className="sub">On your laptop</span>
          </header>
          <table className="grid">
            <thead>
              <tr>
                <th>App</th>
                <th>Installed</th>
                <th>Newest</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {installed.map((a) => (
                <tr key={a.brand}>
                  <td>{a.name}</td>
                  <td className="mono">{vs.apps[a.brand]}</td>
                  <td className="mono dim">{a.latest}</td>
                  <td>
                    {vs.apps[a.brand] !== a.latest && (
                      <button
                        type="button"
                        className="btn small"
                        title={`Takes about ${data.vpn.upgradeMinutes} minutes`}
                        onClick={() => {
                          const r = act({ t: "vpn-upgrade", app: a.name });
                          say(r.output, r.error);
                        }}
                      >
                        Update
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="panel">
          <header>
            <h2>Connect</h2>
            <span className={link ? "ok" : "sub"}>
              {link && game.vpn?.conn
                ? `Connected to ${game.vpn.conn.gateway} since ${fmt(game.vpn.conn.since)}`
                : "Not connected"}
            </span>
          </header>
          <div className="body">
            <dl className="kv">
              <dt>App</dt>
              <dd>
                <select value={form.app} onChange={set("app")} aria-label="VPN app">
                  {installed.map((a) => (
                    <option key={a.brand} value={a.name}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </dd>
              <dt>Gateway</dt>
              <dd>
                <input value={form.gateway} onChange={set("gateway")} aria-label="Gateway" />
              </dd>
              <dt>Port</dt>
              <dd>
                <input value={form.port} onChange={set("port")} aria-label="Port" />
              </dd>
              <dt>Username</dt>
              <dd>
                <input value={form.username} onChange={set("username")} aria-label="Username" />
              </dd>
              <dt>Password</dt>
              <dd>
                <input
                  type="password"
                  value={form.password}
                  onChange={set("password")}
                  aria-label="Password"
                />
              </dd>
              <dt>Token code</dt>
              <dd>
                <input
                  value={form.code}
                  onChange={set("code")}
                  onKeyDown={(e) => e.key === "Enter" && connect()}
                  placeholder="From the authenticator. Blank for push."
                  aria-label="Token code"
                />
              </dd>
            </dl>
            <div className="actions">
              <button type="button" className="btn primary" onClick={connect}>
                Connect
              </button>
              <button
                type="button"
                className="btn"
                onClick={fromDocs}
                title="Copy the profile from Hoodoo Docs and the password from the vault"
              >
                Fill from docs
              </button>
              {link && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => say(act({ t: "vpn-disconnect" }).output)}
                >
                  Disconnect
                </button>
              )}
            </div>
            {out.map((l) => (
              <p key={l} className="mono">
                {l}
              </p>
            ))}
          </div>
        </section>
        <section className="panel">
          <header>
            <h2>MSP authenticator</h2>
            <span className="sub">On your phone</span>
          </header>
          <div className="body">
            {codes.length === 0 && <p className="dim">No accounts for this client.</p>}
            {codes.map((c) => (
              <div key={c.fwId}>
                <p className="dim" style={{ margin: 0 }}>
                  {c.label}
                </p>
                {c.mfa === "totp" ? (
                  <p>
                    <span className="mono" style={{ fontSize: 22, letterSpacing: 2 }}>
                      {c.code?.replace(/(\d{3})(\d{3})/, "$1 $2")}
                    </span>{" "}
                    <span className="dim">changes at {fmt(c.changesAt ?? game.clock.now)}</span>
                  </p>
                ) : (
                  <p className="dim">Push sign-in. Requests show up here.</p>
                )}
              </div>
            ))}
            {game.vpn?.push && (
              <div className="actions">
                <span className="warn">Sign-in request from {game.vpn.push.gateway}.</span>
                <button
                  type="button"
                  className="btn small primary"
                  onClick={() => {
                    const r = act({ t: "vpn-push", approve: true });
                    say(r.output, r.error);
                  }}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="btn small"
                  onClick={() => {
                    const r = act({ t: "vpn-push", approve: false });
                    say(r.output, r.error);
                  }}
                >
                  Deny
                </button>
              </div>
            )}
          </div>
        </section>
      </section>
      <section className="col">
        <section className="panel grow">
          <header>
            <h2>Terminal</h2>
            <button
              type="button"
              className="btn small"
              onClick={() => {
                const r = act({ t: "local-open" });
                if (r.session) setSession(r.session);
              }}
            >
              Open laptop terminal
            </button>
          </header>
          <Terminal />
        </section>
      </section>
    </main>
  );
}
