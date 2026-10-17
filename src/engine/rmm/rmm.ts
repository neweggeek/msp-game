import { uptimeText } from "../cli/views";
import type { Device, DeviceKind, World } from "../model/types";
import { canReach, dnsServers, resolveName } from "../net/reach";
import { type NetState, netState } from "../net/state";
import type { ScriptDef } from "../schema";
import { fnv1a } from "../util/hash";
import { isIp } from "../util/ip";

/** A Shinobi RMM background shell. Runs as SYSTEM on the agent, so the user does not see it. */
export interface RmmSession {
  id: string;
  kind: "rmm";
  deviceId: string;
  closed: boolean;
  transcript: string[];
  last?: { line: string; output: string[] };
}

export interface AgentRow {
  deviceId: string;
  hostname: string;
  kind: DeviceKind;
  siteId: string;
  siteName: string;
  user: string;
  ip: string;
  publicIp: string;
  online: boolean;
  os: string;
  uptime: string;
}

const AGENT_PROBE = "1.1.1.1";

function osOf(d: Device): string {
  return d.kind === "server" ? "Windows Server 2022" : "Windows 11 Pro 23H2";
}

/** Public IP as the RMM cloud sees it: the site's WAN address. */
export function publicIp(world: World, d: Device): string {
  return world.sites.find((s) => s.id === d.siteId)?.isp.wanIp ?? "";
}

export function agentOnline(world: World, d: Device, ns: NetState): boolean {
  return d.rmmAgent && ns.online.get(d.id) === true && canReach(world, d.id, AGENT_PROBE, ns);
}

export function agents(world: World, now: number): AgentRow[] {
  const ns = netState(world, now);
  return world.devices
    .filter((d) => d.rmmAgent)
    .map((d) => ({
      deviceId: d.id,
      hostname: d.hostname,
      kind: d.kind,
      siteId: d.siteId,
      siteName: world.sites.find((s) => s.id === d.siteId)?.name ?? d.siteId,
      user: d.user ?? "",
      ip: d.ip ?? "",
      publicIp: publicIp(world, d),
      online: agentOnline(world, d, ns),
      os: osOf(d),
      uptime: uptimeText(now - d.bootAt),
    }));
}

export function openRmm(id: string, world: World, deviceId: string): RmmSession {
  const s: RmmSession = { id, kind: "rmm", deviceId, closed: false, transcript: [] };
  const d = world.devices.find((x) => x.id === deviceId);
  s.transcript.push(
    `Shinobi RMM background shell on ${d?.hostname ?? deviceId}. Runs as SYSTEM.`,
    "",
    rmmPrompt(),
  );
  return s;
}

function rmmPrompt(): string {
  return "PS C:\\Windows\\system32> ";
}

export interface RmmLineResult {
  output: string[];
  /** The line asked to SSH somewhere; the game opens a device session for it. */
  ssh?: { username: string; address: string };
}

function adapterLines(world: World, d: Device, all: boolean): string[] {
  const site = world.sites.find((s) => s.id === d.siteId);
  const vlan = site?.vlans.find((v) => v.id === d.vlan);
  const prefix = Number(vlan?.subnet.split("/")[1] ?? 24);
  const mask = prefix === 24 ? "255.255.255.0" : "255.255.0.0";
  const out = ["", "Windows IP Configuration", ""];
  if (all)
    out.push(
      `   Host Name . . . . . . . . . . . . : ${d.hostname}`,
      `   Primary Dns Suffix  . . . . . . . : ${world.client.domain}`,
      "",
    );
  out.push("Ethernet adapter Ethernet:", "");
  if (all) {
    out.push(
      `   Physical Address. . . . . . . . . : ${d.mac.toUpperCase().replace(/:/g, "-")}`,
      `   DHCP Enabled. . . . . . . . . . . : ${d.kind === "server" ? "No" : "Yes"}`,
    );
  }
  out.push(
    `   IPv4 Address. . . . . . . . . . . : ${d.ip ?? "169.254.10.4"}`,
    `   Subnet Mask . . . . . . . . . . . : ${mask}`,
    `   Default Gateway . . . . . . . . . : ${d.gateway ?? ""}`,
  );
  if (all) {
    const dns = dnsServers(world, d);
    out.push(
      `   DNS Servers . . . . . . . . . . . : ${dns[0] ?? ""}`,
      ...dns.slice(1).map((x) => `                                       ${x}`),
    );
  }
  return out;
}

