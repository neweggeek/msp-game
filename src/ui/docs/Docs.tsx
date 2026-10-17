import { type ReactNode, useState } from "react";
import { type DeviceKind, connectCommand } from "../../engine";
import { fmt } from "../App";
import {
  EditCell,
  SortTh,
  TypeChips,
  countBy,
  groupByType,
  ipKey,
  typeLabel,
  typeOf,
  useCopy,
  useSort,
} from "../assets/assets";
import { data, useGame, useUi } from "../store";

type DocTab = "devices" | "sites" | "vault" | "history" | "access";

/** Hoodoo Docs: what the MSP wrote down. It can be wrong. */
export function DocsView({ full = false }: { full?: boolean }) {
  const game = useGame();
  const { act, say, setDialog } = useUi();
  const [tab, setTab] = useState<DocTab>("devices");
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const docs = game.world.docs;
  const lastEdit = docs.history[docs.history.length - 1];
  const room = (id: string) =>
    game.world.sites.flatMap((s) => s.rooms).find((r) => r.id === id)?.name ?? "";
  const reveal = (id: string) => {
    const r = act({ t: "vault-view", device: id });
    if (r.output) setRevealed((v) => ({ ...v, [id]: r.output?.[1] ?? "" }));
    else say(r.error);
  };
  const editable: Editable = (target, field, value) => (
    <EditCell target={target} field={field} value={value} />
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
            {t === "devices"
              ? "Assets"
              : t === "sites"
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
            Docs can be wrong. Click ✎ on a value to fix it.
            {tab === "devices" && " Missing a device? Add it below the list."}
          </p>
        )}
        {tab === "devices" && (
          <>
            <AssetList full={full} editable={editable} revealed={revealed} reveal={reveal} />
            <AddDevice />
          </>
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
                  <dt>ISP account</dt>
                  <dd>{editable(`site:${s.siteId}`, "account", s.isp.account)}</dd>
                  <dt>ISP PIN</dt>
                  <dd>{editable(`site:${s.siteId}`, "pin", s.isp.pin)}</dd>
                  <dt>WAN IP</dt>
                  <dd>{editable(`site:${s.siteId}`, "wanIp", s.isp.wanIp)}</dd>
                  <dt>WAN block</dt>
                  <dd>{editable(`site:${s.siteId}`, "wanCidr", s.isp.wanCidr)}</dd>
                  <dt>WAN gateway</dt>
                  <dd>{editable(`site:${s.siteId}`, "gateway", s.isp.gateway)}</dd>
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
            {game.world.client.contactPreference === "scheduled-only" && (
              <p className="warn">Client asks that calls be scheduled through dispatch.</p>
            )}
            {docs.contacts.map((c) => (
              <p key={c.id} className="actions">
                <span>
                  {c.name}, {c.role} · {c.phone}
                </span>
                <button
                  type="button"
                  className="btn small"
                  onClick={() => {
                    const r = act({ t: "call", person: c.id });
                    if (r.session) setDialog({ kind: "phone", call: r.session });
                  }}
                >
                  Call
                </button>
              </p>
            ))}
          </div>
        )}
        {tab === "vault" && (
          <table className="grid">
            <thead>
              <tr>
                <th>For</th>
                <th>Type</th>
                <th>User</th>
                <th>Password</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {docs.credentials.map((c) => (
                <tr key={c.deviceId}>
                  <td className="mono">{c.hostname}</td>
                  <td className="dim">{typeLabel(credType(game, c.deviceId))}</td>
                  <td className="mono">{c.username}</td>
                  <td className="mono">{revealed[c.deviceId] ?? "••••••••"}</td>
                  <td>
                    <SecretButtons id={c.deviceId} revealed={revealed} reveal={reveal} />
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

type Game = ReturnType<typeof useGame>;
type Editable = (target: string, field: string, value: string) => ReactNode;

function credType(game: Game, id: string): string {
  if (game.world.docs.wifi.some((w) => w.id === id)) return "wifi";
  const d = game.world.docs.devices.find((x) => x.deviceId === id);
  return d ? typeOf(d.kind) : "";
}

/** Reveal, then copy. Reveal is the vault read that lands in the access log. */
function SecretButtons({
  id,
  revealed,
  reveal,
}: {
  id: string;
  revealed: Record<string, string>;
  reveal: (id: string) => void;
}) {
  const copy = useCopy();
  const pw = revealed[id];
  return pw === undefined ? (
    <button type="button" className="btn small" onClick={() => reveal(id)}>
      Reveal
    </button>
  ) : (
    <button type="button" className="btn small" onClick={() => copy(pw, "password")}>
      Copy password
    </button>
  );
}

type AssetSort = "name" | "ip" | "model" | "site";
interface AssetRow {
  id: string;
  type: string;
  name: string;
  ip: string;
  model: string;
  siteId: string;
  firmware?: string;
  roomId?: string;
  notes?: string;
  wifi?: { vlan: number; security: string };
}

/**
 * Hoodoo assets, laid out like a docs platform: a chip per asset type, one
 * section per type, and each password as a child row under what it opens.
 */
function AssetList({
  full,
  editable,
  revealed,
  reveal,
}: {
  full: boolean;
  editable: Editable;
  revealed: Record<string, string>;
  reveal: (id: string) => void;
}) {
  const game = useGame();
  const copy = useCopy();
  const [type, setType] = useState("all");
  const [filter, setFilter] = useState("");
  const { sort, by, cmp } = useSort<AssetSort>("name");
  const docs = game.world.docs;
  const siteName = (id: string) => docs.sites.find((s) => s.siteId === id)?.name ?? id;
  const room = (id: string) =>
    game.world.sites.flatMap((s) => s.rooms).find((r) => r.id === id)?.name ?? "";
  const all: AssetRow[] = [
    ...docs.devices.map((d) => ({
      id: d.deviceId,
      type: typeOf(d.kind),
      name: d.hostname,
      ip: d.ip ?? "",
      model: d.model,
      siteId: d.siteId,
      firmware: d.firmware,
      roomId: d.roomId,
      notes: d.notes,
    })),
    ...docs.wifi.map((w) => ({
      id: w.id,
      type: "wifi",
      name: w.ssid,
      ip: "",
      model: w.security,
      siteId: w.siteId,
      notes: w.notes,
      wifi: { vlan: w.vlan, security: w.security },
    })),
  ];
  const f = filter.trim().toLowerCase();
  const rows = all
    .filter((r) => type === "all" || r.type === type)
    .filter(
      (r) =>
        !f || [r.name, r.ip, r.model, siteName(r.siteId)].some((v) => v.toLowerCase().includes(f)),
    )
    .sort((a, b) =>
      sort.key === "ip"
        ? cmp(ipKey(a.ip), ipKey(b.ip))
        : sort.key === "site"
          ? cmp(siteName(a.siteId), siteName(b.siteId)) || a.name.localeCompare(b.name)
          : cmp(a[sort.key], b[sort.key]),
    );
  const groups = groupByType(rows, (r) => r.type);
  const cols = full ? 6 : 4;
  return (
    <>
      <div className="asset-bar">
        <TypeChips counts={countBy(all, (r) => r.type)} value={type} onChange={setType} />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter: name, IP, model, site"
          aria-label="Filter assets"
          style={{ width: 200 }}
        />
      </div>
      <table className="grid assets">
        <thead>
          <tr>
            <SortTh k="name" label="Name" sort={sort} by={by} />
            <SortTh k="ip" label="IP / VLAN" sort={sort} by={by} />
            <SortTh k="model" label="Model" sort={sort} by={by} />
            <SortTh k="site" label="Site" sort={sort} by={by} />
            {full && <th>Firmware / Room</th>}
            {full && <th>Notes</th>}
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.id}>
            <tr className="group">
              <td colSpan={cols}>
                {g.label} <span className="count">{g.rows.length}</span>
              </td>
            </tr>
            {g.rows.flatMap((r) => {
              const cred = docs.credentials.find((c) => c.deviceId === r.id);
              const cmd = r.wifi ? undefined : connectCommand(game.world, data, r.id);
              const out = [
                <tr key={r.id}>
                  <td className="mono">{r.name}</td>
                  <td>
                    {r.wifi ? (
                      <span className="mono">VLAN {r.wifi.vlan}</span>
                    ) : (
                      editable(`device:${r.id}`, "ip", r.ip)
                    )}
                  </td>
                  <td>{r.model}</td>
                  <td>{siteName(r.siteId)}</td>
                  {full && (
                    <td>
                      {r.firmware !== undefined &&
                        editable(`device:${r.id}`, "firmware", r.firmware)}
                      {r.roomId && <div className="dim">{room(r.roomId)}</div>}
                    </td>
                  )}
                  {full && <td className="dim">{r.notes}</td>}
                </tr>,
              ];
              if (cred)
                out.push(
                  <tr key={`${r.id}-pw`} className="child">
                    <td colSpan={cols}>
                      <div className="actions">
                        <span className="dim">└ Password</span>
                        <span className="mono">{cred.username}</span>
                        <span className="mono">{revealed[r.id] ?? "••••••••"}</span>
                        <SecretButtons id={r.id} revealed={revealed} reveal={reveal} />
                        {cmd && (
                          <button
                            type="button"
                            className="btn small"
                            title="Paste into a Shinobi RMM shell on a PC that can reach it"
                            onClick={() => copy(cmd, cmd)}
                          >
                            Copy <span className="mono">{cmd}</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>,
                );
              return out;
            })}
          </tbody>
        ))}
        {groups.length === 0 && (
          <tbody>
            <tr>
              <td colSpan={cols} className="dim">
                Nothing matches.
              </td>
            </tr>
          </tbody>
        )}
      </table>
    </>
  );
}

/** Write down a device the docs never had: the cameras a case turned up, a rogue switch. */
function AddDevice() {
  const game = useGame();
  const act = useUi((s) => s.act);
  const sites = game.world.docs.sites;
  const kinds = data.assets.types.flatMap((t) => t.kinds);
  const blank = { site: sites[0]?.siteId ?? "", hostname: "", ip: "", kind: kinds[0] ?? "pc" };
  const [form, setForm] = useState(blank);
  return (
    <form
      className="asset-bar add-device"
      onSubmit={(e) => {
        e.preventDefault();
        const r = act({ t: "doc-add", ...form, kind: form.kind as DeviceKind });
        if (r.ok) setForm({ ...blank, site: form.site, kind: form.kind });
      }}
    >
      <b>Add a device</b>
      <input
        value={form.hostname}
        onChange={(e) => setForm({ ...form, hostname: e.target.value })}
        placeholder="Name"
        aria-label="New device name"
        style={{ width: 150 }}
      />
      <input
        value={form.ip}
        onChange={(e) => setForm({ ...form, ip: e.target.value })}
        placeholder="IP"
        aria-label="New device IP"
        style={{ width: 120 }}
      />
      <select
        value={form.kind}
        onChange={(e) => setForm({ ...form, kind: e.target.value as DeviceKind })}
        aria-label="New device type"
      >
        {kinds.map((k) => (
          <option key={k} value={k}>
            {typeLabel(typeOf(k as DeviceKind))}
          </option>
        ))}
      </select>
      <select
        value={form.site}
        onChange={(e) => setForm({ ...form, site: e.target.value })}
        aria-label="New device site"
      >
        {sites.map((x) => (
          <option key={x.siteId} value={x.siteId}>
            {x.name}
          </option>
        ))}
      </select>
      <button type="submit" className="btn small">
        Add
      </button>
    </form>
  );
}
