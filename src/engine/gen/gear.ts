import type { GameData } from "../data";
import type {
  ClientProfile,
  Device,
  DeviceConfig,
  DeviceKind,
  Fields,
  Isp,
  Link,
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
const DAY = 1440;

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

const uptimeDays: Record<DeviceKind, [number, number]> = {
  firewall: [20, 90],
  switch: [40, 300],
  server: [5, 40],
  pc: [0, 6],
  ap: [20, 90],
  phone: [3, 60],
  camera: [1, 1],
  nvr: [10, 60],
};

/** Build a device from a template. Exported so faults can add devices the same way. */
export function makeDevice(
  rng: Rng,
  t: DeviceTemplate,
  fields: {
    id: string;
    siteId: string;
    hostname: string;
    roomId: string;
    managed: boolean;
    now?: number;
  },
): Device {
  const [lo, hi] = uptimeDays[t.kind];
  const dev: Device = {
    id: fields.id,
    siteId: fields.siteId,
    hostname: fields.hostname,
    templateId: t.id,
    kind: t.kind,
    brand: t.brand,
    model: t.model,
    firmware: rng.pick(t.firmware),
    serial: serial(rng, t.model),
    mac: mac(rng, t.brand),
    bootAt: (fields.now ?? 0) - rng.int(lo * DAY, hi * DAY + 600),
    roomId: fields.roomId,
    managed: fields.managed,
    rmmAgent: t.rmmAgent === true,
    ports: portsFromTemplate(t),
  };
  if (t.poeBudgetW !== undefined) dev.poeBudgetW = t.poeBudgetW;
  if (t.poe) dev.poe = { ...t.poe };
  if (t.dialect) dev.dialect = t.dialect;
  if (t.tags) dev.tags = [...t.tags];
  if (t.credentials) {
    dev.credentials = {
      username: t.credentials.username,
      password: `${rng.pick(["Blue", "Iron", "Delta", "Quartz", "Maple"])}-${rng.hex(6)}!`,
    };
  }
  return dev;
}

function templatesFor(
  data: GameData,
  kind: DeviceKind,
  tier: string,
  opts: { brand?: string; tag?: string } = {},
): DeviceTemplate[] {
  let all = [...data.devices.values()].filter(
    (t) => t.kind === kind && (opts.tag ? t.tags?.includes(opts.tag) : !t.tags?.length),
  );
  if (opts.brand && all.some((t) => t.brand === opts.brand))
    all = all.filter((t) => t.brand === opts.brand);
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

function roomSlug(site: Omit<Site, "vlans" | "isp" | "octet">, roomId: string): string {
  const name = site.rooms.find((r) => r.id === roomId)?.name ?? "X";
  return name.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export interface GearContext {
  devices: Device[];
  links: Link[];
  counters: Record<string, number>;
  staff: string[];
  now: number;
  /** WAN blocks already handed to a site, so two sites never share one. */
  wanBlocks?: number[];
}

export function nextId(ctx: GearContext, kind: string): string {
  ctx.counters[kind] = (ctx.counters[kind] ?? 0) + 1;
  return `${kind}-${ctx.counters[kind]}`;
}

export interface SiteGearOptions {
  role: "hq" | "branch";
  octet: number;
  switchBrand?: string;
  probe?: boolean;
}

/** Build one site's network: firewall, switch, endpoints, cabling, addresses, ISP. */
export function genSiteGear(
  rng: Rng,
  data: GameData,
  profile: ClientProfile,
  base: Omit<Site, "vlans" | "isp" | "octet">,
  plan: RoomPlan[],
  opts: SiteGearOptions,
  ctx: GearContext,
): Site {
  const vlans: Vlan[] = data.clients.lan.vlans.map((v) => {
    const subnet = v.subnet.replace("{site}", String(opts.octet));
    return { id: v.id, name: v.name, subnet, gateway: hostIn(subnet, 1), role: v.role };
  });
  const vlanOf = (role: Vlan["role"]) => vlans.find((v) => v.role === role) as Vlan;
  const closet =
    base.rooms.find((r) => r.networkCloset) ?? (base.rooms[0] as Site["rooms"][number]);
  const managed = profile.managed;
  const code = opts.role === "hq" ? profile.code : `${profile.code}B`;
  const siteId = opts.role;
  const make = (t: DeviceTemplate, kind: string, hostname: string, roomId: string) =>
    makeDevice(rng, t, { id: nextId(ctx, kind), siteId, hostname, roomId, managed, now: ctx.now });
  const pick = (kind: DeviceKind, extra: { brand?: string; tag?: string } = {}) =>
    rng.pick(templatesFor(data, kind, profile.tier, extra));

  const endpoints: Device[] = [];
  if (opts.role === "hq")
    endpoints.push(make(pick("server"), "server", `${code}-SRV01`, closet.id));
  if (opts.probe) {
    const probe = make(pick("pc", { tag: "probe" }), "pc", `${code}-MON01`, closet.id);
    probe.rmmAgent = managed;
    endpoints.push(probe);
  }
  let pcN = 0;
  let phN = 0;
  for (const room of plan) {
    for (let i = 0; i < room.pcs; i++) {
      pcN++;
      const pc = make(pick("pc"), "pc", `${code}-PC${String(pcN).padStart(2, "0")}`, room.roomId);
      pc.rmmAgent = managed;
      pc.user = ctx.staff.shift();
      endpoints.push(pc);
    }
    for (let i = 0; i < room.phones; i++) {
      phN++;
      endpoints.push(
        make(pick("phone"), "phone", `${code}-PH${String(phN).padStart(2, "0")}`, room.roomId),
      );
    }
    if (room.ap)
      endpoints.push(
        make(pick("ap"), "ap", `${code}-AP-${roomSlug(base, room.roomId)}`, room.roomId),
      );
    for (const g of room.gear)
      endpoints.push(make(pick(g.kind), g.kind, g.name.replace("{code}", code), room.roomId));
  }

  const fwT =
    opts.role === "branch"
      ? (data.devices.get("fortressgate-60g") ?? pick("firewall"))
      : pick("firewall");
  const spare = rng.int(4, 6);
  const switches = templatesFor(data, "switch", profile.tier, { brand: opts.switchBrand }).sort(
    (a, b) => accessPortCount(a) - accessPortCount(b),
  );
  const switchT =
    switches.find((t) => accessPortCount(t) >= endpoints.length + spare) ??
    [...data.devices.values()]
      .filter((t) => t.kind === "switch")
      .sort((a, b) => accessPortCount(b) - accessPortCount(a))[0];
  if (!switchT) throw new Error("no switch template");

  const fw = make(fwT, "firewall", `FG-${code}01`, closet.id);
  const sw = make(switchT, "switch", `SW-${code}01`, closet.id);
  ctx.devices.push(fw, sw, ...endpoints);

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
    else if (d.tags?.includes("probe")) assign(d, "data", 11);
    else if (d.kind === "phone") assign(d, "voice");
    else if (d.kind === "ap") assign(d, "mgmt");
    else assign(d, "data");
  }

  const fwLan = fw.ports.find((p) => p.role === "lan") as Port;
  const swUp = sw.ports.find((p) => p.role === "uplink") as Port;
  connect(ctx.links, fw, fwLan.name, sw, swUp.name, 1);
  const access = rng.shuffle(sw.ports.filter((p) => p.role === "access"));
  endpoints.slice(0, access.length).forEach((d, i) => {
    const port = access[i] as Port;
    port.vlan = d.vlan;
    connect(
      ctx.links,
      sw,
      port.name,
      d,
      (d.ports[0] as Port).name,
      d.roomId === closet.id ? 2 : rng.int(8, 70),
    );
  });
  for (const p of sw.ports)
    if (p.role === "access" && p.vlan === undefined) p.vlan = vlanOf("data").id;

  let block = ipToInt("198.51.100.0") + rng.int(0, 31) * 8;
  while (ctx.wanBlocks?.includes(block)) block = ipToInt("198.51.100.0") + rng.int(0, 31) * 8;
  ctx.wanBlocks = [...(ctx.wanBlocks ?? []), block];
  const isp: Isp = {
    name: rng.pick(ispNames),
    circuitId: `CID-${rng.digits(8)}`,
    wanCidr: `${intToIp(block)}/29`,
    gateway: intToIp(block + 1),
    wanIp: intToIp(block + 2),
    phone: `1-800-555-0${rng.digits(3)}`,
  };
  // A branch has no server, so its data VLAN always allows ssh as the way in.
  fw.running = firewallConfig(rng, fw, fwLan.name, vlans, isp, opts.role === "branch");

  return { ...base, octet: opts.octet, vlans, isp };
}

function firewallConfig(
  rng: Rng,
  fw: Device,
  lanPort: string,
  vlans: Vlan[],
  isp: Isp,
  forceSsh: boolean,
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
  // Half the time the data VLAN also allows ssh, so a PC's gateway is a second way in.
  const dataSsh = rng.chance(0.5) || forceSsh;
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
    phase1: {},
    phase2: {},
  };
}

/** Site-to-site tunnel between two firewalls, mirrored on both ends. */
export function addTunnel(rng: Rng, a: Device, aSite: Site, b: Device, bSite: Site): void {
  const psk = `${rng.pick(["harbor", "granite", "falcon", "copper"])}${rng.hex(8)}`;
  const side = (fw: Device, local: Site, remote: Site, name: string) => {
    const cfg = fw.running as DeviceConfig;
    (cfg.phase1 as Record<string, Fields>)[name] = {
      interface: "wan1",
      remoteGw: remote.isp.wanIp,
      psk,
      proposal: ["aes256-sha256"],
    };
    (cfg.phase2 as Record<string, Fields>)[name] = {
      phase1: name,
      src: `10.${local.octet}.0.0/16`,
      dst: `10.${remote.octet}.0.0/16`,
    };
    const routes = cfg.routes as Record<string, Fields>;
    routes[String(Object.keys(routes).length + 1)] = {
      dst: `10.${remote.octet}.0.0/16`,
      device: name,
    };
  };
  side(a, aSite, bSite, `to-${bSite.id}`);
  side(b, bSite, aSite, `to-${aSite.id}`);
}

/** Switch running config mirrors its ports. Built once the network is final. */
export function switchConfig(sw: Device, vlans: Vlan[]): DeviceConfig {
  const ports: Record<string, Fields> = {};
  for (const p of sw.ports) {
    const f: Fields = {
      shutdown: p.shutdown === true,
      poeEnabled: p.poeEnabled,
      poePriority: p.poePriority,
    };
    if (p.mode === "access" && p.vlan !== undefined) f.vlan = p.vlan;
    if (p.description) f.description = p.description;
    ports[p.name] = f;
  }
  const v: Record<string, Fields> = {};
  for (const x of vlans) v[String(x.id)] = { name: x.name };
  return { system: { hostname: sw.hostname }, ports, vlans: v };
}

/** Push a switch's running config back onto its ports, so the network sim sees it. */
export function syncSwitchPorts(sw: Device): void {
  const ports = (sw.running?.ports ?? {}) as Record<string, Fields>;
  for (const p of sw.ports) {
    const f = ports[p.name];
    if (!f) continue;
    p.shutdown = f.shutdown === true;
    p.poeEnabled = p.poeCapable && f.poeEnabled !== false;
    p.poePriority = (f.poePriority as Port["poePriority"]) ?? "low";
    if (typeof f.vlan === "number") p.vlan = f.vlan;
    p.description = typeof f.description === "string" ? f.description : undefined;
  }
  const host = (sw.running?.system as Fields | undefined)?.hostname;
  if (typeof host === "string") sw.hostname = host;
}
