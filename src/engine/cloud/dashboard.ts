import { powerCycle } from "../calls/calls";
import { formatTime } from "../clock/clock";
import type { GameData } from "../data";
import type { Device, Link, PoePriority, World } from "../model/types";
import { canReach } from "../net/reach";
import { type NetState, netState, powerCutActive, siteFirewall } from "../net/state";
import { fill } from "../util/template";

export interface DashPort {
  port: string;
  uplink: boolean;
  status: "connected" | "disconnected" | "disabled";
  speed: string;
  /** What the switch hears on the port: a hostname, or a bare MAC for gear that says nothing. */
  client?: string;
  vlan?: number;
  poe: { capable: boolean; enabled: boolean; priority: PoePriority; state: string; powerW: number };
}

export interface DashDevice {
  id: string;
  name: string;
  model: string;
  serial: string;
  firmware: string;
  ip: string;
  online: boolean;
  lastSeen: number;
  poe?: { budgetW: number; allocatedW: number };
  ports: DashPort[];
}

export interface DashEvent {
  at: number;
  device: string;
  text: string;
}

/** A cloud device shows live in the dashboard only while it is up and reaches the internet. */
export function cloudOnline(world: World, d: Device, ns: NetState): boolean {
  return ns.online.get(d.id) === true && canReach(world, d.id, "1.1.1.1", ns);
}

/**
 * When it last checked in: now if it is online, else when its current dark spell began. The
 * switch drops off the cloud when it, its firewall or the ISP goes dark, so take the latest start.
 */
function lastSeen(world: World, d: Device, ns: NetState): number {
  const now = ns.now;
  if (cloudOnline(world, d, ns)) return now;
  const starts: number[] = [];
  const fw = siteFirewall(world, d.siteId);
  for (const x of fw ? [d, fw] : [d]) {
    if (x.rebootUntil !== undefined && now < x.rebootUntil && x.rebootAt !== undefined)
      starts.push(x.rebootAt);
    const c = x.powerCut;
    if (c && powerCutActive(x, now))
      starts.push(now - (((((now % 1440) - c.from) % 1440) + 1440) % 1440));
    const down = world.history.filter((h) => h.deviceId === x.id && h.at <= now).at(-1);
    if (down?.state === "down") starts.push(down.at);
  }
  const isp = world.sites.find((s) => s.id === d.siteId)?.isp;
  if (
    isp?.outage &&
    now >= isp.outage.since &&
    (isp.outage.until === undefined || now < isp.outage.until)
  )
    starts.push(isp.outage.since);
  if (isp?.rebootUntil !== undefined && now < isp.rebootUntil && isp.rebootAt !== undefined)
    starts.push(isp.rebootAt);
  return starts.length > 0 ? Math.max(...starts) : now;
}

function linkOn(world: World, d: Device, port: string): Link | undefined {
  return world.links.find(
    (l) => (l.a.device === d.id && l.a.port === port) || (l.b.device === d.id && l.b.port === port),
  );
}

function peerOn(world: World, d: Device, port: string): Device | undefined {
  const l = linkOn(world, d, port);
  if (!l) return undefined;
  const ref = l.a.device === d.id && l.a.port === port ? l.b : l.a;
  return world.devices.find((x) => x.id === ref.device);
}

/** Name the switch hears from the far end. Cameras added by a fault only give a MAC. */
function clientName(peer: Device): string {
  return peer.addedBy ? peer.mac : peer.hostname;
}

/** What the dashboard shows for the client's cloud-managed gear right now. */
export function dashboard(
  world: World,
  now: number,
): { devices: DashDevice[]; events: DashEvent[] } {
  const ns = netState(world, now);
  const devices = world.devices
    .filter((d) => d.cloud)
    .map((d): DashDevice => {
      const online = cloudOnline(world, d, ns);
      const poe = ns.poe.get(d.id);
      const ports = online
        ? d.ports.map((p): DashPort => {
            const l = linkOn(world, d, p.name);
            const peer = peerOn(world, d, p.name);
            const ps = poe?.ports.find((x) => x.port === p.name);
            const up =
              !!l &&
              !!peer &&
              !p.shutdown &&
              l.condition === "good" &&
              ns.powered.get(peer.id) === true &&
              !ns.asleep.get(peer.id);
            const port: DashPort = {
              port: p.name,
              uplink: p.role === "uplink",
              status: p.shutdown ? "disabled" : up ? "connected" : "disconnected",
              speed: up ? "1 Gbps" : "",
              poe: {
                capable: p.poeCapable,
                enabled: p.poeEnabled,
                priority: p.poePriority,
                state: ps?.state ?? "none",
                powerW: ps?.powerW ?? 0,
              },
            };
            if (up && peer) port.client = clientName(peer);
            if (p.vlan !== undefined) port.vlan = p.vlan;
            return port;
          })
        : [];
      const out: DashDevice = {
        id: d.id,
        name: d.hostname,
        model: d.model,
        serial: d.serial,
        firmware: d.firmware,
        ip: d.ip ?? "",
        online,
        lastSeen: lastSeen(world, d, ns),
        ports,
      };
      if (online && poe) out.poe = { budgetW: poe.budgetW, allocatedW: poe.allocatedW };
      return out;
    });
  const events = dashEvents(world, now);
  // A switch that dropped off for a reason it never logged still shows when it went quiet.
  for (const d of devices)
    if (!d.online && !events.some((e) => e.device === d.name && e.at === d.lastSeen))
      events.push({ at: d.lastSeen, device: d.name, text: "Stopped checking in" });
  return { devices, events: events.sort((a, b) => b.at - a.at) };
}

