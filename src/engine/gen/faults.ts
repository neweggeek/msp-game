import type { GameData } from "../data";
import type { CaseInstance, Device, HistoryEvent, PlantedFault, World } from "../model/types";
import { canReach } from "../net/reach";
import { netState } from "../net/state";
import { tunnelStates } from "../net/vpn";
import type { Rng } from "../rng/rng";
import type { CaseDef, FaultDef } from "../schema";
import { hostIn, intToIp, ipToInt, parseCidr } from "../util/ip";
import { fill } from "../util/template";
import { parseClock, parseGameTime } from "../util/time";
import { type GearContext, connect, makeDevice, nextId } from "./gear";

/** A world still being built: no docs, cases or report yet. */
export type Draft = Omit<
  World,
  "docs" | "cases" | "extraTickets" | "solvability" | "monitoring"
> & {
  monitoring?: World["monitoring"];
};

/** Render "{ap.hostname}" style text against role bindings. */
export function renderBound(text: string, bindings: Record<string, string>, draft: Draft): string {
  return fill(text, (key) => {
    if (key === "site") return draft.sites[0]?.name;
    const [role, field = "hostname"] = key.split(".");
    const dev = draft.devices.find((d) => d.id === bindings[role ?? ""]);
    if (!dev) return undefined;
    if (field === "room")
      return draft.sites.flatMap((s) => s.rooms).find((r) => r.id === dev.roomId)?.name;
    return (dev as unknown as Record<string, unknown>)[field];
  });
}

/** Does the network have what the case needs? */
export function caseFits(c: CaseDef, draft: Draft): boolean {
  if (!c.requires.sites.every((s) => draft.sites.some((x) => x.id === s))) return false;
  if (c.requires.probe && !draft.devices.some((d) => d.tags?.includes("probe"))) return false;
  return Object.entries(c.requires.kinds).every(
    ([kind, n]) => draft.devices.filter((d) => d.kind === kind).length >= n,
  );
}

function bindRoles(
  rng: Rng,
  c: CaseDef,
  draft: Draft,
  taken: Set<string>,
): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const [role, sel] of Object.entries(c.roles)) {
    const fits = draft.devices.filter(
      (d) =>
        d.kind === sel.kind &&
        d.siteId === sel.site &&
        (sel.tag ? d.tags?.includes(sel.tag) : !d.tags?.includes("probe")) &&
        (!sel.hasUser || d.user) &&
        // Endpoints are only ever the subject of one case.
        (["firewall", "switch", "server"].includes(d.kind) || !taken.has(d.id)),
    );
    if (fits.length === 0) return null;
    const dev = sel.pick === "random" ? rng.pick(fits) : (fits[0] as Device);
    out[role] = dev.id;
  }
  return out;
}

