import type { Device, World } from "../model/types";
import { inSubnet, parseCidr } from "../util/ip";
import { type NetState, firewallInterfaces, siteFirewall } from "./state";
import { sitesLinked, wanIp } from "./vpn";

export interface Target {
  kind: "device" | "firewall-iface" | "internet" | "isp-gateway" | "none";
  device?: Device;
  iface?: string;
}

const privateNets = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"];

/** What answers at this IP, if anything. */
export function resolveTarget(world: World, ip: string, ns: NetState): Target {
  for (const fw of world.devices.filter((d) => d.kind === "firewall")) {
    for (const [name, f] of firewallInterfaces(fw)) {
      if (typeof f.ip === "string" && parseCidr(f.ip).ip === ip && f.status !== "down") {
        return ns.online.get(fw.id)
          ? { kind: "firewall-iface", device: fw, iface: name }
          : { kind: "none" };
      }
    }
  }
  const dev = world.devices.find((d) => d.ip === ip && d.kind !== "firewall");
  if (dev) return ns.online.get(dev.id) ? { kind: "device", device: dev } : { kind: "none" };
  if (world.sites.some((s) => s.isp.gateway === ip)) return { kind: "isp-gateway" };
  return privateNets.some((n) => inSubnet(ip, n)) ? { kind: "none" } : { kind: "internet" };
}

function wanUp(fw: Device): boolean {
  return wanIp(fw) !== undefined;
}

function ownsSubnet(fw: Device, ip: string): boolean {
  return firewallInterfaces(fw).some(
    ([, f]) =>
      typeof f.ip === "string" && f.status !== "down" && f.role === "lan" && inSubnet(ip, f.ip),
  );
}

/** From a site's firewall, can traffic get to this target? */
function fromFirewall(world: World, fw: Device, target: Target, ip: string, ns: NetState): boolean {
  if (target.kind === "firewall-iface" && target.device) {
    if (target.device.id === fw.id) return true;
    // Another site's firewall: its WAN over the internet, its LAN over the tunnel.
    const iface = firewallInterfaces(target.device).find(([n]) => n === target.iface)?.[1];
    if (iface?.role === "wan") return wanUp(fw);
    return sitesLinked(world, ns, fw, target.device);
  }
  if (target.kind === "internet" || target.kind === "isp-gateway") return wanUp(fw);
  if (ownsSubnet(fw, ip)) return true;
  const remote = world.devices.find(
    (d) => d.kind === "firewall" && d.id !== fw.id && ownsSubnet(d, ip),
  );
  return !!remote && sitesLinked(world, ns, fw, remote);
}

/** Can traffic from a device reach an IP? Each site is one switch fabric; firewalls route and tunnel. */
export function canReach(world: World, fromId: string, ip: string, ns: NetState): boolean {
  const from = world.devices.find((d) => d.id === fromId);
  if (!from || !ns.online.get(from.id)) return false;
  const target = resolveTarget(world, ip, ns);
  if (target.kind === "none") return false;
  if (from.kind === "firewall") return fromFirewall(world, from, target, ip, ns);
  if (!from.ip) return false;
  const site = world.sites.find((s) => s.id === from.siteId);
  const vlan = site?.vlans.find((v) => v.id === from.vlan);
  // Same subnet and same site: straight across the switch.
  if (
    vlan &&
    inSubnet(from.ip, vlan.subnet) &&
    inSubnet(ip, vlan.subnet) &&
    target.device?.siteId === from.siteId
  )
    return true;
  // Anything else goes through the gateway, which must be this site's firewall.
  const fw = siteFirewall(world, from.siteId);
  if (!fw || !ns.online.get(fw.id) || !from.gateway || !inSubnet(from.ip, `${from.gateway}/24`))
    return false;
  if (
    !firewallInterfaces(fw).some(
      ([, f]) =>
        typeof f.ip === "string" && parseCidr(f.ip).ip === from.gateway && f.status !== "down",
    )
  )
    return false;
  return fromFirewall(world, fw, target, ip, ns);
}

/** Can a device open a management session (ssh, https) to an IP? */
export function canManage(
  world: World,
  fromId: string,
  ip: string,
  service: string,
  ns: NetState,
): boolean {
  if (!canReach(world, fromId, ip, ns)) return false;
  const target = resolveTarget(world, ip, ns);
  if (target.kind === "device") return target.device?.kind === "switch" && !!target.device.dialect;
  if (target.kind !== "firewall-iface" || !target.device || !target.iface) return false;
  const f = (target.device.running?.interfaces as Record<string, Record<string, unknown>>)[
    target.iface
  ];
  const allow = f?.allowaccess;
  return Array.isArray(allow) && allow.includes(service);
}

/** DNS servers a device uses: typed in, or what DHCP gives at its site. */
export function dnsServers(world: World, dev: Device): string[] {
  if (dev.dns) return dev.dns;
  const server = world.devices.find((d) => d.kind === "server" && d.siteId === "hq");
  return server?.ip ? [server.ip] : [];
}

export type Lookup =
  | { ok: true; ip: string; server: string }
  | { ok: false; server: string; reason: "nxdomain" | "timeout" };

/** Resolve a name the way the device would. Internal names only resolve on the client's own DNS. */
export function resolveName(world: World, dev: Device, name: string, ns: NetState): Lookup {
  const servers = dnsServers(world, dev);
  const lower = name.toLowerCase().replace(/\.$/, "");
  const short = lower.endsWith(`.${world.client.domain}`)
    ? lower.slice(0, -world.client.domain.length - 1)
    : lower;
  for (const server of servers) {
    if (!canReach(world, dev.id, server, ns)) continue;
    const internalServer = world.devices.some((d) => d.ip === server && d.kind === "server");
    const hit = world.devices.find(
      (d) => d.hostname.toLowerCase() === short && d.ip && d.kind !== "camera",
    );
    if (hit && internalServer) return { ok: true, ip: hit.ip as string, server };
    if (lower.includes(".") && !lower.endsWith(".local")) {
      let h = 0;
      for (const c of lower) h = (h * 31 + c.charCodeAt(0)) >>> 0;
      return { ok: true, ip: `142.250.${h % 200}.${(h >>> 8) % 250}`, server };
    }
    return { ok: false, server, reason: "nxdomain" };
  }
  return { ok: false, server: servers[0] ?? "none", reason: "timeout" };
}
