import { applyRunning } from "../cli/session";
import { formatTime } from "../clock/clock";
import type { GameData } from "../data";
import type { CaseCall, CaseInstance, Contact, Device, World } from "../model/types";
import { loopLinks, netState, siteFirewall } from "../net/state";
import { wanIp } from "../net/vpn";
import { Rng } from "../rng/rng";
import { caseFixed } from "../tickets/checks";
import { fnv1a } from "../util/hash";
import { fill } from "../util/template";

/** Someone you can phone: a contact from the docs, or the user named on a ticket. */
export interface Person {
  id: string;
  name: string;
  /** Docs contacts know the office; a user on a ticket only knows their own desk. */
  insider: boolean;
  competence: number;
  patience: number;
  availability: Contact["availability"];
  /** An ISP support line: the site id it serves. */
  isp?: string;
  /** One of your own coworkers. */
  team?: boolean;
}

export interface PhoneCall {
  id: string;
  kind: "call";
  person: string;
  ticket?: string;
  /** Questions left before they have to go. */
  asksLeft: number;
  transcript: string[];
  closed: boolean;
  answered: boolean;
  /** ISP calls: minutes on hold, and whether the account and PIN checked out. */
  hold?: number;
  verified?: boolean;
  agent?: string;
}

/** The docs contacts, plus the user on a ticket when they are not one of them. */
export function people(world: World, ticketContact?: string): Person[] {
  const out: Person[] = world.client.contacts.map((c) => ({
    id: c.id,
    name: c.name,
    insider: true,
    competence: c.competence,
    patience: c.patience,
    availability: c.availability,
  }));
  if (ticketContact && !out.some((p) => p.name === ticketContact)) {
    // Traits for a user nobody wrote down come from their name, so every replay agrees.
    const h = fnv1a(`${world.seed}:${ticketContact}`);
    out.push({
      id: `user:${ticketContact}`,
      name: ticketContact,
      insider: false,
      competence: (h % 100) / 100,
      patience: ((h >>> 8) % 100) / 100,
      availability: "usually",
    });
  }
  return out;
}

/** Your coworkers. Their names match the docs history and access log. */
export function teamLines(data: GameData): Person[] {
  return data.calls.team.people.map((p) => ({
    id: `team:${p.id}`,
    name: `${p.name} (${p.role})`,
    insider: false,
    competence: 1,
    patience: 0.5,
    availability: "usually",
    team: true,
  }));
}

/** One support line per site, from the docs. The ISP is open all hours. */
export function ispLines(world: World): Person[] {
  return world.docs.sites.map((s) => ({
    id: `isp:${s.siteId}`,
    name: `${s.isp.name} support`,
    insider: false,
    competence: 0.9,
    patience: 1,
    availability: "usually",
    isp: s.siteId,
  }));
}

export function findPerson(world: World, id: string, data?: GameData): Person | undefined {
  if (id.startsWith("team:")) return data ? teamLines(data).find((p) => p.id === id) : undefined;
  if (id.startsWith("isp:")) return ispLines(world).find((p) => p.id === id);
  const user = id.startsWith("user:") ? id.slice(5) : undefined;
  return people(world, user).find((p) => p.id === id);
}

export interface CallCtx {
  world: World;
  data: GameData;
  now: number;
  /** Client business hours right now. */
  open: boolean;
  /** MSP hours right now, when coworkers pick up. */
  mspOpen: boolean;
  /** Which call this is, for its own random stream. */
  serial: number;
  /** Facts already heard from anyone at this client, by ask id. */
  heard: string[];
}

const say = (data: GameData, key: string, vars: Record<string, string>) =>
  fill(data.calls.lines[key] ?? key, (k) => vars[k] ?? "");
const teamSay = (data: GameData, key: string, vars: Record<string, string>) =>
  fill(data.calls.team.lines[key] ?? key, (k) => vars[k] ?? "");
const ispSay = (data: GameData, key: string, vars: Record<string, string>) =>
  fill(data.calls.isp.lines[key] ?? key, (k) => vars[k] ?? "");

