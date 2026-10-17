import { caseFixed, docsDiff, netState } from "../../engine";
import { fmt } from "../App";
import { useGame } from "../store";

/** The truth, for building and testing. Spoils every case. */
export function DebugView() {
  const game = useGame();
  const w = game.world;
  const ns = netState(w, game.clock.now);
  const host = (id: string) => w.devices.find((d) => d.id === id)?.hostname ?? id;
  return (
    <main className="main split">
      <section className="col">
        <section className="panel">
          <header>
            <h2>Debug · seed {game.seed}</h2>
            <span className="sub">
              generator v{w.generatorVersion} · {game.log.length} actions · world tries{" "}
              {w.solvability.attempts.world}, fault tries {w.solvability.attempts.faults}, doc tries{" "}
              {w.solvability.attempts.docs}
            </span>
          </header>
          <div className="body">
            <dl className="kv">
              <dt>Client</dt>
              <dd>
                {w.client.name} ({w.client.code}) · {w.client.industry} · tier {w.client.tier} ·
                docs {w.client.staleness}
              </dd>
              <dt>Business hours</dt>
              <dd>
                {Math.floor(w.client.businessHours.start / 60)}:00 to{" "}
                {Math.floor(w.client.businessHours.end / 60)}:00 (hidden from the player)
              </dd>
              <dt>Access</dt>
              <dd className="mono">{w.solvability.access.join(" ")}</dd>
            </dl>
          </div>
        </section>
        <section className="panel grow">
          <header>
            <h2>Cases</h2>
          </header>
          <div className="scroll body">
            {w.cases.map((c) => (
              <div key={c.caseId}>
                <h3>
                  {c.name} ·{" "}
                  {caseFixed(w, c, game.clock.now) ? (
                    <span className="ok">fixed</span>
                  ) : (
                    <span className="bad">broken</span>
                  )}
                </h3>
                <p className="mono dim">
                  {Object.entries(c.bindings)
                    .map(([r, id]) => `${r}=${host(id)}`)
                    .join("  ")}
                </p>
                <p>
                  <b>Root cause:</b> {c.rootCause}
                </p>
                <p>
                  <b>Fix:</b> {c.fix}
                </p>
                <p className="dim">Red herring: {c.redHerring}</p>
                <ul>
                  {c.faults
                    .flatMap((f) => f.clues)
                    .map((cl) => (
                      <li key={cl.id}>
                        <span className="mono dim">[{cl.requires}]</span> {cl.text}
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      </section>
      <section className="col">
        <section className="panel grow">
          <header>
            <h2>Devices (truth)</h2>
            <span className="sub">{w.devices.length}</span>
          </header>
          <div className="scroll">
            <table className="grid">
              <thead>
                <tr>
                  <th>Host</th>
                  <th>Site</th>
                  <th>IP</th>
                  <th>Model</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {w.devices.map((d) => (
                  <tr key={d.id}>
                    <td className="mono">
                      {d.hostname}
                      {d.addedBy && <span className="warn"> +fault</span>}
                    </td>
                    <td>{d.siteId}</td>
                    <td className="mono">{d.ip}</td>
                    <td>{d.model}</td>
                    <td className={ns.online.get(d.id) ? "ok" : "bad"}>
                      {ns.asleep.get(d.id)
                        ? "asleep"
                        : ns.cut.get(d.id)
                          ? "power cut"
                          : ns.online.get(d.id)
                            ? "online"
                            : ns.powered.get(d.id)
                              ? "offline"
                              : "no power"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="panel">
          <header>
            <h2>Docs vs truth</h2>
          </header>
          <div className="scroll" style={{ maxHeight: 180 }}>
            <table className="grid">
              <tbody>
                {docsDiff(w).map((d) => (
                  <tr key={`${d.deviceId}${d.field}`}>
                    <td className="mono">{d.hostname}</td>
                    <td>{d.field}</td>
                    <td className="ok">{d.truth}</td>
                    <td className="bad">{d.docs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="panel">
          <header>
            <h2>Score ledger</h2>
          </header>
          <div className="scroll" style={{ maxHeight: 180 }}>
            <table className="grid">
              <tbody>
                {game.score.map((s, i) => (
                  <tr key={`${s.at}-${i}`}>
                    <td className="mono dim">{fmt(s.at)}</td>
                    <td className={s.points >= 0 ? "ok" : "bad"}>{s.points}</td>
                    <td>{s.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  );
}