/** Link changes on every port, plus whatever the switch logged itself. Newest first. */
function dashEvents(world: World, now: number): DashEvent[] {
  const out: DashEvent[] = [];
  for (const d of world.devices.filter((x) => x.cloud)) {
    for (const e of d.cloudLog ?? []) if (e.at <= now) out.push({ ...e, device: d.hostname });
    for (const h of world.history) {
      if (h.at > now) continue;
      if (h.deviceId === d.id) {
        out.push({
          at: h.at,
          device: d.hostname,
          text: h.state === "down" ? "Stopped checking in" : "Checked in",
        });
        continue;
      }
      const port = d.ports.find((p) => peerOn(world, d, p.name)?.id === h.deviceId);
      const peer = world.devices.find((x) => x.id === h.deviceId);
      if (!port || !peer) continue;
      out.push({
        at: h.at,
        device: d.hostname,
        text: `Port ${port.name}: link ${h.state}${h.state === "down" ? "" : ` (${clientName(peer)})`}`,
      });
    }
  }
  return out.sort((a, b) => b.at - a.at);
}

export interface ToolResult {
  ok: boolean;
  lines: string[];
}

function msg(data: GameData, key: string, vars: Record<string, string | number>): string {
  return fill(data.cloud.messages[key] ?? key, (k) => vars[k]);
}

/** Live tools need the device checking in. */
function live(world: World, data: GameData, d: Device, now: number): ToolResult | undefined {
  const ns = netState(world, now);
  if (cloudOnline(world, d, ns)) return undefined;
  return {
    ok: false,
    lines: [
      msg(data, "offline", {
        device: d.hostname,
        lastSeen: formatTime(data.calendar, lastSeen(world, d, ns)),
      }),
    ],
  };
}

/** Time-domain test of the cable on a port. A crushed cable shows one pair open near the far end. */
export function cableTest(
  world: World,
  data: GameData,
  d: Device,
  port: string,
  now: number,
): ToolResult {
  const off = live(world, data, d, now);
  if (off) return off;
  const l = linkOn(world, d, port);
  if (!l) return { ok: true, lines: [msg(data, "cableNone", { port })] };
  if (l.condition === "damaged")
    return { ok: true, lines: [msg(data, "cableOpen", { port, at: Math.max(1, l.lengthM - 2) })] };
  return { ok: true, lines: [msg(data, "cableOk", { port, length: l.lengthM })] };
}

/** Bounce a port. A device it powers loses power and boots again. */
export function portCycle(
  world: World,
  data: GameData,
  d: Device,
  port: string,
  now: number,
): ToolResult {
  const off = live(world, data, d, now);
  if (off) return off;
  const ns = netState(world, now);
  const peer = peerOn(world, d, port);
  const fed = ns.poe.get(d.id)?.ports.find((p) => p.port === port)?.state === "delivering";
  d.cloudLog ??= [];
  d.cloudLog.push({ at: now, text: `Port ${port}: cycled from the dashboard` });
  if (peer && fed) {
    powerCycle(data, peer, now);
    return { ok: true, lines: [msg(data, "cycledPoe", { port, client: clientName(peer) })] };
  }
  return { ok: true, lines: [msg(data, "cycled", { port })] };
}

export interface PortChange {
  enabled?: boolean;
  poeEnabled?: boolean;
  poePriority?: PoePriority;
}

/** Edit a port from the dashboard. The change lands on the switch at once. */
export function setPort(
  world: World,
  data: GameData,
  d: Device,
  port: string,
  change: PortChange,
  now: number,
): ToolResult {
  const off = live(world, data, d, now);
  if (off) return off;
  const p = d.ports.find((x) => x.name === port);
  if (!p) return { ok: false, lines: [`No port ${port}.`] };
  if (change.enabled === false && p.role === "uplink")
    return { ok: false, lines: [msg(data, "uplink", { port, device: d.hostname })] };
  const said: string[] = [];
  if (change.enabled !== undefined && change.enabled === !!p.shutdown) {
    p.shutdown = !change.enabled;
    said.push(change.enabled ? "enabled" : "disabled");
  }
  if (change.poeEnabled !== undefined && change.poeEnabled !== p.poeEnabled && p.poeCapable) {
    p.poeEnabled = change.poeEnabled;
    said.push(`PoE ${change.poeEnabled ? "on" : "off"}`);
  }
  if (change.poePriority && change.poePriority !== p.poePriority && p.poeCapable) {
    p.poePriority = change.poePriority;
    said.push(`PoE priority ${change.poePriority}`);
  }
  if (said.length === 0) return { ok: true, lines: ["Nothing changed."] };
  d.cloudLog ??= [];
  d.cloudLog.push({ at: now, text: `Port ${port}: ${said.join(", ")} (config change)` });
  return { ok: true, lines: [msg(data, "saved", { device: d.hostname })] };
}
