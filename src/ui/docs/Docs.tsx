import { useState } from "react";
import { fmt } from "../App";
import { useGame, useUi } from "../store";

type DocTab = "devices" | "sites" | "vault" | "history" | "access";

/** Hoodoo Docs: what the MSP wrote down. It can be wrong. */
export function DocsView({ full = false }: { full?: boolean }) {
  const game = useGame();
  const { act, say } = useUi();
  const [tab, setTab] = useState<DocTab>("devices");
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [edit, setEdit] = useState<{ target: string; field: string; value: string } | null>(null);
  const docs = game.world.docs;
  const lastEdit = docs.history[docs.history.length - 1];
  const room = (id: string) =>
    game.world.sites.flatMap((s) => s.rooms).find((r) => r.id === id)?.name ?? "";
  const saveEdit = () => {
    if (!edit) return;
    const r = act({ t: "doc-edit", ...edit });
    if (r.ok) setEdit(null);
  };
  const editable = (target: string, field: string, value: string) =>
    edit && edit.target === target && edit.field === field ? (
      <form
        className="actions"
        onSubmit={(e) => {
          e.preventDefault();
          saveEdit();
        }}
      >
        <input
          value={edit.value}
          onChange={(e) => setEdit({ ...edit, value: e.target.value })}
          style={{ width: 130 }}
          aria-label={field}
        />
        <button type="submit" className="btn small">
          Save
        </button>
      </form>
    ) : (
      <span
        className="mono"
        onDoubleClick={() => setEdit({ target, field, value })}
        title="Double-click to edit"
      >
        {value}
      </span>
    );
  return (
    <section className="panel grow" style={{ flex: full ? 1 : "1 1 60%" }}>
      <header>
        <h2>Hoodoo Docs · {game.world.client.name}</h2>
        <span className="sub">{lastEdit ? `Edited ${fmt(lastEdit.at)}` : "Never edited"}</span>
      </header>
      <div className="term-tabs" style={{ background: "transparent" }}>
        {(["devices", "sites", "vault", "history", "access"] as DocTab[]).map((t) => (
          <button
            key={t}
            type="button"
            className={`term-tab ${tab === t ? "on" : ""}`}
            onClick={() => setTab(t)}
          >
            {t === "sites"
              ? "Sites and IP plan"
              : t === "access"
                ? "Access log"
                : t[0]?.toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      <div className="scroll">
        {(tab === "devices" || tab === "sites") && (
          <p className="dim" style={{ margin: "6px 12px", fontSize: 11.5 }}>
            Docs can be wrong. Double-click an IP{full ? ", firmware" : ""} or WAN IP to fix it.
          </p>
        )}
        {tab === "devices" && (
          <table className="grid">
            <thead>
              <tr>
                <th>Name</th>
                <th>IP</th>
                <th>Model</th>
                {full && <th>Firmware</th>}
                {full && <th>Room</th>}
                {full && <th>Notes</th>}
              </tr>
            </thead>
            <tbody>
              {docs.devices.map((d) => (
                <tr key={d.deviceId}>
                  <td className="mono">{d.hostname}</td>
                  <td>{editable(`device:${d.deviceId}`, "ip", d.ip ?? "")}</td>
                  <td>{d.model}</td>
                  {full && <td>{editable(`device:${d.deviceId}`, "firmware", d.firmware)}</td>}
                  {full && <td>{room(d.roomId)}</td>}
                  {full && <td className="dim">{d.notes}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === "sites" && (
          <div className="body">
            {docs.sites.map((s) => (
              <div key={s.siteId}>
                <h3>{s.name}</h3>
                <dl className="kv">
                  <dt>Address</dt>
                  <dd>{s.address}</dd>
                  <dt>ISP</dt>
                  <dd>
                    {s.isp.name} · circuit {s.isp.circuitId} · {s.isp.phone}
                  </dd>
                  <dt>WAN IP</dt>
                  <dd>{editable(`site:${s.siteId}`, "wanIp", s.isp.wanIp)}</dd>
                  <dt>WAN block</dt>
                  <dd className="mono">{s.isp.wanCidr}</dd>
                  {s.vlans.map((v) => (
                    <span key={v.id} style={{ display: "contents" }}>
                      <dt>VLAN {v.id}</dt>
                      <dd className="mono">
                        {v.name} {v.subnet} gw {v.gateway}
                      </dd>
                    </span>
                  ))}
                </dl>
              </div>
            ))}
            <h3>Access</h3>
            {docs.accessNotes.map((n) => (
              <p key={n}>{n}</p>
            ))}
            <h3>Contacts</h3>
            {docs.contacts.map((c) => (
              <p key={c.id}>
                {c.name}, {c.role} · {c.phone}
              </p>
            ))}
          </div>
        )}
        {tab === "vault" && (
          <table className="grid">
            <thead>
              <tr>
                <th>Device</th>
                <th>User</th>
                <th>Password</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {docs.credentials.map((c) => (
                <tr key={c.deviceId}>
                  <td className="mono">{c.hostname}</td>
                  <td className="mono">{c.username}</td>
                  <td className="mono">{revealed[c.deviceId] ?? "••••••••"}</td>
                  <td>
                    {!revealed[c.deviceId] && (
                      <button
                        type="button"
                        className="btn small"
                        onClick={() => {
                          const r = act({ t: "vault-view", device: c.deviceId });
                          if (r.output)
                            setRevealed({ ...revealed, [c.deviceId]: r.output[1] ?? "" });
                          else say(r.error);
                        }}
                      >
                        Reveal
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === "history" && (
          <table className="grid">
            <tbody>
              {[...docs.history].reverse().map((h, i) => (
                <tr key={`${h.at}-${i}`}>
                  <td className="mono dim">{fmt(h.at)}</td>
                  <td>{h.by}</td>
                  <td className="mono">{label(game, h.entry)}</td>
                  <td>
                    {h.field}: {h.from || "(empty)"} to {h.to}
                  </td>
                </tr>
              ))}
              {docs.history.length === 0 && (
                <tr>
                  <td className="dim">No edits recorded.</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
        {tab === "access" && (
          <table className="grid">
            <tbody>
              {[...docs.accessLog].reverse().map((a, i) => (
                <tr key={`${a.at}-${i}`}>
                  <td className="mono dim">{fmt(a.at)}</td>
                  <td>{a.who}</td>
                  <td className="mono">viewed {label(game, a.entry)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

function label(game: ReturnType<typeof useGame>, entry: string): string {
  const [kind, id] = entry.split(":");
  if (kind === "site") return game.world.docs.sites.find((s) => s.siteId === id)?.name ?? entry;
  const host =
    game.world.docs.devices.find((d) => d.deviceId === id)?.hostname ??
    game.world.docs.credentials.find((c) => c.deviceId === id)?.hostname ??
    id;
  return kind === "vault" ? `vault ${host}` : (host ?? entry);
}
