import { ovikView } from "../../engine";
import { fmt } from "../App";
import { useGame } from "../store";

export function OvikPage() {
  const game = useGame();
  const v = ovikView(game.world, game.clock.now);
  return (
    <main className="main split">
      <section className="panel grow">
        <header>
          <h2>Ovik · Inventory</h2>
          <span className={`sub ${v.collector.online ? "ok" : "bad"}`}>
            Collector {v.collector.hostname} ({v.collector.ip}){" "}
            {v.collector.online ? "reporting" : "not reporting"}
          </span>
        </header>
        <div className="scroll">
          <table className="grid">
            <thead>
              <tr>
                <th>Device</th>
                <th>IP</th>
                <th>Uplink</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {v.inventory.map((r) => (
                <tr key={r.deviceId}>
                  <td className="mono">
                    {r.hostname}
                    {r.discovered && <span className="warn"> new</span>}
                  </td>
                  <td className="mono">{r.ip}</td>
                  <td className="mono dim">{r.uplink}</td>
                  <td className={r.status === "up" ? "ok" : r.status === "down" ? "bad" : "dim"}>
                    {r.status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="col">
        <section className="panel">
          <header>
            <h2>Active alerts</h2>
            <span className="sub">{v.alerts.length}</span>
          </header>
          <div className="scroll" style={{ maxHeight: 240 }}>
            {v.alerts.length === 0 && <div className="alert dim">None.</div>}
            {v.alerts.map((a) => (
              <div key={a.deviceId} className="alert">
                <span className="mono">{a.hostname}</span> {a.ip} not responding
                {a.since ? ` since ${fmt(a.since)}` : ""}
              </div>
            ))}
          </div>
        </section>
        <section className="panel grow">
          <header>
            <h2>History</h2>
            <span className="sub">Uplink data comes from discovery and can be wrong.</span>
          </header>
          <div className="scroll">
            <table className="grid">
              <tbody>
                {v.history.map((h, i) => (
                  <tr key={`${h.at}-${i}`}>
                    <td className="mono dim">{fmt(h.at)}</td>
                    <td className="mono">{h.hostname}</td>
                    <td className={h.state === "down" ? "bad" : "ok"}>{h.state}</td>
                    <td>{h.note}</td>
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
