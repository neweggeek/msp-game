import type { GameData } from "../data";
import type { Device, World } from "../model/types";
import { resolveTarget, sslVpnUp, vpnCanReach } from "../net/reach";
import { bootTime, clockOffset, ispDownBetween, netState } from "../net/state";
import { fnv1a } from "../util/hash";
import { isIp } from "../util/ip";
import { fill } from "../util/template";

/** Your laptop's VPN apps, the one connection you can hold, and the authenticator's lockouts. */
export interface VpnState {
  /** Brand -> installed app version. */
  apps: Record<string, string>;
  /** id: SSH sessions opened over this connection carry it, so they die with it. */
  conn?: { id: number; fwId: string; gateway: string; since: number };
  nextConn?: number;
  /** A push sign-in waiting on your phone. */
  push?: { fwId: string; gateway: string; at: number };
  /** Firewall id -> bad codes in a row, and minute the account unlocks. */
  bad: Record<string, number>;
  lockedUntil: Record<string, number>;
}

export interface ConnectRequest {
  app: string;
  gateway: string;
  port: number;
  username: string;
  password: string;
  code?: string;
}

export interface VpnResult {
  ok: boolean;
  output: string[];
}

export function newVpnState(data: GameData): VpnState {
  return {
    apps: Object.fromEntries(data.vpn.apps.map((a) => [a.brand, a.installed])),
    bad: {},
    lockedUntil: {},
  };
}