/** Dial. Returns the call, answered or not. */
export function dial(ctx: CallCtx, id: string, person: Person, ticket?: string): PhoneCall {
  const { data } = ctx;
  const rng = new Rng(`${ctx.world.seed}:call:${ctx.serial}`);
  const call: PhoneCall = {
    id,
    kind: "call",
    person: person.id,
    asksLeft: data.calls.patience.base + Math.round(person.patience * data.calls.patience.perPoint),
    transcript: [],
    closed: false,
    answered: false,
  };
  if (ticket) call.ticket = ticket;
  if (person.isp) {
    // Agents answer whatever the hour, after the hold music.
    const isp = data.calls.isp;
    const site = ctx.world.sites.find((s) => s.id === person.isp);
    call.hold = rng.int(isp.holdMinutes[0], isp.holdMinutes[1]);
    call.asksLeft = isp.patience;
    call.answered = true;
    call.agent = rng.pick(isp.agents);
    call.transcript.push(
      ispSay(data, "hold", { hold: String(call.hold) }),
      ispSay(data, "hello", { name: call.agent, isp: site?.isp.name ?? "" }),
    );
    return call;
  }
  if (person.team) {
    const name = person.name.split(" (")[0] ?? person.name;
    call.asksLeft = data.calls.patience.base;
    call.answered = ctx.mspOpen;
    call.closed = !ctx.mspOpen;
    call.transcript.push(teamSay(data, ctx.mspOpen ? "hello" : "closed", { name }));
    return call;
  }
  const v = { name: person.name };
  if (!ctx.open) {
    call.transcript.push(say(data, "closed", v));
    call.closed = true;
  } else if (rng.next() >= data.calls.answerChance[person.availability]) {
    call.transcript.push(say(data, "noAnswer", v));
    call.closed = true;
  } else {
    call.answered = true;
    call.transcript.push(say(data, "hello", v));
  }
  return call;
}

/** Remote hands tasks unlocked by what this client has told you. */
export function unlockedFixes(world: World, heard: string[]): CaseCall["fixes"] {
  return world.cases
    .flatMap((x) => x.call?.fixes ?? [])
    .filter((f) => heard.includes(f.unlockedBy));
}

export interface AskResult {
  lines: string[];
  /** A fact id this answer gave, so its fixes unlock. */
  fact?: string;
  /** The test answer, for the ticket. */
  test?: { fixed: boolean; ok: boolean };
  /** The device that really got power-cycled, which may not be the one you named. */
  cycled?: string;
}

/**
 * One question or task. `device` is a device id from the docs. `collateral` names what the
 * client would notice is broken, for a test.
 */
