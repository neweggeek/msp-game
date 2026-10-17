import type { Device, Fields, World } from "../model/types";
import { canReach } from "../net/reach";
import { type NetState, firewallInterfaces, netState } from "../net/state";
import { tunnelStates, wanIp } from "../net/vpn";
import type { ViewNode } from "../schema";
import { fnv1a } from "../util/hash";
import { inSubnet, ipToInt, parseCidr, prefixToMask } from "../util/ip";
import { fill } from "../util/template";

export type ViewData = Record<string, unknown>;

/** Render a dialect view template against data. Rows nest through "each". */
export function renderView(node: ViewNode, data: ViewData): string[] {
  const look = (key: string) => data[key];
  const out = (node.lines ?? []).map((l) => fill(l, look));
  if (node.each?.rows) {
    const rows = (data[node.each.rows] as ViewData[] | undefined) ?? [];
    if (rows.length === 0 && node.empty) out.push(node.empty);
    for (const row of rows) out.push(...renderView(node.each, { ...data, ...row }));
  } else if (node.empty && node.lines === undefined) {
    out.push(node.empty);
  }
  if (node.footer) out.push(...node.footer.map((l) => fill(l, look)));
  return out;
}

function ifaceRows(fw: Device): ViewData[] {
  return firewallInterfaces(fw).map(([name, f]) => {
    const ip = typeof f.ip === "string" ? parseCidr(f.ip) : null;
    return {
      name,
      ipMask: ip ? `${ip.ip} ${prefixToMask(ip.prefix)}` : "0.0.0.0 0.0.0.0",
      status: f.status ?? "down",
      type: f.type ?? "physical",
      alias: f.alias ?? "",
    };
  });
}

function ifaceForIp(fw: Device, ip: string): string {
  const hit = firewallInterfaces(fw).find(
    ([, f]) => typeof f.ip === "string" && inSubnet(ip, f.ip),
  );
  return hit ? hit[0] : "";
}

/** "12 days, 4 hours, 9 minutes" */
export function uptimeText(minutes: number): string {
  const m = Math.max(0, minutes);
  const n = (v: number, unit: string) => `${v} ${unit}${v === 1 ? "" : "s"}`;
  return `${n(Math.floor(m / 1440), "day")}, ${n(Math.floor((m % 1440) / 60), "hour")}, ${n(m % 60, "minute")}`;
}

