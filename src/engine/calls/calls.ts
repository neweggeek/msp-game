import { applyRunning } from "../cli/session";
import type { GameData } from "../data";
import type { CaseCall, CaseInstance, Contact, Device, World } from "../model/types";
import { netState } from "../net/state";
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

export function findPerson(world: World, id: string): Person | undefined {
  const user = id.startsWith("user:") ? id.slice(5) : undefined;
  return people(world, user).find((p) => p.id === id);
}

export interface CallCtx {
  world: World;
  data: GameData;
  now: number;
  /** Client business hours right now. */
  open: boolean;
  /** Which call this is, for its own random stream. */
  serial: number;
  /** Facts already heard from anyone at this client, by ask id. */
  heard: string[];
}

const say = (data: GameData, key: string, vars: Record<string, string>) =>
  fill(data.calls.lines[key] ?? key, (k) => vars[k] ?? "");

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
        const known = person.insider
          ? world.cases.find((c) => c.call?.facts[def.id])?.call?.facts[def.id]
          : undefined;
        out.lines.push(`${person.name}: ${known ?? def.default ?? "I'm not sure."}`);
        if (known) out.fact = def.id;
        break;
      }
      case "lights": {
        if (!dev || !found) {
          out.lines.push(say(data, "notFound", v));
          break;
        }
        const truth = !ns.powered.get(dev.id)
          ? "lightsDark"
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
        if (c)
          out.lines.push(
            `${person.name}: ${c.until !== undefined && c.until <= now ? c.fixedSource : c.source}`,
          );
        else out.lines.push(say(data, dev.poe ? "poeOnly" : "wall", v));
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

/** Off for a few minutes, then up on its saved config. Unsaved changes are gone. */
export function powerCycle(data: GameData, dev: Device, now: number): void {
  dev.rebootUntil = now + data.calls.rebootMinutes;
  if (dev.startup) {
    dev.running = structuredClone(dev.startup);
    applyRunning(dev);
  }
}
