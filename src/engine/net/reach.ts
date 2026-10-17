import type { Device, World } from "../model/types";
import { inSubnet, parseCidr } from "../util/ip";
import { type NetState, firewallInterfaces, netState } from "./state";

export interface Target {
  kind: "device" | "firewall-iface" | "internet" | "isp-gateway" | "none";
  device?: Device;
  iface?: string;
}

function firewall(world: World): Device | undefined {
  return world.devices.find((d) => d.kind === "firewall");
}

/** What answers at this IP, if anything. */
export function resolveTarget(world: World, ip: string, ns: NetState = netState(world)): Target {
  const fw = firewall(world);
  if (fw) {
    for (const [name, f] of firewallInterfaces(fw)) {
      if (typeof f.ip === "string" && parseCidr(f.ip).ip === ip && f.status !== "down") {
        return { kind: "firewall-iface", device: fw, iface: name };
      }
    }
  }
  const dev = world.devices.find((d) => d.ip === ip && d.kind !== "firewall");
  if (dev) return ns.online.get(dev.id) ? { kind: "device", device: dev } : { kind: "none" };
  if (ip === world.network.isp.gateway) return { kind: "isp-gateway" };
  const privateNet = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"].some((n) => inSubnet(ip, n));
  return privateNet ? { kind: "none" } : { kind: "internet" };
}

function wanUp(fw: Device): boolean {
  return firewallInterfaces(fw).some(
    ([, f]) => f.role === "wan" && f.status === "up" && typeof f.ip === "string",
  );
}

/** Firewall interface that owns a subnet containing ip. */
function ifaceFor(fw: Device, ip: string): string | undefined {
  for (const [name, f] of firewallInterfaces(fw)) {
    if (typeof f.ip === "string" && f.status !== "down" && inSubnet(ip, f.ip)) return name;
  }
  return undefined;
}

/** Can traffic from a device reach an IP? One switch fabric, the firewall routes between VLANs. */
export function canReach(
  world: World,
  fromId: string,
  ip: string,
  ns: NetState = netState(world),
): boolean {
  const from = world.devices.find((d) => d.id === fromId);
  const fw = firewall(world);
  if (!from || !ns.online.get(from.id)) return false;
  const target = resolveTarget(world, ip, ns);
  if (target.kind === "none") return false;

  if (from.kind === "firewall") {
    if (target.kind === "firewall-iface") return true;
    if (target.kind === "internet" || target.kind === "isp-gateway") return wanUp(from);
    return ifaceFor(from, ip) !== undefined;
  }
  if (!from.ip) return false;
  const vlan = world.network.vlans.find((v) => v.id === from.vlan);
  if (
    target.kind === "device" &&
    vlan &&
    target.device?.ip &&
    inSubnet(target.device.ip, vlan.subnet)
  )
    return true;
  // Anything else goes through the gateway on the firewall.
  if (!fw || !ns.online.get(fw.id) || !from.gateway) return false;
  const gw = ifaceFor(fw, from.gateway);
  if (!gw) return false;
  if (target.kind === "firewall-iface") return true;
  if (target.kind === "internet" || target.kind === "isp-gateway") return wanUp(fw);
  return ifaceFor(fw, ip) !== undefined;
}

/** Can a device open a management session (ssh, https) to an IP? */
export function canManage(
  world: World,
  fromId: string,
  ip: string,
  service: string,
  ns: NetState = netState(world),
): boolean {
  if (!canReach(world, fromId, ip, ns)) return false;
  const target = resolveTarget(world, ip, ns);
  if (target.kind !== "firewall-iface" || !target.device || !target.iface) return false;
  const f = (target.device.running?.interfaces as Record<string, Record<string, unknown>>)[
    target.iface
  ];
  const allow = f?.allowaccess;
  return Array.isArray(allow) && allow.includes(service);
}
