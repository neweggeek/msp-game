import type { GameData } from "../data";
import type {
  ClientProfile,
  Device,
  DeviceConfig,
  DeviceKind,
  Fields,
  Link,
  Network,
  Port,
  Site,
  Vlan,
} from "../model/types";
import type { Rng } from "../rng/rng";
import type { DeviceTemplate } from "../schema";
import { fnv1a } from "../util/hash";
import { hostIn, intToIp, ipToInt } from "../util/ip";
import type { RoomPlan } from "./site";

const ispNames = [
  "XFinite Business",
  "Lumenix Fiber",
  "SpectraLink Business",
  "Brightway Broadband",
];

export function portsFromTemplate(t: DeviceTemplate): Port[] {
  const ports: Port[] = [];
  for (const group of t.ports) {
    for (let n = group.from; n <= group.to; n++) {
      ports.push({
        name: group.pattern.replace("{n}", String(n)),
        role: group.role ?? "access",
        mode: group.role === "uplink" ? "trunk" : group.role ? "routed" : "access",
        poeCapable: group.poe === true,
        poeEnabled: group.poe === true,
        poePriority: "low",
      });
    }
  }
  return ports;
}

function mac(rng: Rng, brand: string): string {
  const oui = (fnv1a(brand) & 0xfeffff).toString(16).padStart(6, "0");
  return `${oui}${rng.hex(6)}`.match(/../g)?.join(":") ?? "";
}

function serial(rng: Rng, model: string): string {
  const [first = "", ...rest] = model.split(" ");
  const initials = first.replace(/[^A-Z]/g, "") || first.slice(0, 2).toUpperCase();
  return `${initials}${rest
    .join("")
    .replace(/[^A-Z0-9]/gi, "")
    .toUpperCase()}${rng.digits(9)}`;
}

/** Build a device from a template. Exported so faults can add devices the same way. */
export function makeDevice(
  rng: Rng,
  t: DeviceTemplate,
  fields: { id: string; hostname: string; roomId: string; managed: boolean },
): Device {
  const dev: Device = {
    id: fields.id,
    hostname: fields.hostname,
    templateId: t.id,
    kind: t.kind,
    brand: t.brand,
    model: t.model,
    firmware: rng.pick(t.firmware),
    serial: serial(rng, t.model),
    mac: mac(rng, t.brand),
    roomId: fields.roomId,
    managed: fields.managed,
    rmmAgent: t.rmmAgent === true,
    ports: portsFromTemplate(t),
  };
  if (t.poeBudgetW !== undefined) dev.poeBudgetW = t.poeBudgetW;
  if (t.poe) dev.poe = { ...t.poe };
  if (t.dialect) dev.dialect = t.dialect;
  if (t.credentials)
    dev.credentials = {
      username: t.credentials.username,
      password: `${rng.pick(["Blue", "Iron", "Delta", "Quartz", "Maple"])}-${rng.hex(6)}!`,
    };
  return dev;
}

function templatesFor(data: GameData, kind: DeviceKind, tier: string): DeviceTemplate[] {
  const all = [...data.devices.values()].filter((t) => t.kind === kind);
  const inTier = all.filter((t) => t.tiers.includes(tier as never));
  return inTier.length > 0 ? inTier : all;
}

function accessPortCount(t: DeviceTemplate): number {
  return t.ports.filter((g) => !g.role).reduce((s, g) => s + g.to - g.from + 1, 0);
}

export function connect(
  links: Link[],
  a: Device,
  aPort: string,
  b: Device,
  bPort: string,
  lengthM: number,
): void {
  const pa = a.ports.find((p) => p.name === aPort);
  const pb = b.ports.find((p) => p.name === bPort);
  if (!pa || !pb) throw new Error(`no port ${a.id}:${aPort} or ${b.id}:${bPort}`);
  pa.link = { device: b.id, port: bPort };
  pb.link = { device: a.id, port: aPort };
  links.push({
    id: `link-${links.length + 1}`,
    a: { device: a.id, port: aPort },
    b: { device: b.id, port: bPort },
    lengthM,
    condition: "good",
  });
}