function ping(world: World, d: Device, target: string, ns: NetState): string[] {
  let ip = target;
  if (!isIp(target)) {
    const r = resolveName(world, d, target, ns);
    if (!r.ok)
      return [`Ping request could not find host ${target}. Please check the name and try again.`];
    ip = r.ip;
  }
  const ok = canReach(world, d.id, ip, ns);
  const head = `Pinging ${isIp(target) ? ip : `${target} [${ip}]`} with 32 bytes of data:`;
  if (!ok)
    return [
      "",
      head,
      ...Array(4).fill("Request timed out."),
      "",
      `Ping statistics for ${ip}:`,
      "    Packets: Sent = 4, Received = 0, Lost = 4 (100% loss),",
    ];
  const ms = (n: number) =>
    1 + (fnv1a(`${ip}${n}`) % 30 > 25 ? 3 : 0) + (inLan(world, d, ip) ? 0 : 17);
  return [
    "",
    head,
    ...[0, 1, 2, 3].map(
      (n) => `Reply from ${ip}: bytes=32 time=${ms(n)}ms TTL=${inLan(world, d, ip) ? 128 : 117}`,
    ),
    "",
    `Ping statistics for ${ip}:`,
    "    Packets: Sent = 4, Received = 4, Lost = 0 (0% loss),",
  ];
}

function inLan(world: World, d: Device, ip: string): boolean {
  return ip.split(".").slice(0, 2).join(".") === (d.ip ?? "").split(".").slice(0, 2).join(".");
}

function nslookup(world: World, d: Device, name: string, ns: NetState): string[] {
  const server = dnsServers(world, d)[0] ?? "";
  const r = resolveName(world, d, name, ns);
  const serverName =
    world.devices.find((x) => x.ip === server)?.hostname ??
    (server.startsWith("8.8.") ? "dns.google" : "UnKnown");
  const head = [`Server:  ${serverName}`, `Address:  ${server}`, ""];
  if (r.ok)
    return [
      ...head,
      server.startsWith("8.8.") || !world.devices.some((x) => x.ip === r.ip)
        ? "Non-authoritative answer:"
        : "",
      `Name:    ${name}`,
      `Address:  ${r.ip}`,
    ].filter((l, i) => l !== "" || i < 3);
  if (r.reason === "timeout")
    return [
      "DNS request timed out.",
      "    timeout was 2 seconds.",
      `*** Request to ${server} timed-out`,
    ];
  return [...head, `*** ${serverName} can't find ${name}: Non-existent domain`];
}

const help = [
  "Commands: hostname, whoami, ipconfig [/all], ping <host>, nslookup <name>, tracert <host>,",
  "Get-NetAdapter, powercfg /query, powercfg /lastwake, systeminfo, net use, ssh <user>@<ip>, exit",
];

/** Run one line in the background shell. Read only, apart from ssh which opens a device session. */
export function runRmmLine(s: RmmSession, line: string, world: World, now: number): RmmLineResult {
  const d = world.devices.find((x) => x.id === s.deviceId) as Device;
  const last = s.transcript.length - 1;
  s.transcript[last] = `${s.transcript[last] ?? rmmPrompt()}${line}`;
  const res = rmmExec(s, line, world, d, now);
  s.transcript.push(...res.output);
  if (!s.closed) s.transcript.push(rmmPrompt());
  return res;
}

