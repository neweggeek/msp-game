import type { GameData } from "../data";
import type { CaseInstance, Device, Link, PlantedFault, Site, World } from "../model/types";
import { netState } from "../net/state";
import type { Rng } from "../rng/rng";
import type { CaseDef, FaultDef } from "../schema";
import { hostIn } from "../util/ip";
import { fill } from "../util/template";
import { connect, makeDevice } from "./gear";

type Draft = Omit<World, "docs" | "case" | "solvability">;

/** Does the network have what the case needs? */
export function caseFits(c: CaseDef, draft: Draft): boolean {
  return Object.entries(c.requires.kinds).every(
    ([kind, n]) => draft.devices.filter((d) => d.kind === kind).length >= n,
  );
}

/** Render "{ap.hostname}" style text against role bindings. */
export function renderBound(
  text: string,
  bindings: Record<string, string>,
  draft: Draft,
  site: Site,
): string {
  return fill(text, (key) => {
    const [role, field = "hostname"] = key.split(".");
    const dev = draft.devices.find((d) => d.id === bindings[role ?? ""]);
    if (!dev) return undefined;
    if (field === "room") return site.rooms.find((r) => r.id === dev.roomId)?.name;
    return (dev as unknown as Record<string, unknown>)[field];
  });
}

/** Apply a fault's effects. Returns the devices it added, or null if the network cannot take it. */
function applyFault(
  rng: Rng,
  data: GameData,
  def: FaultDef,
  draft: Draft,
  bindings: Record<string, string>,
): string[] | null {
  const added: string[] = [];
  const sw = draft.devices.find((d) => d.id === bindings.switch);
  for (const effect of def.effects) {
    if (effect.type === "set-poe-priority-all") {
      if (!sw) throw new Error("set-poe-priority-all needs a switch");
      for (const p of sw.ports) if (p.poeCapable) p.poePriority = effect.value;
    }
    if (effect.type === "add-endpoints") {
      if (!sw) throw new Error("add-endpoints needs a switch");
      const t = data.devices.get(effect.template);
      if (!t) throw new Error(`no template ${effect.template}`);
      const rooms = draft.site.rooms.filter((r) => !r.networkCloset && r.type !== "bathroom");
      const data_ = draft.network.vlans.find((v) => v.role === "data");
      // The installer plugs into whatever free PoE ports they find.
      const free = rng.shuffle(
        sw.ports.filter((p) => p.role === "access" && p.poeCapable && !p.link),
      );
      if (free.length < effect.count) return null;
      for (let n = 1; n <= effect.count; n++) {
        const port = free[n - 1] as (typeof free)[number];
        const hostname = effect.label
          .replace("{nn}", String(n).padStart(2, "0"))
          .replace("{n}", String(n));
        const dev: Device = makeDevice(rng, t, {
          id: `${t.kind}-${draft.devices.filter((d) => d.kind === t.kind).length + 1}`,
          hostname,
          roomId: rng.pick(rooms).id,
          managed: false,
        });
        dev.addedBy = def.id;
        dev.undocumented = true;
        if (data_) {
          dev.ip = hostIn(data_.subnet, 200 + n);
          dev.vlan = data_.id;
          dev.gateway = data_.gateway;
          port.vlan = data_.id;
        }
        draft.devices.push(dev);
        connect(
          draft.network.links as Link[],
          sw,
          port.name,
          dev,
          dev.ports[0]?.name ?? "eth0",
          rng.int(10, 60),
        );
        added.push(dev.id);
      }
    }
  }
  return added;
}

/** Proofs bind roles to the devices that show the fault, or fail. */
function checkProof(def: FaultDef, draft: Draft, bindings: Record<string, string>): boolean {
  const ns = netState(draft as World);
  for (const proof of def.proof) {
    if (proof.type === "poe-denied") {
      const hit = draft.devices.find(
        (d) => d.kind === proof.kind && d.poe && !ns.powered.get(d.id),
      );
      if (!hit) return false;
      bindings[proof.kind] = hit.id;
    }
  }
  return true;
}

/** Plant a case's faults into the draft. Returns null when the case does not fit. */
export function plantCase(rng: Rng, data: GameData, c: CaseDef, draft: Draft): CaseInstance | null {
  if (!caseFits(c, draft)) return null;
  const bindings: Record<string, string> = {};
  for (const kind of ["firewall", "switch", "server"]) {
    const d = draft.devices.find((x) => x.kind === kind);
    if (d) bindings[kind] = d.id;
  }
  const planted: PlantedFault[] = [];
  for (const id of c.faults) {
    const def = data.faults.get(id);
    if (!def) throw new Error(`no fault ${id}`);
    const addedDevices = applyFault(rng.fork(id), data, def, draft, bindings);
    if (!addedDevices || !checkProof(def, draft, bindings)) return null;
    planted.push({
      faultId: id,
      name: def.name,
      bindings: { ...bindings },
      addedDevices,
      clues: [],
    });
  }
  // Roles the text needs but no proof bound: first device of that kind.
  for (const kind of Object.keys(c.requires.kinds)) {
    if (!bindings[kind]) {
      const d = draft.devices.find((x) => x.kind === kind);
      if (d) bindings[kind] = d.id;
    }
  }
  const r = (text: string) => renderBound(text, bindings, draft, draft.site);
  for (const p of planted) {
    const def = data.faults.get(p.faultId) as FaultDef;
    p.bindings = { ...bindings };
    p.clues = def.clues.map((cl) => ({
      id: cl.id,
      text: r(cl.text),
      surface: cl.surface,
      requires: cl.requires,
    }));
  }
  return {
    caseId: c.id,
    name: c.name,
    ticketTitle: r(c.ticket.title),
    ticketBody: r(c.ticket.body),
    priority: c.ticket.priority,
    redHerring: r(c.redHerring),
    rootCause: r(c.rootCause),
    fix: r(c.fix),
    faults: planted,
  };
}