function roomSlug(site: Site, roomId: string): string {
  const name = site.rooms.find((r) => r.id === roomId)?.name ?? "X";
  return name.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export interface Gear {
  devices: Device[];
  network: Network;
}

export function genGear(
  rng: Rng,
  data: GameData,
  profile: ClientProfile,
  site: Site,
  plan: RoomPlan[],
): Gear {
  const siteOctet = rng.int(1, 250);
  const vlans: Vlan[] = data.clients.lan.vlans.map((v) => {
    const subnet = v.subnet.replace("{site}", String(siteOctet));
    return { id: v.id, name: v.name, subnet, gateway: hostIn(subnet, 1), role: v.role };
  });
  const vlanOf = (role: Vlan["role"]) => vlans.find((v) => v.role === role) as Vlan;
  const closet =
    site.rooms.find((r) => r.networkCloset) ?? (site.rooms[0] as Site["rooms"][number]);
  const managed = profile.managed;
  const code = profile.code;
  const devices: Device[] = [];
  const counters: Record<string, number> = {};
  const nextId = (kind: string) => {
    counters[kind] = (counters[kind] ?? 0) + 1;
    return `${kind}-${counters[kind]}`;
  };

  // Endpoints first, so the switch can be sized to fit them.
  const endpoints: Device[] = [];
  const pick = (kind: DeviceKind) => rng.pick(templatesFor(data, kind, profile.tier));
  const server = makeDevice(rng, pick("server"), {
    id: nextId("server"),
    hostname: `${code}-SRV01`,
    roomId: closet.id,
    managed,
  });
  endpoints.push(server);
  let pcN = 0;
  let phN = 0;
  for (const room of plan) {
    for (let i = 0; i < room.pcs; i++) {
      pcN++;
      const pc = makeDevice(rng, pick("pc"), {
        id: nextId("pc"),
        hostname: `${code}-PC${String(pcN).padStart(2, "0")}`,
        roomId: room.roomId,
        managed,
      });
      pc.rmmAgent = managed;
      endpoints.push(pc);
    }
    for (let i = 0; i < room.phones; i++) {
      phN++;
      endpoints.push(
        makeDevice(rng, pick("phone"), {
          id: nextId("phone"),
          hostname: `${code}-PH${String(phN).padStart(2, "0")}`,
          roomId: room.roomId,
          managed,
        }),
      );
    }
    if (room.ap) {
      endpoints.push(
        makeDevice(rng, pick("ap"), {
          id: nextId("ap"),
          hostname: `AP-${roomSlug(site, room.roomId)}`,
          roomId: room.roomId,
          managed,
        }),
      );
    }
  }

  const fwT = pick("firewall");
  const spare = rng.int(2, 4);
  const switchT =
    [...templatesFor(data, "switch", profile.tier)]
      .sort((a, b) => accessPortCount(a) - accessPortCount(b))
      .find((t) => accessPortCount(t) >= endpoints.length + spare) ??
    [...data.devices.values()]
      .filter((t) => t.kind === "switch")
      .sort((a, b) => accessPortCount(b) - accessPortCount(a))[0];
  if (!switchT) throw new Error("no switch template");

  const fw = makeDevice(rng, fwT, {
    id: nextId("firewall"),
    hostname: `FG-${code}01`,
    roomId: closet.id,
    managed,
  });
  const sw = makeDevice(rng, switchT, {
    id: nextId("switch"),
    hostname: `FS-${code}01`,
    roomId: closet.id,
    managed,
  });
  devices.push(fw, sw, ...endpoints);

  // Addresses.
  const counter: Record<string, number> = { data: 100, voice: 100, mgmt: 20 };
  const assign = (d: Device, role: Vlan["role"], host?: number) => {
    const v = vlanOf(role);
    counter[role] = (counter[role] ?? 0) + 1;
    d.ip = hostIn(v.subnet, host ?? (counter[role] as number));
    d.vlan = v.id;
    d.gateway = v.gateway;
  };
  assign(fw, "mgmt", 1);
  assign(sw, "mgmt", 2);
  for (const d of endpoints) {
    if (d.kind === "server") assign(d, "data", 10);
    else if (d.kind === "phone") assign(d, "voice");
    else if (d.kind === "ap") assign(d, "mgmt");
    else assign(d, "data");
  }

  // Cabling: firewall LAN to switch uplink, endpoints shuffled across access ports.
  const links: Link[] = [];
  const fwLan = fw.ports.find((p) => p.role === "lan") as Port;
  const swUp = sw.ports.find((p) => p.role === "uplink") as Port;
  connect(links, fw, fwLan.name, sw, swUp.name, 1);
  const access = rng.shuffle(sw.ports.filter((p) => p.role === "access"));
  endpoints.slice(0, access.length).forEach((d, i) => {
    const port = access[i] as Port;
    const own = d.ports[0] as Port;
    port.vlan = d.vlan;
    connect(links, sw, port.name, d, own.name, d.roomId === closet.id ? 2 : rng.int(8, 70));
  });

  // ISP: a /29 from a documentation range.
  const block = ipToInt("198.51.100.0") + rng.int(0, 31) * 8;
  const isp = {
    name: rng.pick(ispNames),
    circuitId: `CID-${rng.digits(8)}`,
    wanCidr: `${intToIp(block)}/29`,
    gateway: intToIp(block + 1),
    wanIp: intToIp(block + 2),
    phone: `1-800-555-0${rng.digits(3)}`,
  };

  fw.running = firewallConfig(rng, fw, fwLan.name, vlans, isp);
  fw.startup = structuredClone(fw.running);

  return { devices, network: { vlans, links, isp } };
}

function firewallConfig(
  rng: Rng,
  fw: Device,
  lanPort: string,
  vlans: Vlan[],
  isp: Network["isp"],
): DeviceConfig {
  const interfaces: Record<string, Fields> = {};
  for (const p of fw.ports) {
    const f: Fields = {
      type: "physical",
      status: "down",
      role: p.role === "wan" ? "wan" : "lan",
      allowaccess: [],
    };
    if (p.name === "wan1")
      Object.assign(f, {
        status: "up",
        ip: `${isp.wanIp}/29`,
        allowaccess: ["ping"],
        alias: "ISP",
      });
    if (p.name === lanPort) f.status = "up";
    interfaces[p.name] = f;
  }
  // Half the time the data VLAN also allows ssh, so the server gateway is a second way in.
  const dataSsh = rng.chance(0.5);
  for (const v of vlans) {
    const allow =
      v.role === "mgmt"
        ? ["ping", "https", "ssh", "fabric"]
        : v.role === "data" && dataSsh
          ? ["ping", "ssh"]
          : ["ping"];
    interfaces[v.name.toLowerCase()] = {
      type: "vlan",
      vlanid: v.id,
      parent: lanPort,
      ip: `${v.gateway}/${v.subnet.split("/")[1]}`,
      allowaccess: allow,
      status: "up",
      role: "lan",
      alias: v.name,
    };
  }
  return {
    system: { hostname: fw.hostname, timezone: "US/Central" },
    interfaces,
    routes: { "1": { dst: "0.0.0.0/0", gateway: isp.gateway, device: "wan1" } },
  };
}
