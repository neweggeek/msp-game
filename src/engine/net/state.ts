import type { Device, Fields, PoePriority, World } from "../model/types";
import { inDailyWindow, inWeeklyWindow, lastWeeklyEnd } from "../util/time";

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
  now: number;
  online: Map<string, boolean>;
  powered: Map<string, boolean>;
  asleep: Map<string, boolean>;
  /** Dark on a schedule or mid power-cycle. Not the player's outage. */
  cut: Map<string, boolean>;
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
    const wants = p.poeCapable && !p.shutdown && peer?.poe;
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

/** Derived state at a game minute: computed from config, faults and time, never stored. */
export function netState(world: World, now: number, opts: { ignoreCuts?: boolean } = {}): NetState {
  const poe = new Map<string, PoeSwitchState>();
  for (const sw of world.devices.filter((d) => d.kind === "switch"))
    poe.set(sw.id, poeFor(world, sw));

  const powered = new Map<string, boolean>();
  const asleep = new Map<string, boolean>();
  const cut = new Map<string, boolean>();
  for (const d of world.devices) {
    asleep.set(d.id, d.sleep !== undefined && inDailyWindow(now, d.sleep));
    cut.set(
      d.id,
      !opts.ignoreCuts &&
        (powerCutActive(d, now) || (d.rebootUntil !== undefined && now < d.rebootUntil)),
    );
  }
  for (const d of world.devices) {
    if (cut.get(d.id)) {
      powered.set(d.id, false);
      continue;
    }
    if (!d.poe) {
      powered.set(d.id, true);
      continue;
    }
    const feed = d.ports.find((p) => p.link)?.link;
    const sw = feed ? poe.get(feed.device) : undefined;
    const port = sw?.ports.find((p) => p.port === feed?.port);
    // Not fed by a managed PoE port means a local adapter or injector powers it.
    // A switch that is dark itself feeds nothing.
    powered.set(d.id, port ? port.state === "delivering" && !cut.get(feed?.device ?? "") : true);
  }

  const online = new Map<string, boolean>();
  for (const d of world.devices) {
    let up = powered.get(d.id) === true && !asleep.get(d.id);
    if (up && d.kind !== "firewall") {
      const link = world.links.find((l) => l.a.device === d.id || l.b.device === d.id);
      const peerRef = link ? (link.a.device === d.id ? link.b : link.a) : undefined;
      const peer = peerRef ? world.devices.find((x) => x.id === peerRef.device) : undefined;
      const peerPort = peer?.ports.find((p) => p.name === peerRef?.port);
      up =
        !!link &&
        link.condition === "good" &&
        !!peer &&
        powered.get(peer.id) === true &&
        !peerPort?.shutdown;
    }
    online.set(d.id, up);
  }
  return { now, online, powered, asleep, cut, poe };
}

/** Is a scheduled power cut taking this device down right now? */
export function powerCutActive(d: Device, now: number): boolean {
  const c = d.powerCut;
  return (
    !!c && now >= c.since && (c.until === undefined || now < c.until) && inWeeklyWindow(now, c)
  );
}

/** When the device last came up: first boot, the end of a power cut, or a power-cycle. */
export function bootTime(d: Device, now: number): number {
  let t = d.bootAt;
  const c = d.powerCut;
  if (c) {
    const end = lastWeeklyEnd(Math.min(now, c.until ?? now), c);
    if (end !== undefined && end >= c.since) t = Math.max(t, end);
    // Fixed in the middle of a cut: power came back at the fix.
    if (c.until !== undefined && c.until <= now && inWeeklyWindow(c.until, c) && c.until >= c.since)
      t = Math.max(t, c.until);
  }
  if (d.rebootUntil !== undefined && d.rebootUntil <= now) t = Math.max(t, d.rebootUntil);
  return t;
}

export function firewallInterfaces(fw: Device): [string, Fields][] {
  return Object.entries((fw.running?.interfaces ?? {}) as Record<string, Fields>);
}

export function siteFirewall(world: World, siteId: string): Device | undefined {
  return world.devices.find((d) => d.kind === "firewall" && d.siteId === siteId);
}

export function siteOf(world: World, siteId: string) {
  const s = world.sites.find((x) => x.id === siteId);
  if (!s) throw new Error(`no site ${siteId}`);
  return s;
}