/** "7.0.9" against "7.2": negative when a is older. */
export function compareVersions(a: string, b: string): number {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Six digits from the shared secret and the time step, the way an authenticator app does it. */
export function totp(secret: string, step: number): string {
  return String(fnv1a(`${secret}:${step}`) % 1000000).padStart(6, "0");
}

function step(data: GameData, minute: number): number {
  return Math.floor(minute / data.vpn.mfa.stepMinutes);
}

export interface AuthEntry {
  fwId: string;
  label: string;
  mfa: "totp" | "push";
  code?: string;
  /** Minute the code changes. */
  changesAt?: number;
}

/** What the MSP authenticator on your phone shows. Your phone keeps good time. */
export function authenticator(world: World, data: GameData, now: number): AuthEntry[] {
  return world.devices
    .filter((d) => d.vpn)
    .map((d) => {
      const v = d.vpn as NonNullable<Device["vpn"]>;
      const label = `${world.client.name} VPN (${v.username})`;
      if (v.mfa === "push") return { fwId: d.id, label, mfa: "push" };
      const s = step(data, now);
      return {
        fwId: d.id,
        label,
        mfa: "totp",
        code: totp(v.secret, s),
        changesAt: (s + 1) * data.vpn.mfa.stepMinutes,
      };
    });
}

/** The firewall answering on this public IP, if it is one. */
function gatewayFirewall(world: World, gateway: string, now: number): Device | undefined {
  if (!isIp(gateway)) return undefined;
  const t = resolveTarget(world, gateway, netState(world, now));
  if (t.kind !== "firewall-iface" || !t.device) return undefined;
  const f = (t.device.running?.interfaces as Record<string, Record<string, unknown>>)[
    t.iface ?? ""
  ];
  return f?.role === "wan" ? t.device : undefined;
}

function log(fw: Device, now: number, text: string): void {
  fw.vpn?.log.push({ at: now, text });
}

/** Try to connect. Costs connectMinutes whatever happens; the caller spends it. */
export function connect(
  vs: VpnState,
  world: World,
  data: GameData,
  now: number,
  req: ConnectRequest,
  fmt: (min: number) => string,
): VpnResult {
  const m = data.vpn.messages;
  const say = (key: string, vars: Record<string, unknown> = {}) =>
    fill(m[key] ?? key, (k) => vars[k] ?? (req as unknown as Record<string, unknown>)[k]);
  const fail = (key: string, vars: Record<string, unknown> = {}) => ({
    ok: false,
    output: [say(key, vars)],
  });
  const app = data.vpn.apps.find((a) => a.name === req.app);
  const version = app ? vs.apps[app.brand] : undefined;
  if (!app || !version) return fail("noApp");
  const ns = netState(world, now);
  const fw = gatewayFirewall(world, req.gateway, now);
  const port = Number((fw?.running?.sslvpn as Record<string, unknown> | undefined)?.port);
  if (!fw || !sslVpnUp(fw, ns) || port !== req.port) return fail("unreachable");
  if (fw.brand !== app.brand) return fail("wrongApp");
  const min = app.minVersion[fw.firmware.split(".").slice(0, 2).join(".")];
  if (min && compareVersions(version, min) < 0) return fail("oldApp", { version, min });
  const v = fw.vpn;
  const until = vs.lockedUntil[fw.id];
  if (until !== undefined && now < until) return fail("locked", { time: fmt(until) });
  if (!v || v.username !== req.username || v.password !== req.password) {
    log(fw, now, `login failed for user "${req.username}"`);
    return fail("badLogin");
  }
  vs.conn = undefined;
  if (v.mfa === "push") {
    vs.push = { fwId: fw.id, gateway: req.gateway, at: now };
    log(fw, now, `push sign-in sent for ${v.username}`);
    return { ok: true, output: [say("pushSent")] };
  }
  if (!req.code) return fail("needCode");
  // The firewall checks the code against its own clock, and takes the step before too.
  const fwStep = step(data, now + clockOffset(fw));
  if (
    req.code.trim() !== totp(v.secret, fwStep) &&
    req.code.trim() !== totp(v.secret, fwStep - 1)
  ) {
    const bad = (vs.bad[fw.id] ?? 0) + 1;
    log(fw, now, `token code rejected for ${v.username}`);
    if (bad >= data.vpn.mfa.badCodesToLock) {
      vs.bad[fw.id] = 0;
      vs.lockedUntil[fw.id] = now + data.vpn.mfa.lockMinutes;
      log(
        fw,
        now,
        `${v.username} locked for ${data.vpn.mfa.lockMinutes} minutes after ${bad} bad token codes`,
      );
      return fail("nowLocked", { minutes: data.vpn.mfa.lockMinutes });
    }
    vs.bad[fw.id] = bad;
    return fail("badCode");
  }
  return up(vs, world, fw, req.gateway, now, say);
}

function up(
  vs: VpnState,
  world: World,
  fw: Device,
  gateway: string,
  now: number,
  say: (key: string, vars?: Record<string, unknown>) => string,
): VpnResult {
  vs.bad[fw.id] = 0;
  vs.push = undefined;
  vs.nextConn = (vs.nextConn ?? 0) + 1;
  vs.conn = { id: vs.nextConn, fwId: fw.id, gateway, since: now };
  log(fw, now, `${fw.vpn?.username} connected, tunnel up`);
  const site = world.sites.find((s) => s.id === fw.siteId);
  return { ok: true, output: [say("connected", { gateway, site: site?.name })] };
}

/** Answer the push on your phone. */
export function approvePush(
  vs: VpnState,
  world: World,
  data: GameData,
  now: number,
  yes: boolean,
): VpnResult {
  const m = data.vpn.messages;
  const p = vs.push;
  if (!p) return { ok: false, output: ["No sign-in is waiting."] };
  const fw = world.devices.find((d) => d.id === p.fwId) as Device;
  const say = (key: string, vars: Record<string, unknown> = {}) =>
    fill(m[key] ?? key, (k) => vars[k]);
  vs.push = undefined;
  if (!yes) {
    log(fw, now, `push sign-in denied for ${fw.vpn?.username}`);
    return { ok: false, output: [say("pushDenied")] };
  }
  if (now > p.at + data.vpn.mfa.pushMinutes || !sslVpnUp(fw, netState(world, now))) {
    log(fw, now, `push sign-in timed out for ${fw.vpn?.username}`);
    return { ok: false, output: [say("pushExpired")] };
  }
  return up(vs, world, fw, p.gateway, now, say);
}

/**
 * The firewall you are connected through, while the tunnel holds. A tunnel that dropped stays
 * dropped: the firewall rebooted, its ISP went down, or the SSL VPN is off.
 */
export function vpnLink(vs: VpnState | undefined, world: World, now: number): Device | undefined {
  const c = vs?.conn;
  if (!c) return undefined;
  const fw = world.devices.find((d) => d.id === c.fwId);
  const isp = world.sites.find((s) => s.id === fw?.siteId)?.isp;
  if (!fw?.vpn || !isp || !sslVpnUp(fw, netState(world, now))) return undefined;
  if (bootTime(fw, now) > c.since || ispDownBetween(isp, c.since, now)) return undefined;
  return fw;
}

/** Forget a tunnel that dropped. Returns the line to tell the player, if it just did. */
export function settleVpn(vs: VpnState | undefined, world: World, data: GameData, now: number) {
  if (!vs?.conn || vpnLink(vs, world, now)) return undefined;
  const gateway = vs.conn.gateway;
  vs.conn = undefined;
  return fill(data.vpn.messages.dropped ?? "", (k) => (k === "gateway" ? gateway : ""));
}

export function upgradeApp(vs: VpnState, data: GameData, name: string): VpnResult {
  const app = data.vpn.apps.find((a) => a.name === name);
  if (!app) return { ok: false, output: [`No app ${name}.`] };
  if (vs.apps[app.brand] === app.latest)
    return { ok: false, output: [`${app.name} ${app.latest} is already the newest version.`] };
  vs.apps[app.brand] = app.latest;
  // Upgrading restarts the app, so any tunnel or sign-in it held drops.
  vs.conn = undefined;
  vs.push = undefined;
  return { ok: true, output: [`${app.name} updated to ${app.latest}.`] };
}

/** A PowerShell window on your own laptop. It only reaches client gear through the VPN. */
export interface LocalSession {
  id: string;
  kind: "local";
  /** No client device: this is your own laptop. */
  deviceId?: undefined;
  transcript: string[];
  closed: boolean;
  last?: { line: string; output: string[] };
  outputs?: { line: string; output: string[] }[];
}

const PROMPT = "PS C:\\Users\\tech> ";

export function openLocal(id: string): LocalSession {
  return {
    id,
    kind: "local",
    transcript: ["Windows PowerShell", "", PROMPT],
    closed: false,
  };
}

export interface LocalResult {
  output: string[];
  ssh?: { username: string; address: string };
}

/** Run one line on the laptop. */
export function runLocal(
  s: LocalSession,
  line: string,
  vs: VpnState | undefined,
  world: World,
  now: number,
): LocalResult {
  const last = s.transcript.length - 1;
  s.transcript[last] = `${s.transcript[last] ?? PROMPT}${line}`;
  const res = localExec(s, line, vs, world, now);
  s.transcript.push(...res.output);
  if (!s.closed) s.transcript.push(PROMPT);
  return res;
}

function localExec(
  s: LocalSession,
  line: string,
  vs: VpnState | undefined,
  world: World,
  now: number,
): LocalResult {
  const words = line.trim().split(/\s+/).filter(Boolean);
  const cmd = (words[0] ?? "").toLowerCase();
  const fw = vpnLink(vs, world, now);
  const ns = netState(world, now);
  switch (cmd) {
    case "":
      return { output: [] };
    case "help":
      return {
        output: [
          "Your laptop. Client networks are reachable only over a connected VPN.",
          "ping <ip>, ssh <user>@<ip>, hostname, exit",
        ],
      };
    case "hostname":
      return { output: ["MSP-LT-07"] };
    case "exit":
      s.closed = true;
      return { output: [] };
    case "ping": {
      const ip = words.filter((w) => !w.startsWith("-"))[1] ?? "";
      if (!isIp(ip))
        return {
          output: [`Ping request could not find host ${ip}. Please check the name and try again.`],
        };
      const ok = !!fw && vpnCanReach(world, fw, ip, ns);
      const head = ["", `Pinging ${ip} with 32 bytes of data:`];
      const tail = (n: number) => [
        "",
        `Ping statistics for ${ip}:`,
        `    Packets: Sent = 4, Received = ${n}, Lost = ${4 - n} (${(4 - n) * 25}% loss),`,
      ];
      if (!ok) return { output: [...head, ...Array(4).fill("Request timed out."), ...tail(0)] };
      return {
        output: [
          ...head,
          ...[0, 1, 2, 3].map(
            (n) => `Reply from ${ip}: bytes=32 time=${24 + (fnv1a(`${ip}${n}`) % 9)}ms TTL=254`,
          ),
          ...tail(4),
        ],
      };
    }
    case "ssh": {
      const m = (words[1] ?? "").match(/^([\w.-]+)@([\d.]+)$/);
      if (!m) return { output: ["usage: ssh user@ip"] };
      return { output: [], ssh: { username: m[1] as string, address: m[2] as string } };
    }
    default:
      return {
        output: [
          `${words[0]} : The term '${words[0]}' is not recognized as the name of a cmdlet, function, script file, or operable program.`,
        ],
      };
  }
}