export function ask(
  ctx: CallCtx,
  call: PhoneCall,
  person: Person,
  askId: string,
  opts: { device?: string; caseInst?: CaseInstance; collateral?: () => string },
): AskResult | { error: string } {
  const { world, data, now } = ctx;
  if (call.closed) return { error: "The call has ended." };
  if (person.isp) return ispAsk(ctx, call, person.isp, askId);
  if (person.team) return teamAsk(ctx, call, person, askId, opts.device);
  const fix = ctx.world.cases
    .flatMap((c) => (c.call?.fixes ?? []).map((f) => ({ f, c })))
    .find((x) => x.f.id === askId && ctx.heard.includes(x.f.unlockedBy));
  const def = data.calls.asks.find((a) => a.id === askId);
  if (!def && !fix) return { error: "Pick something to ask." };
  const rng = new Rng(`${world.seed}:call:${ctx.serial}:${call.transcript.length}`);
  const v: Record<string, string> = { name: person.name };
  // Low competence: a wrong answer or the wrong box, some of the time.
  const slip = () => rng.next() < (1 - person.competence) * 0.5;
  const out: AskResult = { lines: [] };

  if (fix) {
    out.lines.push(`You: ${fix.f.label}`);
    if (!slip()) {
      for (const role of fix.f.roles) {
        const d = world.devices.find((x) => x.id === fix.c.bindings[role]);
        if (fix.f.effect === "end-power-cut" && d?.powerCut && d.powerCut.until === undefined)
          d.powerCut.until = now;
        if (fix.f.effect === "unplug-loop" && d) unplugLoops(world, d);
      }
    }
    // They say done either way. Check their work.
    out.lines.push(say(data, "fixDone", v));
  } else if (def) {
    const dev = opts.device ? world.devices.find((d) => d.id === opts.device) : undefined;
    const docName = opts.device
      ? (world.docs.devices.find((d) => d.deviceId === opts.device)?.hostname ?? dev?.hostname)
      : undefined;
    v.device = docName ?? "it";
    if (def.device && !opts.device) return { error: "Pick a device." };
    if (def.ticket && !opts.caseInst && !call.ticket)
      return { error: "Call from a ticket to test it." };
    out.lines.push(`You: ${fill(def.label, (k) => v[k] ?? "")}`);
    const ns = netState(world, now);
    const found = !!dev;
    switch (def.kind) {
      case "fact": {
        // Two cases can know the same fact. The ticket the call is about wins.
        const known = person.insider
          ? (opts.caseInst?.call?.facts[def.id] ??
            world.cases.find((c) => c.call?.facts[def.id])?.call?.facts[def.id])
          : undefined;
        out.lines.push(`${person.name}: ${known ?? def.default ?? "I'm not sure."}`);
        if (known) out.fact = def.id;
        break;
      }
      case "isp-bill": {
        if (!person.insider) {
          out.lines.push(say(data, "ispBillNone", v));
          break;
        }
        // One bill per site. A misread digit on one of them, some of the time.
        const miss = slip() ? rng.int(0, world.sites.length - 1) : -1;
        world.sites.forEach((s, i) => {
          const pin =
            i === miss ? s.isp.pin.replace(/\d$/, (d) => String((Number(d) + 1) % 10)) : s.isp.pin;
          out.lines.push(say(data, "ispBill", { ...v, site: s.name, account: s.isp.account, pin }));
        });
        break;
      }
      case "device-password":
      case "enable-account": {
        // The main contact keeps the client's own admin logins. Nobody else has them.
        const main = world.client.contacts[0];
        const vars = { ...v, main: main?.name ?? "the owner" };
        if (!dev?.credentials) {
          out.lines.push(say(data, "notFound", v));
          break;
        }
        if (person.id !== main?.id) {
          out.lines.push(
            say(
              data,
              def.kind === "device-password" ? "devicePasswordNone" : "accountNotMine",
              vars,
            ),
          );
          break;
        }
        if (def.kind === "device-password") {
          const pw = dev.credentials.password;
          const read = slip() && pw ? `${pw.slice(0, -1)}${pw.endsWith("1") ? "l" : "1"}` : pw;
          out.lines.push(say(data, "devicePassword", { ...vars, password: read || "(blank)" }));
        } else {
          if (!slip()) dev.credentials.disabled = false;
          out.lines.push(say(data, "accountEnabled", vars));
        }
        break;
      }
      case "lights": {
        if (!dev || !found) {
          out.lines.push(say(data, "notFound", v));
          break;
        }
        const truth = !ns.powered.get(dev.id)
          ? "lightsDark"
          : ns.storm.get(dev.id)
            ? "lightsStorm"
            : ns.online.get(dev.id)
              ? "lightsOk"
              : "lightsLink";
        const keys = ["lightsOk", "lightsLink", "lightsDark"];
        const key = slip() ? rng.pick(keys.filter((k) => k !== truth)) : truth;
        out.lines.push(say(data, key, v));
        break;
      }
      case "power-source": {
        if (!dev || !found) {
          out.lines.push(say(data, "notFound", v));
          break;
        }
        if (slip()) {
          out.lines.push(say(data, "unsure", v));
          break;
        }
        const c = dev.powerCut;
        const fixedNow = c?.until !== undefined && c.until <= now;
        if (c) {
          out.lines.push(`${person.name}: ${fixedNow ? c.fixedSource : c.source}`);
          if (!fixedNow) out.fact = `power:${dev.id}`;
        } else out.lines.push(say(data, dev.poe ? "poeOnly" : "wall", v));
        break;
      }
      case "power-cycle": {
        if (!dev || !found) {
          out.lines.push(say(data, "notFound", v));
          break;
        }
        // The wrong box in the same room, if there is one.
        const near = world.devices.filter(
          (d) => d.roomId === dev.roomId && d.id !== dev.id && d.kind !== "pc",
        );
        const hit = slip() && near.length > 0 ? rng.pick(near) : dev;
        // Unplugged near the end of the ask, so it is still booting when they hang up.
        powerCycle(data, hit, now + def.minutes);
        out.cycled = hit.id;
        out.lines.push(say(data, "cycled", v));
        break;
      }
      case "test": {
        const c = opts.caseInst;
        if (!c) {
          out.lines.push(say(data, "testBroken", v));
          out.test = { fixed: false, ok: false };
          break;
        }
        const fixed = caseFixed(world, c, now);
        const down = fixed ? (opts.collateral?.() ?? "") : "";
        v.down = down;
        const text = !fixed
          ? (c.call?.testBroken ?? say(data, "testBroken", v))
          : down
            ? say(data, "testCollateral", v)
            : (c.call?.testFixed ?? say(data, "testFixed", v));
        out.lines.push(text.startsWith(`${person.name}:`) ? text : `${person.name}: ${text}`);
        out.test = { fixed, ok: fixed && !down };
        break;
      }
    }
  }
  call.transcript.push(...out.lines);
  call.asksLeft--;
  if (call.asksLeft <= 0) {
    call.transcript.push(say(data, "tired", v));
    call.closed = true;
  }
  return out;
}

/** Pull one end of every cable that runs from the switch back into itself. */
function unplugLoops(world: World, sw: Device): void {
  const loops = loopLinks(world, sw.id);
  for (const l of loops) {
    for (const end of [l.a, l.b]) {
      const port = sw.ports.find((p) => p.name === end.port);
      if (port) port.link = undefined;
    }
  }
  world.links = world.links.filter((l) => !loops.includes(l));
}

