import { uptimeText } from "../cli/views";
import type { Fields, World } from "../model/types";
import { canManage, resolveTarget } from "../net/reach";
import { netState } from "../net/state";
import { tunnelStates } from "../net/vpn";

export interface WebPage {
  ok: boolean;
  error?: string;
  title?: string;
  deviceId?: string;
  sections?: { heading: string; rows: string[][] }[];
}

/** A read-only web admin page, opened in a browser on an RMM host. */
export function webPage(world: World, now: number, fromId: string, address: string): WebPage {
  const ns = netState(world, now);
  const target = resolveTarget(world, address, ns);
  if (!target.device || !canManage(world, fromId, address, "https", ns)) {
    return { ok: false, error: `This site can't be reached. ${address} took too long to respond.` };
  }
  const d = target.device;
  const head = {
    heading: "System",
    rows: [
      ["Hostname", d.hostname],
      ["Model", d.model],
      ["Firmware", d.firmware],
      ["Serial", d.serial],
      ["Uptime", uptimeText(now - d.bootAt)],
    ],
  };
  if (d.kind === "firewall") {
    const ifaces = Object.entries((d.running?.interfaces ?? {}) as Record<string, Fields>)
      .filter(([, f]) => f.status === "up")
      .map(([n, f]) => [
        n,
        String(f.ip ?? ""),
        String(f.alias ?? ""),
        Array.isArray(f.allowaccess) ? f.allowaccess.join(", ") : "",
      ]);
    const tunnels = tunnelStates(world, ns)
      .filter((t) => t.firewallId === d.id)
      .map((t) => [t.name, t.remoteGw, t.phase1Up ? "Up" : "Down", t.phase2Up ? "Up" : "Down"]);
    return {
      ok: true,
      deviceId: d.id,
      title: `FortressGate ${d.hostname}`,
      sections: [
        head,
        { heading: "Interfaces", rows: [["Name", "IP", "Alias", "Admin access"], ...ifaces] },
        {
          heading: "IPsec tunnels",
          rows: [["Name", "Remote gateway", "Phase 1", "Phase 2"], ...tunnels],
        },
      ],
    };
  }
  const poe = ns.poe.get(d.id);
  const ports = (poe?.ports ?? [])
    .filter((p) => p.deviceId)
    .map((p) => [
      p.port,
      world.devices.find((x) => x.id === p.deviceId)?.kind === "camera"
        ? "unknown"
        : (world.devices.find((x) => x.id === p.deviceId)?.hostname ?? ""),
      p.priority,
      p.state,
      `${p.powerW.toFixed(1)} W`,
    ]);
  return {
    ok: true,
    deviceId: d.id,
    title: `${d.brand === "aurora" ? "Aurora CX" : d.brand} ${d.hostname}`,
    sections: [
      head,
      {
        heading: "PoE",
        rows: [
          ["Budget", `${poe?.budgetW ?? 0} W`],
          ["Allocated", `${(poe?.allocatedW ?? 0).toFixed(1)} W`],
          ["Requested", `${(poe?.requestedW ?? 0).toFixed(1)} W`],
        ],
      },
      { heading: "Ports", rows: [["Port", "LLDP name", "Priority", "PoE", "Power"], ...ports] },
    ],
  };
}
