import type { Device, Fields, World } from "../model/types";
import { canReach } from "../net/reach";
import { firewallInterfaces, netState } from "../net/state";
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

export interface ViewContext {
  world: World;
  device: Device;
  args: Record<string, string[]>;
  time: string;
}

export type ViewResult =
  | { ok: true; data: ViewData }
  | { ok: false; error: string; token?: string };

/** Data for a named view. The dialect decides how it looks; this decides what is true. */
export function viewData(name: string, ctx: ViewContext): ViewResult {
  const { world, device } = ctx;
  const ns = netState(world);
  const switches = world.devices.filter((d) => d.kind === "switch");
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
    case "arp": {
      const entries = world.devices
        .filter(
          (d) => d.id !== device.id && d.ip && ns.online.get(d.id) && ifaceForIp(device, d.ip),
        )
        .map((d) => ({
          ip: d.ip,
          age: fnv1a(d.mac) % 5,
          mac: d.mac,
          iface: ifaceForIp(device, d.ip as string),
        }));
      entries.push({
        ip: world.network.isp.gateway,
        age: 0,
        mac: "00:1d:7e:42:10:01",
        iface: "wan1",
      });
      entries.sort((a, b) => ipToInt(a.ip as string) - ipToInt(b.ip as string));
      return { ok: true, data: { entries } };
    }
    case "interface-list":
      return { ok: true, data: { interfaces: ifaceRows(device) } };
    case "routes": {
      const routes: ViewData[] = [];
      for (const r of Object.values((device.running?.routes ?? {}) as Record<string, Fields>)) {
        routes.push({ code: "S*", dst: r.dst, via: `[10/0] via ${r.gateway}, ${r.device}` });
      }
      for (const [name, f] of firewallInterfaces(device)) {
        if (typeof f.ip !== "string" || f.status === "down") continue;
        const { ip, prefix } = parseCidr(f.ip);
        const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
        const net = [
          (ipToInt(ip) & mask) >>> 24,
          ((ipToInt(ip) & mask) >>> 16) & 255,
          ((ipToInt(ip) & mask) >>> 8) & 255,
          ipToInt(ip) & mask & 255,
        ].join(".");
        routes.push({ code: "C ", dst: `${net}/${prefix}`, via: `is directly connected, ${name}` });
      }
      return { ok: true, data: { routes } };
    }
    case "poe-status":
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
                  state:
                    p.state === "delivering"
                      ? "Delivering"
                      : p.state === "denied"
                        ? "Denied"
                        : p.state === "disabled"
                          ? "Disabled"
                          : "Searching",
                  class: p.class ?? "-",
                  priority: p.priority,
                  powerW: p.powerW.toFixed(1),
                  device: world.devices.find((d) => d.id === p.deviceId)?.hostname ?? "",
                })),
            };
          }),
        },
      };
    case "port-stats": {
      const portName = ctx.args.port?.[0] ?? "";
      for (const sw of switches) {
        const port = sw.ports.find((p) => p.name === portName);
        if (!port) continue;
        const peer = port.link ? world.devices.find((d) => d.id === port.link?.device) : undefined;
        const up = !!peer && ns.powered.get(peer.id) === true;
        const base = fnv1a(`${sw.id}:${port.name}`);
        return {
          ok: true,
          data: {
            hostname: sw.hostname,
            port: port.name,
            link: up ? "up" : "down",
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
      return { ok: false, error: "no-entry" };
    }
    default:
      return { ok: false, error: "unknown-command" };
  }
}

export function pingData(
  world: World,
  device: Device,
  target: string,
): { reachable: boolean; data: ViewData } {
  const reachable = canReach(world, device.id, target);
  const base = fnv1a(target);
  const internet = !world.network.vlans.some((v) => inSubnet(target, v.subnet));
  const replies = Array.from({ length: 5 }, (_, seq) => ({
    seq,
    ttl: internet ? 117 : 64,
    ms: (((base >>> seq) % 40) / 10 + (internet ? 11 : 0.3)).toFixed(1),
  }));
  return { reachable, data: { target, replies } };
}

export function traceData(world: World, device: Device, target: string): ViewData {
  const reachable = canReach(world, device.id, target);
  const internal = world.network.vlans.some((v) => inSubnet(target, v.subnet));
  const path = internal
    ? [target]
    : [world.network.isp.gateway, "100.64.12.1", "72.14.200.9", target];
  const hops = path.map((ip, i) => ({
    n: i + 1,
    ip: reachable || i < path.length - 1 ? ip : "*",
    ms: reachable || i < path.length - 1 ? (1 + i * 4.2 + (fnv1a(ip) % 10) / 10).toFixed(3) : "*",
  }));
  return { target, hops };
}