/** Off for a few minutes, then up on its saved config. Unsaved changes are gone. */
export function powerCycle(data: GameData, dev: Device, now: number): void {
  dev.rebootUntil = now + data.calls.rebootMinutes;
  if (dev.startup) {
    dev.running = structuredClone(dev.startup);
    applyRunning(dev);
  }
}

/** The ISP support line. Nothing about the account until the account number and PIN match. */
function ispAsk(
  ctx: CallCtx,
  call: PhoneCall,
  siteId: string,
  askId: string,
): AskResult | { error: string } {
  const { world, data, now } = ctx;
  const def = data.calls.isp.asks.find((a) => a.id === askId);
  if (!def) return { error: "Pick something to ask." };
  const site = world.sites.find((s) => s.id === siteId);
  const doc = world.docs.sites.find((s) => s.siteId === siteId);
  if (!site || !doc) return { error: "No such site." };
  const v: Record<string, string> = { name: call.agent ?? "Agent", site: doc.name };
  const out: AskResult = { lines: [] };
  if (def.kind === "isp-verify") {
    if (!doc.isp.pin) out.lines.push(ispSay(data, "noPin", v));
    else out.lines.push(ispSay(data, "you", { account: doc.isp.account, pin: doc.isp.pin }));
    call.verified = doc.isp.account === site.isp.account && doc.isp.pin === site.isp.pin;
    out.lines.push(
      ispSay(data, call.verified ? "verified" : doc.isp.pin ? "badPin" : "noPinReply", v),
    );
  } else {
    out.lines.push(`You: ${fill(def.label, (k) => v[k] ?? "")}`);
    if (!call.verified) out.lines.push(ispSay(data, "needVerify", v));
    else if (def.kind === "isp-status") {
      const ns = netState(world, now);
      const o = site.isp.outage;
      const fw = siteFirewall(world, siteId);
      if (site.isp.rebootUntil !== undefined && now < site.isp.rebootUntil)
        out.lines.push(ispSay(data, "statusRebooting", v));
      else if (ns.ispDown.get(siteId) && o)
        out.lines.push(
          ispSay(data, "statusOutage", { ...v, since: formatTime(data.calendar, o.since) }),
        );
      else if (!fw || !ns.online.get(fw.id) || !wanIp(fw))
        out.lines.push(ispSay(data, "statusNothing", v));
      else out.lines.push(ispSay(data, "statusClean", v));
    } else {
      // The modem goes dark near the end of the ask and comes back on a clean config.
      const back = now + def.minutes + data.calls.isp.rebootMinutes;
      site.isp.rebootUntil = back;
      const o = site.isp.outage;
      if (o && o.until === undefined && now >= o.since) o.until = back;
      out.lines.push(
        ispSay(data, "reboot", { ...v, minutes: String(data.calls.isp.rebootMinutes) }),
      );
    }
  }
  call.transcript.push(...out.lines);
  call.asksLeft--;
  if (call.asksLeft <= 0) {
    call.transcript.push(ispSay(data, "tired", v));
    call.closed = true;
  }
  return out;
}

/** A coworker. They know what they did to the vault, and nothing else. */
function teamAsk(
  ctx: CallCtx,
  call: PhoneCall,
  person: Person,
  askId: string,
  deviceId?: string,
): AskResult | { error: string } {
  const { world, data } = ctx;
  const def = data.calls.team.asks.find((a) => a.id === askId);
  if (!def) return { error: "Pick something to ask." };
  if (!deviceId) return { error: "Pick a device." };
  const dev = world.devices.find((d) => d.id === deviceId);
  const docName = world.docs.devices.find((d) => d.deviceId === deviceId)?.hostname;
  const v: Record<string, string> = {
    name: person.name.split(" (")[0] ?? person.name,
    device: docName ?? dev?.hostname ?? "it",
  };
  const out: AskResult = { lines: [`You: ${fill(def.label, (k) => v[k] ?? "")}`] };
  const unsaved = world.docs.unsaved.find((u) => u.deviceId === deviceId && u.who === person.name);
  const typo = world.docs.history.some(
    (h) => h.entry === `vault:${deviceId}` && h.field === "password" && h.by === person.name,
  );
  if (unsaved && dev?.credentials) {
    out.lines.push(teamSay(data, "unsaved", { ...v, password: dev.credentials.password }));
    // They fix the vault entry while you wait.
    const cred = world.docs.credentials.find((c) => c.deviceId === deviceId);
    if (cred) cred.password = dev.credentials.password;
    world.docs.unsaved = world.docs.unsaved.filter((u) => u !== unsaved);
  } else if (typo) out.lines.push(teamSay(data, "typo", v));
  else out.lines.push(teamSay(data, "notMe", v));
  call.transcript.push(...out.lines);
  call.asksLeft--;
  if (call.asksLeft <= 0) {
    call.transcript.push(teamSay(data, "tired", v));
    call.closed = true;
  }
  return out;
}
