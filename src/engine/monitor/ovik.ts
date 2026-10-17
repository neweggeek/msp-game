import type { DeviceKind, HistoryEvent, World } from "../model/types";
import { canReach } from "../net/reach";
import { netState } from "../net/state";

export interface OvikRow {
  deviceId: string;
  hostname: string;
  /** Undefined when discovery could not tell what it is. */
  kind?: DeviceKind;
  ip: string;
  uplink: string;
  status: "up" | "down" | "unknown";
  /** Not in the device list Ovik was set up with. */
  discovered: boolean;
}

export interface OvikAlert {
  deviceId: string;
  hostname: string;
  ip: string;
  since: number;
  text: string;
}

export interface OvikView {
  collector: { hostname: string; ip: string; online: boolean };
  inventory: OvikRow[];
  alerts: OvikAlert[];
  history: { at: number; hostname: string; state: "down" | "up"; note: string }[];
}

/** What the Ovik console shows right now. It only knows what its collector can see. */
export function ovikView(world: World, now: number): OvikView {
  const ns = netState(world, now);
  const col = world.devices.find((d) => d.id === world.monitoring.collectorId);
  const colOnline = !!col && ns.online.get(col.id) === true;
  const inventory: OvikRow[] = world.monitoring.inventory.map((o) => {
    const dev = world.devices.find((d) => d.id === o.deviceId);
    let status: OvikRow["status"] = "unknown";
    if (colOnline && col)
      status = o.deviceId === col.id || canReach(world, col.id, o.ip, ns) ? "up" : "down";
    return {
      deviceId: o.deviceId,
      hostname: o.hostname,
      ...(dev ? { kind: dev.kind } : {}),
      ip: o.ip,
      uplink: o.uplink ?? "",
      status,
      discovered: !!dev?.addedBy,
    };
  });
  const lastDown = (id: string): HistoryEvent | undefined =>
    [...world.history]
      .reverse()
      .find((h) => h.deviceId === id && h.at <= now && h.state === "down");
  const alerts: OvikAlert[] = inventory
    .filter((r) => r.status === "down")
    .map((r) => {
      const since = lastDown(r.deviceId)?.at ?? 0;
      return {
        deviceId: r.deviceId,
        hostname: r.hostname,
        ip: r.ip,
        since,
        text: `${r.hostname} (${r.ip}) not responding`,
      };
    });
  const name = (id: string) =>
    world.monitoring.inventory.find((o) => o.deviceId === id)?.hostname ??
    world.devices.find((d) => d.id === id)?.hostname ??
    id;
  const site = world.sites.find((s) => s.id === col?.siteId)?.name ?? "site";
  const history = world.history
    .filter((h) => h.at <= now)
    .map((h) =>
      h.deviceId === col?.id
        ? {
            at: h.at,
            hostname: `All devices at ${site}`,
            state: h.state,
            note: h.state === "down" ? "Site down: no data from any device" : "Site back up",
          }
        : {
            at: h.at,
            hostname: name(h.deviceId),
            state: h.state,
            // Ovik only sees pings. The real cause stays in the world history for the debug view.
            note: h.state === "down" ? "Stopped responding" : "Responding again",
          },
    )
    .sort((a, b) => b.at - a.at);
  return {
    collector: { hostname: col?.hostname ?? "", ip: col?.ip ?? "", online: colOnline },
    inventory,
    alerts,
    history,
  };
}