function applyFault(
  rng: Rng,
  data: GameData,
  def: FaultDef,
  draft: Draft,
  b: Record<string, string>,
  ctx: GearContext,
): string[] | null {
  const added: string[] = [];
  const target = (role: string) => draft.devices.find((d) => d.id === b[role]);
  for (const e of def.effects) {
    const dev = target(e.target);
    if (!dev) return null;
    switch (e.type) {
      case "set-poe-priority-all":
        for (const p of dev.ports) if (p.poeCapable) p.poePriority = e.value;
        break;
      case "add-endpoints": {
        const t = data.devices.get(e.template);
        if (!t) return null;
        const site = draft.sites.find((s) => s.id === dev.siteId);
        const rooms = site?.rooms.filter((r) => !r.networkCloset && r.type !== "bathroom") ?? [];
        const dataVlan = site?.vlans.find((v) => v.role === "data");
        // The installer plugs into whatever free PoE ports they find.
        const free = rng.shuffle(
          dev.ports.filter((p) => p.role === "access" && p.poeCapable && !p.link),
        );
        if (free.length < e.count || rooms.length === 0) return null;
        for (let n = 1; n <= e.count; n++) {
          const port = free[n - 1] as (typeof free)[number];
          const cam = makeDevice(rng, t, {
            id: nextId(ctx, t.kind),
            siteId: dev.siteId,
            hostname: e.label.replace("{nn}", String(n).padStart(2, "0")).replace("{n}", String(n)),
            roomId: rng.pick(rooms).id,
            managed: false,
            now: parseGameTime(def.startedAt),
          });
          cam.addedBy = def.id;
          if (dataVlan) {
            cam.ip = hostIn(dataVlan.subnet, 200 + n);
            cam.vlan = dataVlan.id;
            cam.gateway = dataVlan.gateway;
            port.vlan = dataVlan.id;
          }
          draft.devices.push(cam);
          connect(draft.links, dev, port.name, cam, cam.ports[0]?.name ?? "eth0", rng.int(10, 60));
          added.push(cam.id);
        }
        break;
      }
      case "set-dns":
        dev.dns = [...e.servers];
        break;
      case "sleep-nightly":
        dev.sleep = { from: parseClock(e.from), to: parseClock(e.to) };
        break;
      case "power-cut-weekly":
        dev.powerCut = {
          day: e.day,
          from: parseClock(e.from),
          to: parseClock(e.to),
          since: parseGameTime(def.startedAt),
          source: e.source,
          fixedSource: e.fixedSource,
        };
        break;
      case "change-wan-ip": {
        const site = draft.sites.find((s) => s.id === dev.siteId);
        if (!site) return null;
        const block = ipToInt(parseCidr(site.isp.wanCidr).ip);
        let next = block;
        while (next === block) next = ipToInt("203.0.113.0") + rng.int(0, 31) * 8;
        site.isp = {
          ...site.isp,
          wanCidr: `${intToIp(next)}/29`,
          gateway: intToIp(next + 1),
          wanIp: intToIp(next + 2),
        };
        const wan = (dev.running?.interfaces as Record<string, Record<string, unknown>>).wan1;
        if (wan) wan.ip = `${site.isp.wanIp}/29`;
        break;
      }
      case "mangle-phase2": {
        const p2 = Object.values(
          (dev.running?.phase2 ?? {}) as Record<string, Record<string, unknown>>,
        )[0];
        if (!p2 || typeof p2.dst !== "string") return null;
        // A coworker typed the remote subnet one octet off.
        const [net = "", prefix = "16"] = p2.dst.split("/");
        const [a, b2, c, d] = net.split(".");
        p2.dst = `${a}.${Number(b2) + 1}.${c}.${d}/${prefix}`;
        break;
      }
    }
  }
  return added;
}

/** Proofs bind roles to the devices that show the fault, or fail. */
function checkProof(def: FaultDef, draft: Draft, b: Record<string, string>, now: number): boolean {
  const ns = netState(draft as World, now);
  for (const proof of def.proof) {
    if (proof.type === "poe-denied") {
      const hit = draft.devices.find(
        (d) => d.kind === proof.kind && d.poe && !ns.powered.get(d.id),
      );
      if (!hit) return false;
      b[proof.kind] = hit.id;
    }
    if (proof.type === "tunnel-down") {
      const t = tunnelStates(draft as World, ns).filter((x) => x.firewallId === b[proof.role]);
      if (t.length === 0 || t.some((x) => x.phase2Up)) return false;
    }
  }
  return true;
}

/** What the monitoring collector can see at a minute: online and reachable from it. */
export function visibleMap(draft: Draft, at: number): Map<string, boolean> {
  const w = draft as World;
  const ns = netState(w, at);
  const col = draft.monitoring?.collectorId ?? "";
  const out = new Map<string, boolean>();
  for (const d of draft.devices) {
    const ip = d.kind === "firewall" ? undefined : d.ip;
    out.set(
      d.id,
      ns.online.get(d.id) === true && (d.id === col || !ip || canReach(w, col, ip, ns)),
    );
  }
  return out;
}

