import { useState } from "react";
import { type Device, agents, publicIp } from "../../engine";
import { SortTh, TypeChips, countBy, groupByType, ipKey, typeOf, useSort } from "../assets/assets";
import { data, useGame, useUi } from "../store";
import { Terminal } from "../terminal/Terminal";

type AgentSort = "hostname" | "user" | "siteName" | "ip" | "publicIp" | "status";

export function RmmPage() {
  const game = useGame();
  const { act, setDialog, say } = useUi();
  const [filter, setFilter] = useState("");
  const [sel, setSel] = useState<string>();
  const [address, setAddress] = useState("");
  const [type, setType] = useState("all");
  const { sort, by, cmp } = useSort<AgentSort>("hostname");
  const all = agents(game.world, game.clock.now);
  const rows = all
    .filter((r) => type === "all" || typeOf(r.kind) === type)
    .filter((r) => {
      const f = filter.trim().toLowerCase();
      return (
        !f ||
        [r.hostname, r.user, r.publicIp, r.ip, r.siteName].some((v) => v.toLowerCase().includes(f))
      );
    })
    .sort((a, b) =>
      sort.key === "status"
        ? cmp(String(!a.online), String(!b.online))
        : sort.key === "ip" || sort.key === "publicIp"
          ? cmp(ipKey(a[sort.key]), ipKey(b[sort.key]))
          : cmp(a[sort.key], b[sort.key]),
    );
  const row = rows.find((r) => r.deviceId === sel);
  const consent = sel ? game.consent[sel] : undefined;
  return (
    <main className="main split">
      <section className="col">
        <section className="panel grow">
          <header>
            <h2>Shinobi RMM · {game.world.client.name}</h2>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter: name, user, public IP"
              style={{ width: 240 }}
              aria-label="Filter agents"
            />
          </header>
          <div className="asset-bar">
            <TypeChips
              counts={countBy(all, (r) => typeOf(r.kind))}
              value={type}
              onChange={setType}
            />
          </div>
          <div className="scroll">
            <table className="grid">
              <thead>
                <tr>
                  <SortTh k="hostname" label="Agent" sort={sort} by={by} />
                  <SortTh k="user" label="User" sort={sort} by={by} />
                  <SortTh k="siteName" label="Site" sort={sort} by={by} />
                  <SortTh k="ip" label="LAN IP" sort={sort} by={by} />
                  <SortTh k="publicIp" label="Public IP" sort={sort} by={by} />
                  <SortTh k="status" label="Status" sort={sort} by={by} />
                </tr>
              </thead>
              {groupByType(rows, (r) => typeOf(r.kind)).map((g) => (
                <tbody key={g.id}>
                  <tr className="group">
                    <td colSpan={6}>
                      {g.label} <span className="count">{g.rows.length}</span>
                    </td>
                  </tr>
                  {g.rows.map((r) => (
                    <tr
                      key={r.deviceId}
                      className={r.deviceId === sel ? "sel" : ""}
                      onClick={() => setSel(r.deviceId)}
                      onKeyDown={(e) => e.key === "Enter" && setSel(r.deviceId)}
                      style={{ cursor: "pointer" }}
                    >
                      <td className="mono">{r.hostname}</td>
                      <td>{r.user || <span className="dim">none</span>}</td>
                      <td>{r.siteName}</td>
                      <td className="mono">{r.ip}</td>
                      <td className="mono">{r.publicIp}</td>
                      <td className={r.online ? "ok" : "bad"}>{r.online ? "Online" : "Offline"}</td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        </section>
      </section>
      <section className="col">
        <section className="panel">
          <header>
            <h2>{row ? row.hostname : "Pick an agent"}</h2>
            {row && (
              <span className="sub">
                {row.os} · up {row.uptime}
              </span>
            )}
          </header>
          {row && (
            <div className="body">
              {row.user && (
                <p className={consent !== undefined ? "ok" : "warn"}>
                  {consent !== undefined
                    ? `${row.user} said yes to remote work.`
                    : `${row.user} is signed in. Ask before you touch this PC.`}
                </p>
              )}
              <div className="actions">
                {row.user && consent === undefined && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      const r = act({ t: "consent-request", device: row.deviceId });
                      if (r.output) say(r.output.join(" "));
                    }}
                  >
                    Ask {row.user.split(" ")[0]} for consent
                  </button>
                )}
                <button
                  type="button"
                  className="btn primary"
                  disabled={!row.online}
                  onClick={() => act({ t: "rmm-open", device: row.deviceId })}
                >
                  Open background shell
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled
                  title="ScreenLink is not in this build."
                >
                  ScreenLink session
                </button>
              </div>
              <h3>Run script</h3>
              <div className="actions">
                {[...data.scripts.values()].map((sc) => (
                  <button
                    key={sc.id}
                    type="button"
                    className="btn small"
                    title={sc.description}
                    disabled={!row.online}
                    onClick={() => {
                      const r = act({ t: "rmm-script", device: row.deviceId, script: sc.id });
                      if (r.output) say(r.output.join(" "));
                    }}
                  >
                    {sc.name}
                  </button>
                ))}
              </div>
              <h3>Browser on this agent</h3>
              <form
                className="actions"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (address.trim())
                    setDialog({
                      kind: "web",
                      from: row.deviceId,
                      address: address.trim().replace(/^https?:\/\//, ""),
                    });
                }}
              >
                <span className="mono dim">https://</span>
                <input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="10.x.x.1"
                  aria-label="Address"
                />
                <button type="submit" className="btn small" disabled={!row.online}>
                  Open
                </button>
              </form>
              <p className="dim">
                Public IP as the RMM cloud sees it:{" "}
                {publicIp(
                  game.world,
                  game.world.devices.find((d) => d.id === row.deviceId) as Device,
                )}
              </p>
            </div>
          )}
        </section>
        <section className="panel grow">
          <Terminal />
        </section>
      </section>
    </main>
  );
}