function rmmExec(s: RmmSession, line: string, world: World, d: Device, now: number): RmmLineResult {
  const ns = netState(world, now);
  if (!agentOnline(world, d, ns)) {
    s.closed = true;
    return { output: ["Agent went offline. Session closed."] };
  }
  const words = line.trim().split(/\s+/).filter(Boolean);
  const cmd = (words[0] ?? "").toLowerCase();
  const arg = words.slice(1).join(" ");
  const out = (output: string[]): RmmLineResult => ({ output });
  switch (cmd) {
    case "":
      return out([]);
    case "help":
    case "?":
      return out(help);
    case "hostname":
      return out([d.hostname]);
    case "whoami":
      return out(["nt authority\\system"]);
    case "ipconfig":
      return out(adapterLines(world, d, arg.toLowerCase() === "/all"));
    case "ping":
      return arg ? out(ping(world, d, words[1] as string, ns)) : out(["Usage: ping <host>"]);
    case "nslookup":
      return arg
        ? out(nslookup(world, d, words[1] as string, ns))
        : out(["Usage: nslookup <name>"]);
    case "tracert": {
      const target = words[1] ?? "";
      if (!target) return out(["Usage: tracert <host>"]);
      let ip = target;
      if (!isIp(target)) {
        const r = resolveName(world, d, target, ns);
        if (!r.ok) return out([`Unable to resolve target system name ${target}.`]);
        ip = r.ip;
      }
      const ok = canReach(world, d.id, ip, ns);
      const hops =
        inLan(world, d, ip) &&
        d.gateway &&
        !ip.startsWith(d.ip?.split(".").slice(0, 3).join(".") ?? "x")
          ? [d.gateway, ip]
          : inLan(world, d, ip)
            ? [ip]
            : [
                d.gateway ?? "*",
                world.sites.find((x) => x.id === d.siteId)?.isp.gateway ?? "*",
                "72.14.200.9",
                ip,
              ];
      return out([
        "",
        `Tracing route to ${ip} over a maximum of 30 hops`,
        "",
        ...hops.map((h, i) =>
          ok || i < hops.length - 1
            ? `  ${i + 1}    ${1 + i * 3} ms    ${1 + i * 3} ms    ${2 + i * 3} ms  ${h}`
            : `  ${i + 1}     *        *        *     Request timed out.`,
        ),
        "",
        "Trace complete.",
      ]);
    }
    case "get-netadapter":
      return out([
        "",
        "Name       InterfaceDescription            Status  MacAddress         LinkSpeed",
        "----       --------------------            ------  ----------         ---------",
        `Ethernet   Intel(R) Ethernet Connection    Up      ${d.mac.toUpperCase().replace(/:/g, "-")}  1 Gbps`,
      ]);
    case "powercfg": {
      const a = arg.toLowerCase();
      if (a.startsWith("/lastwake")) {
        return out(
          d.sleep
            ? [
                "Wake History Count - 1",
                "Wake History [0]",
                "  Wake Source Count - 1",
                "  Wake Source [0]",
                "    Type: Wake Timer",
                "    Owner: Windows Update Orchestrator",
              ]
            : ["Wake History Count - 0"],
        );
      }
      if (a.startsWith("/query") || a.startsWith("/q")) {
        const sleepMin = d.sleep ? 30 : 0;
        return out([
          "Power Scheme GUID: 381b4222-f694-41f0-9685-ff5bb260df2e  (Balanced)",
          "  Subgroup: Sleep",
          "    Power Setting: Sleep after",
          `      Current AC Power Setting Index: 0x${(sleepMin * 60).toString(16).padStart(8, "0")}  (${sleepMin === 0 ? "Never" : `${sleepMin} minutes`})`,
          "    Power Setting: Hibernate after",
          "      Current AC Power Setting Index: 0x00000000  (Never)",
        ]);
      }
      return out(["Usage: powercfg /query | /lastwake"]);
    }
    case "systeminfo":
      return out([
        "",
        `Host Name:                 ${d.hostname}`,
        `OS Name:                   Microsoft Windows ${osOf(d).replace("Windows ", "")}`,
        `System Model:              ${d.model}`,
        `System Up Time:            ${uptimeText(now - d.bootAt)}`,
        `Domain:                    ${world.client.domain}`,
      ]);
    case "net": {
      if (words[1]?.toLowerCase() !== "use") return out(["The syntax of this command is: NET USE"]);
      const server = world.devices.find((x) => x.kind === "server");
      if (!server || d.kind === "server") return out(["There are no entries in the list."]);
      const r = resolveName(world, d, server.hostname, ns);
      const ok = r.ok && canReach(world, d.id, r.ip, ns);
      return out([
        "",
        "Status       Local     Remote",
        "-------------------------------------------------",
        `${(ok ? "OK" : "Unavailable").padEnd(12)} S:        \\\\${server.hostname}\\Shared`,
      ]);
    }
    case "ssh": {
      const m = arg.match(/^([\w.-]+)@([\d.]+)$/);
      if (!m) return out(["usage: ssh user@host"]);
      return { output: [], ssh: { username: m[1] as string, address: m[2] as string } };
    }
    case "exit":
      s.closed = true;
      return out(["Session closed."]);
    default:
      return out([
        `${words[0]} : The term '${words[0]}' is not recognized as the name of a cmdlet, function, script file, or operable program.`,
      ]);
  }
}

/** Run a library script on an agent. Returns the output the RMM job log shows. */
export function runScript(world: World, d: Device, script: ScriptDef): string[] {
  switch (script.effect) {
    case "reset-dns":
      d.dns = undefined;
      return [
        `Job "${script.name}" on ${d.hostname}: completed.`,
        "DNS servers on Ethernet set to obtain automatically.",
      ];
    case "no-sleep":
      d.sleep = undefined;
      return [
        `Job "${script.name}" on ${d.hostname}: completed.`,
        "Sleep after: Never. Hibernate after: Never.",
      ];
    default:
      return [`Job "${script.name}" on ${d.hostname}: completed.`];
  }
}

export { AGENT_PROBE };