/** History the monitoring tool would have recorded for this fault. */
function faultHistory(
  def: FaultDef,
  draft: Draft,
  before: Map<string, boolean>,
  b: Record<string, string>,
  playStart: number,
): HistoryEvent[] {
  const at = parseGameTime(def.startedAt);
  const events: HistoryEvent[] = [];
  const sleeper = def.effects.find((e) => e.type === "sleep-nightly");
  if (sleeper && sleeper.type === "sleep-nightly") {
    const id = b[sleeper.target] as string;
    const from = parseClock(sleeper.from);
    const to = parseClock(sleeper.to);
    for (let day = Math.floor(at / 1440); day * 1440 + from < playStart; day++) {
      events.push({ at: day * 1440 + from, deviceId: id, state: "down", note: "Went to sleep" });
      const wake = (day + (to < from ? 1 : 0)) * 1440 + to;
      if (wake < playStart)
        events.push({ at: wake, deviceId: id, state: "up", note: "Woke on timer" });
    }
    return events;
  }
  const cuts = def.effects.flatMap((e) => (e.type === "power-cut-weekly" ? [e] : []));
  if (cuts.length > 0) {
    // Ovik sees what goes dark each week, one window at a time. Its collector going dark reads as
    // the whole site.
    const week = 7 * 1440;
    const windows = [...new Set(cuts.map((e) => `${e.day} ${e.from} ${e.to}`))];
    for (const w of windows) {
      const [day = "0", from = "", to = ""] = w.split(" ");
      for (let t = Math.floor(at / week) * week; t < playStart; t += week) {
        const down = t + Number(day) * 1440 + parseClock(from);
        const up = t + Number(day) * 1440 + parseClock(to);
        if (down < at || down >= playStart) continue;
        const dark = visibleMap(draft, down + 1);
        for (const d of draft.devices) {
          if (!before.get(d.id) || dark.get(d.id)) continue;
          events.push({ at: down, deviceId: d.id, state: "down", note: "Lost power" });
          if (up < playStart)
            events.push({ at: up, deviceId: d.id, state: "up", note: "Power back" });
        }
      }
    }
    return events.sort((a, b) => a.at - b.at);
  }
  const after = visibleMap(draft, at);
  for (const d of draft.devices) {
    if (before.get(d.id) && after.get(d.id) === false)
      events.push({ at, deviceId: d.id, state: "down", note: def.name });
  }
  return events;
}

/** Plant one case into the draft. Returns null when it does not fit. */
export function plantCase(
  rng: Rng,
  data: GameData,
  c: CaseDef,
  draft: Draft,
  ctx: GearContext,
  taken: Set<string>,
  playStart: number,
): CaseInstance | null {
  if (!caseFits(c, draft)) return null;
  const bindings = bindRoles(rng.fork("roles"), c, draft, taken);
  if (!bindings) return null;
  const planted: PlantedFault[] = [];
  for (const id of c.faults) {
    const def = data.faults.get(id);
    if (!def) throw new Error(`no fault ${id}`);
    const startedAt = parseGameTime(def.startedAt);
    const before = visibleMap(draft, startedAt);
    const addedDevices = applyFault(rng.fork(id), data, def, draft, bindings, ctx);
    if (!addedDevices || !checkProof(def, draft, bindings, playStart)) return null;
    draft.history.push(...faultHistory(def, draft, before, bindings, playStart));
    planted.push({ faultId: id, name: def.name, startedAt, addedDevices, clues: [] });
  }
  for (const id of Object.values(bindings)) taken.add(id);
  const r = (text: string) => renderBound(text, bindings, draft);
  for (const p of planted) {
    const def = data.faults.get(p.faultId) as FaultDef;
    p.clues = def.clues.map((cl) => ({
      id: cl.id,
      text: r(cl.text),
      surface: cl.surface,
      requires: cl.requires,
    }));
  }
  const n = c.note;
  const call: CaseInstance["call"] = c.call
    ? {
        facts: Object.fromEntries(Object.entries(c.call.facts).map(([k, v]) => [k, r(v)])),
        fixes: c.call.fixes.map((f) => ({ ...f, label: r(f.label), roles: [...f.roles] })),
        ...(c.call.testFixed ? { testFixed: r(c.call.testFixed) } : {}),
        ...(c.call.testBroken ? { testBroken: r(c.call.testBroken) } : {}),
      }
    : undefined;
  return {
    caseId: c.id,
    name: c.name,
    playbook: c.playbook,
    origin: c.ticket.origin,
    priority: c.ticket.priority,
    ticketTitle: r(c.ticket.title),
    ticketBody: r(c.ticket.body),
    ticketHistory: c.ticket.history.map((h) => ({
      at: parseGameTime(h.at),
      by: h.by,
      text: r(h.text),
    })),
    bindings,
    primary: c.primary,
    fixed: c.fixed.map((f) => ({ ...f })),
    redHerring: r(c.redHerring),
    rootCause: r(c.rootCause),
    fix: r(c.fix),
    note: {
      issue: r(n.issue),
      findings: r(n.findings),
      changes: r(n.changes),
      rootCause: r(n.rootCause),
      nextSteps: r(n.nextSteps),
      wrongCause: r(n.wrongCause),
      wrongChange: r(n.wrongChange),
    },
    ...(call ? { call } : {}),
    faults: planted,
  };
}
