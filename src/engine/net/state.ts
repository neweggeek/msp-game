import type { Device, Fields, PoePriority, World } from "../model/types";

export interface PoePortState {
  port: string;
  state: "delivering" | "denied" | "disabled" | "searching" | "none";
  class: number | null;
  priority: PoePriority;
  requestedW: number;
  powerW: number;
  deviceId?: string;
}

export interface PoeSwitchState {
  deviceId: string;
  budgetW: number;
  requestedW: number;
  allocatedW: number;
  ports: PoePortState[];
}

export interface NetState {
  online: Map<string, boolean>;
  powered: Map<string, boolean>;
  poe: Map<string, PoeSwitchState>;
}

const priorityRank: Record<PoePriority, number> = { critical: 3, high: 2, low: 1 };

export function deviceById(world: World, id: string): Device {
  const d = world.devices.find((x) => x.id === id);
  if (!d) throw new Error(`no device ${id}`);
  return d;
}

/**
 * PoE allocation the way small managed switches do it:
 * highest priority first, then lowest port number, until the budget runs out.
 */
export function poeFor(world: World, sw: Device): PoeSwitchState {
  const budgetW = sw.poeBudgetW ?? 0;
  const ports: PoePortState[] = sw.ports.map((p) => {
    const peer = p.link ? world.devices.find((d) => d.id === p.link?.device) : undefined;
    const wants = p.poeCapable && peer?.poe;
    return {
      port: p.name,
      state: !p.poeCapable ? "none" : !p.poeEnabled ? "disabled" : wants ? "denied" : "searching",
      class: wants ? (peer.poe?.class ?? null) : null,
      priority: p.poePriority,
      requestedW: wants && p.poeEnabled ? (peer.poe?.drawW ?? 0) : 0,
      powerW: 0,
      deviceId: peer?.id,
    };
  });
  const order = ports
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.requestedW > 0)
    .sort((a, b) => priorityRank[b.p.priority] - priorityRank[a.p.priority] || a.i - b.i);
  let allocatedW = 0;
  for (const { p } of order) {
    if (allocatedW + p.requestedW <= budgetW) {
      allocatedW += p.requestedW;
      p.powerW = p.requestedW;
      p.state = "delivering";
    }
  }
  const requestedW = ports.reduce((s, p) => s + p.requestedW, 0);
  return { deviceId: sw.id, budgetW, requestedW, allocatedW, ports };
}

/** Derived state: computed from config and faults, never stored. */
export function netState(world: World): NetState {
  const poe = new Map<string, PoeSwitchState>();
  for (const sw of world.devices.filter((d) => d.kind === "switch"))
    poe.set(sw.id, poeFor(world, sw));

  const powered = new Map<string, boolean>();
  for (const d of world.devices) {
    if (!d.poe) {
      powered.set(d.id, true);
      continue;
    }
    const feed = d.ports.find((p) => p.link)?.link;
    const sw = feed ? poe.get(feed.device) : undefined;
    const port = sw?.ports.find((p) => p.port === feed?.port);
    // Not fed by a managed PoE port means a local adapter or injector powers it.
    powered.set(d.id, port ? port.state === "delivering" : true);
  }

  const online = new Map<string, boolean>();
  for (const d of world.devices) {
    let up = powered.get(d.id) === true;
    if (up && d.kind !== "firewall") {
      const link = world.network.links.find((l) => l.a.device === d.id || l.b.device === d.id);
      const peer = link ? (link.a.device === d.id ? link.b.device : link.a.device) : undefined;
      up = !!link && link.condition === "good" && !!peer && powered.get(peer) === true;
    }
    online.set(d.id, up);
  }
  return { online, powered, poe };
}

/** Firewall interface table from its running config. */
export function firewallInterfaces(fw: Device): [string, Fields][] {
  const table = (fw.running?.interfaces ?? {}) as Record<string, Fields>;
  return Object.entries(table);
}
