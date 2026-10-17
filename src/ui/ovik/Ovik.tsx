import { useState } from "react";
import { ovikView } from "../../engine";
import { fmt } from "../App";
import { SortTh, TypeChips, countBy, groupByType, ipKey, typeOf, useSort } from "../assets/assets";
import { useGame } from "../store";

type OvikSort = "hostname" | "ip" | "status";

export function OvikPage() {
  const game = useGame();
  const v = ovikView(game.world, game.clock.now);
  const [type, setType] = useState("all");
  const [filter, setFilter] = useState("");
  const { sort, by, cmp } = useSort<OvikSort>("hostname");
  const kindOf = (r: (typeof v.inventory)[number]) => (r.kind ? typeOf(r.kind) : "unknown");
  const f = filter.trim().toLowerCase();
  const rows = v.inventory
    .filter((r) => type === "all" || kindOf(r) === type)
    .filter((r) => !f || [r.hostname, r.ip, r.uplink].some((x) => x.toLowerCase().includes(f)))
    .sort((a, b) =>
      sort.key === "ip" ? cmp(ipKey(a.ip), ipKey(b.ip)) : cmp(a[sort.key], b[sort.key]),
    );
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
        <div className="asset-bar">
          <TypeChips counts={countBy(v.inventory, kindOf)} value={type} onChange={setType} />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter: name, IP, uplink"
            aria-label="Filter inventory"
            style={{ width: 180 }}
          />
        </div>
        <div className="scroll">
          <table className="grid">
            <thead>
              <tr>
                <SortTh k="hostname" label="Device" sort={sort} by={by} />
                <SortTh k="ip" label="IP" sort={sort} by={by} />
                <th>Uplink</th>
                <SortTh k="status" label="Status" sort={sort} by={by} />
              </tr>
            </thead>
            {groupByType(rows, kindOf).map((g) => (
              <tbody key={g.id}>
                <tr className="group">
                  <td colSpan={4}>
                    {g.label} <span className="count">{g.rows.length}</span>
                  </td>
                </tr>
                {g.rows.map((r) => (
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
            ))}
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