function clockOf(now: number): string {
  const m = ((now % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:${String(fnv1a(String(now)) % 60).padStart(2, "0")}`;
}

export interface ViewContext {
  world: World;
  device: Device;
  args: Record<string, string[]>;
  time: string;
  now: number;
}

export type ViewResult =
  | { ok: true; data: ViewData }
  | { ok: false; error: string; token?: string };

function stateWord(s: string): string {
  return s === "delivering"
    ? "Delivering"
    : s === "denied"
      ? "Denied"
      : s === "disabled"
        ? "Disabled"
        : "Searching";
}

/** Data for a named view. The dialect decides how it looks; this decides what is true. */
export function viewData(name: string, ctx: ViewContext): ViewResult {
  const { world, device } = ctx;
  const ns = netState(world, ctx.now);
  const site = world.sites.find((s) => s.id === device.siteId);
  const peerOf = (portName: string) => {
    const p = device.ports.find((x) => x.name === portName);
    return p?.link ? world.devices.find((d) => d.id === p.link?.device) : undefined;
  };
  switch (name) {
    case "system-status":
      return {
        ok: true,
        data: {
          model: device.model.replace(/\s+/g, "-"),
          firmware: device.firmware,
          build: (fnv1a(device.firmware) % 9000) + 1000,
          serial: device.serial,
          hostname: device.hostname,
          time: ctx.time,
        },
      };
    case "version":
      return {
        ok: true,
        data: {
          model: device.model.replace(/^Aurora CX /, ""),
          firmware: device.firmware,
          serial: device.serial,
          uptime: uptimeText(ctx.now - device.bootAt),
        },
      };
    case "performance": {
      const memTotal = 2009000 + (fnv1a(device.serial) % 4) * 1000000;
      const memPct = 38 + (fnv1a(device.id) % 20);
      return {
        ok: true,
        data: {
          memTotal,
          memUsed: Math.round((memTotal * memPct) / 100),
          memPct,
          netKbps: 400 + (fnv1a(`${device.id}${Math.floor(ctx.now / 5)}`) % 3000),
          uptime: uptimeText(ctx.now - device.bootAt),
        },
      };
    }
    case "arp": {
      const entries: ViewData[] = world.devices
        .filter(
          (d) =>
            d.id !== device.id &&
            d.ip &&
            d.siteId === device.siteId &&
            ns.online.get(d.id) &&
            ifaceForIp(device, d.ip),
        )
        .map((d) => ({
          ip: d.ip,
          age: fnv1a(d.mac) % 5,
          mac: d.mac,
          iface: ifaceForIp(device, d.ip as string),
        }));
      if (site)
        entries.push({ ip: site.isp.gateway, age: 0, mac: "00:1d:7e:42:10:01", iface: "wan1" });
      entries.sort((a, b) => ipToInt(a.ip as string) - ipToInt(b.ip as string));
      return { ok: true, data: { entries } };
    }
    case "interface-list":
      return { ok: true, data: { interfaces: ifaceRows(device) } };
    case "routes": {
      const routes: ViewData[] = [];
      for (const r of Object.values((device.running?.routes ?? {}) as Record<string, Fields>)) {
        routes.push({
          code: "S*",
          dst: r.dst,
          via: r.gateway
            ? `[10/0] via ${r.gateway}, ${r.device}`
            : `[10/0] is directly connected, ${r.device}`,
        });
      }
      for (const [n, f] of firewallInterfaces(device)) {
        if (typeof f.ip !== "string" || f.status === "down") continue;
        const { ip, prefix } = parseCidr(f.ip);
        const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
        const net = ipToInt(ip) & mask;
        routes.push({
          code: "C ",
          dst: `${[net >>> 24, (net >>> 16) & 255, (net >>> 8) & 255, net & 255].join(".")}/${prefix}`,
          via: `is directly connected, ${n}`,
        });
      }
      return { ok: true, data: { routes } };
    }
    case "tunnel-summary": {
      const tunnels = tunnelStates(world, ns)
        .filter((t) => t.firewallId === device.id)
        .map((t) => {
          const h = fnv1a(`${device.id}${t.name}`);
          return {
            name: t.name,
            peer: t.remoteGw,
            selectorsUp: t.phase2Up ? 1 : 0,
            rx: t.phase2Up ? (h % 90000) + 1000 : 0,
            tx: t.phase2Up ? ((h >>> 4) % 90000) + 1000 : (h % 300) + 40,
            txErr: t.phase2Up ? 0 : (h % 300) + 40,
          };
        });
      return { ok: true, data: { tunnels } };
    }
    case "ike-log": {
      const all = tunnelStates(world, ns);
      const entries: ViewData[] = [];
      const t0 = ctx.now - 3;
      for (const t of all.filter((x) => x.firewallId === device.id && x.error)) {
        const message =
          t.error === "no-response"
            ? `negotiation timeout, no response from ${t.remoteGw}`
            : t.error === "psk-mismatch"
              ? `probable pre-shared secret mismatch with ${t.remoteGw}`
              : `no matching phase2 selectors found, local ${t.src} remote ${t.dst}`;
        entries.push({ time: clockOf(t0), tunnel: t.name, message });
      }
      // Requests from peers this side has no phase 1 for.
      const mine = wanIp(device);
      for (const t of all.filter((x) => x.firewallId !== device.id && x.remoteGw === mine)) {
        const other = world.devices.find((d) => d.id === t.firewallId);
        const from = other ? wanIp(other) : undefined;
        const known = Object.values((device.running?.phase1 ?? {}) as Record<string, Fields>).some(
          (p) => p.remoteGw === from,
        );
        if (from && !known)
          entries.push({
            time: clockOf(t0 + 1),
            tunnel: "-",
            message: `ignoring request from ${from}: no matching gateway`,
          });
      }
      return { ok: true, data: { entries } };
    }
    case "tunnel-up": {
      const tname = (ctx.args.name?.[0] ?? "").replace(/^"(.*)"$/, "$1");
      const t = tunnelStates(world, ns).find((x) => x.firewallId === device.id && x.name === tname);
      if (!t) return { ok: false, error: "no-entry", token: tname };
      return {
        ok: true,
        data: {
          name: tname,
          result: t.phase2Up ? "Tunnel is up." : "Negotiation failed. See diagnose vpn ike log.",
        },
      };
    }
    case "poe-status": {
      // Switches managed from this gate: the ones at its site with no CLI of their own.
      const switches = world.devices.filter(
        (d) => d.kind === "switch" && d.siteId === device.siteId && !d.dialect,
      );
      return {
        ok: true,
        data: {
          switches: switches.map((sw) => {
            const poe = ns.poe.get(sw.id);
            return {
              hostname: sw.hostname,
              model: sw.model,
              budgetW: poe?.budgetW ?? 0,
              allocatedW: (poe?.allocatedW ?? 0).toFixed(1),
              requestedW: (poe?.requestedW ?? 0).toFixed(1),
              ports: (poe?.ports ?? [])
                .filter((p) => p.state !== "none")
                .map((p) => ({
                  port: p.port,
                  state: stateWord(p.state),
                  class: p.class ?? "-",
                  priority: p.priority,
                  powerW: p.powerW.toFixed(1),
                  device: world.devices.find((d) => d.id === p.deviceId)?.hostname ?? "",
                })),
            };
          }),
        },
      };
    }
    case "poe": {
      const poe = ns.poe.get(device.id);
      if (!poe) return { ok: false, error: "unknown-command" };
      return {
        ok: true,
        data: {
          budgetW: poe.budgetW.toFixed(1),
          drawnW: poe.allocatedW.toFixed(1),
          remainingW: (poe.budgetW - poe.allocatedW).toFixed(1),
          ports: poe.ports
            .filter((p) => p.state !== "none")
            .map((p) => ({
              port: p.port,
              priority: p.priority,
              state: p.state === "searching" ? "Searching" : stateWord(p.state),
              class: p.class ?? "-",
              drawn: `${p.powerW.toFixed(1)} W`,
              name: device.ports.find((x) => x.name === p.port)?.description ?? "",
            })),
        },
      };
    }
    case "interface-brief":
      return {
        ok: true,
        data: {
          ports: device.ports.map((p) => {
            const peer = peerOf(p.name);
            const up =
              !p.shutdown && !!peer && ns.powered.get(peer.id) === true && !ns.asleep.get(peer.id);
            return {
              port: p.name,
              vlan: p.mode === "access" ? (p.vlan ?? 1) : "--",
              mode: p.mode === "access" ? "access" : "trunk",
              status: up ? "up" : "down",
              reason: p.shutdown ? "Administratively down" : up ? "" : "No link",
              speed: up ? "1G" : "--",
              description: p.description ?? "",
            };
          }),
        },
      };
    case "vlans": {
      const vlans = Object.entries((device.running?.vlans ?? {}) as Record<string, Fields>).map(
        ([id, f]) => ({
          id,
          name: f.name ?? "",
          ports:
            device.ports
              .filter((p) => p.mode === "access" && String(p.vlan) === id)
              .map((p) => p.name)
              .join(", ") || "-",
        }),
      );
      return { ok: true, data: { vlans } };
    }
    case "mac-table": {
      const entries = device.ports
        .map((p) => ({ p, peer: peerOf(p.name) }))
        .filter(({ p, peer }) => peer && !p.shutdown && ns.online.get(peer.id))
        .map(({ p, peer }) => ({
          mac: peer?.mac,
          vlan: p.mode === "access" ? (p.vlan ?? 1) : (peer?.vlan ?? 1),
          port: p.name,
        }));
      return { ok: true, data: { entries } };
    }
    case "lldp": {
      // Cameras and PCs here do not speak LLDP.
      const neighbors = device.ports
        .map((p) => ({ p, peer: peerOf(p.name) }))
        .filter(
          ({ p, peer }) =>
            peer &&
            !p.shutdown &&
            ns.online.get(peer.id) &&
            ["ap", "phone", "firewall", "switch"].includes(peer.kind),
        )
        .map(({ p, peer }) => ({
          port: p.name,
          chassis: peer?.mac,
          peerPort: p.link?.port,
          name: peer?.hostname,
        }));
      return { ok: true, data: { neighbors } };
    }
    case "port-stats":
    case "port-detail": {
      const portName = ctx.args.port?.[0] ?? "";
      const owners =
        name === "port-stats"
          ? world.devices.filter(
              (d) => d.kind === "switch" && d.siteId === device.siteId && !d.dialect,
            )
          : [device];
      for (const sw of owners) {
        const port = sw.ports.find((p) => p.name === portName);
        if (!port) continue;
        const peer = port.link ? world.devices.find((d) => d.id === port.link?.device) : undefined;
        const up =
          !port.shutdown && !!peer && ns.powered.get(peer.id) === true && !ns.asleep.get(peer.id);
        const base = fnv1a(`${sw.id}:${port.name}`);
        const poe = ns.poe.get(sw.id)?.ports.find((x) => x.port === port.name);
        return {
          ok: true,
          data: {
            hostname: sw.hostname,
            port: port.name,
            link: up ? "up" : "down",
            status: port.shutdown ? "administratively down" : up ? "up" : "down",
            description: port.description ?? "",
            vlan: port.vlan ?? 1,
            poe: poe ? stateWord(poe.state).toLowerCase() : "n/a",
            speed: up ? "1000M full" : "-",
            rxPackets: up ? (base % 900000) + 10000 : 0,
            txPackets: up ? ((base >>> 3) % 900000) + 10000 : 0,
            rxErrors: 0,
            txErrors: 0,
            crc: 0,
            drops: 0,
          },
        };
      }
      return { ok: false, error: "no-entry", token: portName };
    }
    default:
      return { ok: false, error: "unknown-command" };
  }
}

function isInternal(world: World, ip: string): boolean {
  return (
    world.sites.some((s) => s.vlans.some((v) => inSubnet(ip, v.subnet))) ||
    inSubnet(ip, "10.0.0.0/8")
  );
}

export function pingData(
  world: World,
  device: Device,
  target: string,
  ns: NetState,
): { reachable: boolean; data: ViewData } {
  const reachable = canReach(world, device.id, target, ns);
  const base = fnv1a(target);
  const internet = !isInternal(world, target);
  const remoteSite =
    !internet &&
    !world.sites.find((s) => s.id === device.siteId)?.vlans.some((v) => inSubnet(target, v.subnet));
  const extra = internet ? 11 : remoteSite ? 18 : 0.3;
  const replies = Array.from({ length: 5 }, (_, seq) => ({
    seq,
    ttl: internet ? 117 : 64,
    ms: (((base >>> seq) % 40) / 10 + extra).toFixed(1),
  }));
  return { reachable, data: { target, replies } };
}

export function traceData(world: World, device: Device, target: string, ns: NetState): ViewData {
  const reachable = canReach(world, device.id, target, ns);
  const site = world.sites.find((s) => s.id === device.siteId);
  const path = isInternal(world, target)
    ? [target]
    : [site?.isp.gateway ?? "*", "100.64.12.1", "72.14.200.9", target];
  const hops = path.map((ip, i) => ({
    n: i + 1,
    ip: reachable || i < path.length - 1 ? ip : "*",
    ms: reachable || i < path.length - 1 ? (1 + i * 4.2 + (fnv1a(ip) % 10) / 10).toFixed(3) : "*",
  }));
  return { target, hops };
}
