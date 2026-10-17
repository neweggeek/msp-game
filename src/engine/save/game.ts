import { type PhoneCall, ask, dial, findPerson } from "../calls/calls";
import { type CliContext, type CliSession, openSession, runLine } from "../cli/session";
import {
  type ClockState,
  addBusinessMinutes,
  advance,
  dayOfWeek,
  formatTime,
  minuteOfDay,
  newClock,
  schedule,
} from "../clock/clock";
import type { GameData } from "../data";
import { GENERATOR_VERSION, generate } from "../gen";
import { DEVICE_KINDS, type DeviceKind, type Priority, type World } from "../model/types";
import { ovikView } from "../monitor/ovik";
import { canManage, resolveTarget } from "../net/reach";
import { netState } from "../net/state";
import { type RmmSession, agentOnline, openRmm, runRmmLine, runScript } from "../rmm/rmm";
import { caseFixed } from "../tickets/checks";
import {
  closeBlockers,
  handoffNotes,
  plainResolutionNotes,
  resolutionNotes,
} from "../tickets/desk";
import {
  type TicketBook,
  addNote,
  createTicket,
  find,
  flagP1,
  onTicketTimer,
  setPriority,
  setStatus,
} from "../tickets/tickets";
import { isIp } from "../util/ip";
import { fill } from "../util/template";

export const SAVE_VERSION = 2;
export const SNAPSHOT_EVERY = 50;

/** Everything the player can do. The log of these, plus the seed, is the save. */
export type Action =
  | { t: "advance"; minutes: number }
  | { t: "cli-open"; device: string }
  | { t: "cli"; session: string; line: string }
  | { t: "rmm-open"; device: string }
  | { t: "rmm"; session: string; line: string }
  | { t: "rmm-script"; device: string; script: string }
  | { t: "consent-request"; device: string }
  | { t: "session-close"; session: string }
  | { t: "ticket-open"; ticket: string }
  | { t: "ticket-status"; ticket: string; status: string }
  | { t: "ticket-priority"; ticket: string; priority: Priority }
  | { t: "ticket-flag-p1"; ticket: string; reason: string }
  | { t: "ticket-note"; ticket: string; text: string }
  | {
      t: "handoff";
      ticket: string;
      handoff: string;
      note: number;
      detail: string;
      askClose?: boolean;
    }
  | { t: "attach-proof"; ticket: string; source: string }
  | { t: "resolve"; ticket: string; note: number }
  | { t: "send-back"; ticket: string; reason: string }
  | { t: "doc-edit"; target: string; field: string; value: string }
  | { t: "doc-add"; site: string; hostname: string; ip: string; kind: DeviceKind }
  | { t: "vault-view"; device: string }
  | { t: "call"; person: string; ticket?: string }
  | { t: "call-ask"; call: string; ask: string; device?: string }
  | { t: "call-end"; call: string };

export interface GameEvent {
  at: number;
  text: string;
}

export interface ScoreEntry {
  at: number;
  points: number;
  reason: string;
  ticketId?: string;
}

export interface CalendarEntry {
  at: number;
  ticketId: string;
  title: string;
}

export type TermSession = CliSession | RmmSession;

export interface GameState {
  saveVersion: number;
  generatorVersion: number;
  seed: string;
  scenario?: string;
  caseId?: string;
  world: World;
  clock: ClockState;
  book: TicketBook;
  sessions: Record<string, TermSession>;
  nextSession: number;
  /** Device id -> minute the user said yes. */
  consent: Record<string, number>;
  score: ScoreEntry[];
  calendar: CalendarEntry[];
  /** Doc fields already credited, "device:<id>:ip". */
  docFixes: string[];
  /** Each edited field's value before your first edit, keyed like docFixes. */
  edits?: Record<string, string>;
  events: GameEvent[];
  /** Devices up when the shift started. One that goes down later and is not asleep is your outage. */
  baselineUp?: string[];
  /** Devices already charged as collateral, so each outage costs once. */
  collateral?: string[];
  /** Phone calls, by id. */
  calls?: Record<string, PhoneCall>;
  /** Fact asks a contact has answered with something real, so their fixes stay on offer. */
  heard?: string[];
  /** "contact-id:day" for direct calls a scheduled-only client did not want. */
  unwantedCalls?: string[];
  log: Action[];
  snapshot?: { at: number; state: string };
}

export interface ActionResult {
  ok: boolean;
  error?: string;
  output?: string[];
  session?: string;
}

export interface NewGameOptions {
  scenario?: string;
  caseId?: string;
}

export function newGame(
  seed: string,
  data: GameData,
  opts: NewGameOptions | string = {},
): GameState {
  const o = typeof opts === "string" ? { caseId: opts } : opts;
  const world = generate(seed, data, o);
  const clock = newClock(data.calendar.startMinute);
  const book: TicketBook = { tickets: [], nextNumber: 1001 };
  const contact = world.client.contacts[0]?.name;
  for (const c of world.cases) {
    const user = c.bindings[c.primary]
      ? world.devices.find((d) => d.id === c.bindings[c.primary])?.user
      : undefined;
    createTicket(book, clock, data, {
      clientId: world.client.id,
      title: c.ticketTitle,
      body: c.ticketBody,
      priority: c.priority,
      origin: c.origin,
      caseId: c.caseId,
      contact: c.origin === "client" ? (user ?? contact) : undefined,
      history: c.ticketHistory.map((h) => ({ at: h.at, by: h.by, text: h.text })),
    });
  }
  for (const x of world.extraTickets) {
    createTicket(book, clock, data, {
      clientId: world.client.id,
      title: x.title,
      body: x.body,
      priority: x.priority,
      origin: x.origin,
      extraId: x.id,
      contact: x.origin === "client" ? contact : undefined,
    });
  }
  const ns = netState(world, clock.now);
  const state: GameState = {
    saveVersion: SAVE_VERSION,
    generatorVersion: GENERATOR_VERSION,
    seed,
    world,
    clock,
    book,
    sessions: {},
    nextSession: 1,
    consent: {},
    score: [],
    calendar: [],
    docFixes: [],
    events: [],
    // Gear a fault added (the new cameras) is the cause, so shedding it is fair game.
    baselineUp: world.devices
      .filter((d) => ns.online.get(d.id) && !ns.asleep.get(d.id) && !d.addedBy)
      .map((d) => d.id),
    collateral: [],
    log: [],
  };
  if (o.scenario) state.scenario = o.scenario;
  if (o.caseId) state.caseId = o.caseId;
  return state;
}

function points(
  state: GameState,
  data: GameData,
  key: string,
  reason: string,
  ticketId?: string,
): void {
  const p = data.handoffs.scoring[key] ?? 0;
  const e: ScoreEntry = { at: state.clock.now, points: p, reason };
  if (ticketId) e.ticketId = ticketId;
  state.score.push(e);
}

/** Spend game minutes. Timers that come due fire along the way. */
function spend(state: GameState, data: GameData, minutes: number): void {
  advance(state.clock, minutes, (timer) => {
    if (timer.kind === "handoff-follow-up") return handoffFollowUp(state, data, timer.payload);
    if (timer.kind === "reopen") return reopen(state, data, String(timer.payload.ticket));
    if (timer.kind === "console-rollback") return consoleRollback(state, timer.payload);
    if (timer.kind.startsWith("ticket-")) {
      const ev = onTicketTimer(state.book, state.clock, data, timer);
      if (ev) {
        state.events.push({ at: ev.at, text: ev.text });
        if (timer.kind === "ticket-resolve-due" || timer.kind === "ticket-response-due")
          points(state, data, "slaBreach", ev.text, ev.ticketId);
      }
    }
  });
}

const cost = (data: GameData, key: string) => data.actionCosts[key] ?? 0;

function cliContext(state: GameState, data: GameData, s: CliSession): CliContext {
  const dialect = data.dialects.get(s.dialect);
  if (!dialect) throw new Error(`no dialect ${s.dialect}`);
  return {
    world: state.world,
    dialect,
    time: formatTime(data.calendar, state.clock.now, true),
    now: state.clock.now,
  };
}

/** Client business hours, hidden from the player. Weekdays only. */
function clientAvailable(state: GameState, at: number): boolean {
  const h = state.world.client.businessHours;
  const m = minuteOfDay(at);
  return dayOfWeek(at) < 5 && m >= h.start && m < h.end;
}

function touchUserPc(state: GameState, data: GameData, deviceId: string, what: string): void {
  const dev = state.world.devices.find((d) => d.id === deviceId);
  if (!dev?.user || state.consent[deviceId] !== undefined) return;
  points(
    state,
    data,
    "consentViolation",
    `${what} on ${dev.hostname} without ${dev.user}'s consent.`,
  );
  state.events.push({
    at: state.clock.now,
    text: `${dev.user} saw activity on ${dev.hostname} nobody asked about.`,
  });
}

function handoffFollowUp(
  state: GameState,
  data: GameData,
  p: Record<string, string | number>,
): void {
  const t = find(state.book, String(p.ticket));
  const def = data.handoffs.handoffs.find((h) => h.id === p.handoff);
  if (!t || !def?.followUp || t.closedAt !== undefined) return;
  const now = state.clock.now;
  let text = def.followUp.text;
  if (p.askClose === 1) {
    const c = state.world.cases.find((x) => x.caseId === t.caseId);
    const fixed = !!c && caseFixed(state.world, c, now);
    const broken = fixed ? collateralDown(state, caseSite(state, c)) : [];
    t.clientConfirmed = fixed && broken.length === 0;
    text = !fixed
      ? `${t.contact ?? "Client"}: Still not working here.`
      : broken.length > 0
        ? `${t.contact ?? "Client"}: That part works now, but ${whereDown(state, broken)} stopped working. Not OK to close yet.`
        : `${t.contact ?? "Client"}: Tested it, all good here. OK to close.`;
    t.proofs.push({ at: now, kind: "client", source: "client", lines: [text], provesFixed: fixed });
  }
  if (t.version === Number(p.version)) {
    t.status = def.followUp.status;
    t.lastStatusAt = now;
  }
  t.history.push({ at: now, by: p.askClose === 1 ? "client" : "dispatch", text });
  state.events.push({ at: now, text: `${t.id}: ${text}` });
}

function caseSite(state: GameState, c: { bindings: Record<string, string>; primary: string }) {
  return state.world.devices.find((d) => d.id === c.bindings[c.primary])?.siteId;
}

/** "LFC-AP-EXAM3 in Exam 3 and LFC-AP-EXAM4 in Exam 4", as the client would say it. */
function whereDown(state: GameState, ids: string[]): string {
  const rooms = state.world.sites.flatMap((x) => x.rooms);
  return ids
    .map((id) => state.world.devices.find((d) => d.id === id))
    .map((d) => {
      const room = rooms.find((r) => r.id === d?.roomId)?.name;
      return room ? `${d?.hostname} in ${room}` : (d?.hostname ?? "");
    })
    .join(" and ");
}

function reopen(state: GameState, data: GameData, id: string): void {
  const t = find(state.book, id);
  if (!t) return;
  t.closedAt = undefined;
  t.status = "feedback-received";
  t.version++;
  t.clientConfirmed = false;
  t.history.push({
    at: state.clock.now,
    by: t.origin === "client" ? "client" : "system",
    text: "Reopened: the problem is back.",
  });
  state.events.push({ at: state.clock.now, text: `${t.id} reopened. The problem is not fixed.` });
  points(state, data, "reopened", `${t.id} reopened after close.`, t.id);
}

/**
 * Devices at a site that were up at the start, are down now and are not just asleep. Gear that
 * is only down because of a scheduled power cut or a power-cycle does not count.
 */
export function collateralDown(state: GameState, siteId?: string): string[] {
  const ns = netState(state.world, state.clock.now);
  const lit = netState(state.world, state.clock.now, { ignoreCuts: true });
  return (state.baselineUp ?? []).filter((id) => {
    const d = state.world.devices.find((x) => x.id === id);
    return (
      !!d &&
      (!siteId || d.siteId === siteId) &&
      !ns.online.get(id) &&
      !ns.asleep.get(id) &&
      !lit.online.get(id)
    );
  });
}

/** Can this SSH session still reach its device the way it came in? */
function sessionReaches(state: GameState, s: CliSession): boolean {
  if (!s.fromId || !s.address) return true;
  const { world } = state;
  const ns = netState(world, state.clock.now);
  const host = world.devices.find((d) => d.id === s.fromId);
  return !!host && agentOnline(world, host, ns) && canManage(world, host.id, s.address, "ssh", ns);
}

/**
 * A change that cut your own SSH path. The session drops, it costs points, and the on-call senior
 * talks the client's contact through a console rollback an hour of business time later.
 */
function lockedOut(
  state: GameState,
  data: GameData,
  s: CliSession,
  before: { running?: unknown; startup?: unknown },
): string[] {
  const { world, clock } = state;
  const dev = world.devices.find((d) => d.id === s.deviceId);
  if (!dev) return [];
  s.closed = true;
  const contact = world.client.contacts[0]?.name ?? "the client";
  const at = addBusinessMinutes(data.calendar, clock.now, 60);
  schedule(clock, at, "console-rollback", {
    device: dev.id,
    running: JSON.stringify(before.running ?? null),
    startup: JSON.stringify(before.startup ?? null),
  });
  const when = formatTime(data.calendar, at);
  const text = `You cut off your own access to ${dev.hostname}. The on-call senior will walk ${contact} through a console rollback at ${when}. That undoes your last change.`;
  points(state, data, "lockedOut", `Locked yourself out of ${dev.hostname} with a remote change.`);
  state.events.push({ at: clock.now, text });
  const lines = [`Connection to ${s.address} closed by remote host.`, "", text];
  s.transcript.pop(); // the fresh prompt runLine left behind
  s.transcript.push(...lines);
  return lines;
}

function consoleRollback(state: GameState, p: Record<string, string | number>): void {
  const dev = state.world.devices.find((d) => d.id === p.device);
  if (!dev) return;
  const running = JSON.parse(String(p.running));
  const startup = JSON.parse(String(p.startup));
  if (running) dev.running = running;
  if (startup) dev.startup = startup;
  state.events.push({
    at: state.clock.now,
    text: `${dev.hostname} was rolled back from the console. Your last change is gone and access is back.`,
  });
}

/** "10.1.20.5", or with cidr "203.0.113.8/29". */
const isAddress = (v: string, cidr = false) => {
  if (!cidr) return isIp(v);
  const [ip = "", bits = "", ...rest] = v.split("/");
  return rest.length === 0 && isIp(ip) && /^\d{1,2}$/.test(bits) && Number(bits) <= 32;
};

interface EditField {
  name: string;
  /** What the network really has. A fix is an edit that lands on this. */
  truth: string;
  format: "ip" | "cidr" | "text";
  get: () => string;
  set: (v: string) => void;
}

/** The fields a player can correct: docs device rows, docs site WAN details and Ovik inventory. */
function editField(world: World, target: string, field: string): EditField | undefined {
  const [kind, id] = target.split(":");
  if (kind === "device") {
    const doc = world.docs.devices.find((d) => d.deviceId === id);
    const dev = world.devices.find((d) => d.id === id);
    if (!doc) return undefined;
    if (field === "ip")
      return {
        name: doc.hostname,
        truth: dev?.ip ?? "",
        format: "ip",
        get: () => doc.ip ?? "",
        set: (v) => {
          doc.ip = v;
        },
      };
    if (field === "firmware")
      return {
        name: doc.hostname,
        truth: dev?.firmware ?? "",
        format: "text",
        get: () => doc.firmware,
        set: (v) => {
          doc.firmware = v;
        },
      };
    return undefined;
  }
  if (kind === "site") {
    const doc = world.docs.sites.find((s) => s.siteId === id);
    const site = world.sites.find((s) => s.id === id);
    const f = field as "wanIp" | "wanCidr" | "gateway" | "account" | "pin";
    if (!doc || !site || !["wanIp", "wanCidr", "gateway", "account", "pin"].includes(field))
      return undefined;
    return {
      name: doc.name,
      truth: site.isp[f],
      format: f === "wanCidr" ? "cidr" : f === "account" || f === "pin" ? "text" : "ip",
      get: () => doc.isp[f],
      set: (v) => {
        doc.isp[f] = v;
      },
    };
  }
  if (kind === "ovik") {
    const row = world.monitoring.inventory.find((o) => o.deviceId === id);
    const dev = world.devices.find((d) => d.id === id);
    if (!row || !dev || (field !== "ip" && field !== "hostname")) return undefined;
    return {
      name: row.hostname,
      truth: (field === "ip" ? dev.ip : dev.hostname) ?? "",
      format: field === "ip" ? "ip" : "text",
      get: () => row[field],
      set: (v) => {
        row[field] = v;
      },
    };
  }
  return undefined;
}

const KEEP_OUTPUTS = 10;

function remember(s: TermSession, line: string, output: string[]): void {
  s.last = { line, output };
  s.outputs = [...(s.outputs ?? []), s.last].slice(-KEEP_OUTPUTS);
}

function callCtx(state: GameState, data: GameData, serial: number) {
  return {
    world: state.world,
    data,
    now: state.clock.now,
    open: clientAvailable(state, state.clock.now),
    serial,
    heard: state.heard ?? [],
  };
}

function openDeviceSession(
  state: GameState,
  data: GameData,
  deviceId: string,
  opts: Parameters<typeof openSession>[3] = {},
): ActionResult {
  const dev = state.world.devices.find((d) => d.id === deviceId);
  const dialect = dev?.dialect ? data.dialects.get(dev.dialect) : undefined;
  if (!dev || !dialect) return { ok: false, error: `${deviceId} has no CLI.` };
  const id = `s${state.nextSession++}`;
  state.sessions[id] = openSession(
    id,
    { world: state.world, dialect, time: "", now: state.clock.now },
    dev.id,
    opts,
  );
  return { ok: true, session: id };
}

function run(state: GameState, data: GameData, a: Action): ActionResult {
  const { clock, book, world } = state;
  switch (a.t) {
    case "advance":
      spend(state, data, a.minutes);
      return { ok: true };
    case "cli-open":
      return openDeviceSession(state, data, a.device);
    case "cli": {
      const s = state.sessions[a.session];
      if (!s || s.kind !== "device") return { ok: false, error: `No session ${a.session}.` };
      const typedPassword = !!s.login;
      const dev = world.devices.find((d) => d.id === s.deviceId);
      // The box lost power under you: the session is gone.
      if (dev && netState(world, clock.now).cut.get(dev.id)) {
        s.closed = true;
        const line = `Connection to ${s.address ?? dev.hostname} closed by remote host.`;
        s.transcript.push(line);
        return { ok: true, output: [line] };
      }
      const before = {
        running: structuredClone(dev?.running),
        startup: structuredClone(dev?.startup),
      };
      const reached = !typedPassword && sessionReaches(state, s);
      const output = runLine(s, a.line, cliContext(state, data, s));
      if (
        reached &&
        !s.closed &&
        JSON.stringify(dev?.running) !== JSON.stringify(before.running) &&
        !sessionReaches(state, s)
      )
        output.push(...lockedOut(state, data, s, before));
      // Keep the last command that printed something, so there is real output to attach.
      // A password line never counts: it would show the password on the ticket.
      if (output.length > 0 && !typedPassword) remember(s, a.line, output);
      spend(state, data, cost(data, "cli"));
      return { ok: true, output };
    }
    case "rmm-open": {
      const dev = world.devices.find((d) => d.id === a.device);
      if (!dev || !agentOnline(world, dev, netState(world, clock.now)))
        return { ok: false, error: "Agent is offline." };
      touchUserPc(state, data, dev.id, "Opened a background shell");
      const id = `s${state.nextSession++}`;
      state.sessions[id] = openRmm(id, world, dev.id);
      spend(state, data, cost(data, "rmm-open"));
      return { ok: true, session: id };
    }
    case "rmm": {
      const s = state.sessions[a.session];
      if (!s || s.kind !== "rmm") return { ok: false, error: `No session ${a.session}.` };
      const res = runRmmLine(s, a.line, world, clock.now);
      if (res.output.length > 0) remember(s, a.line, res.output);
      spend(state, data, cost(data, "rmm-command"));
      if (!res.ssh) return { ok: true, output: res.output };
      // SSH from the agent: the target must answer on 22 from here.
      const ns = netState(world, clock.now);
      const target = resolveTarget(world, res.ssh.address, ns);
      const fail = (line: string) => {
        s.transcript.splice(s.transcript.length - 1, 0, line);
        return { ok: true, output: [line] };
      };
      if (target.kind === "none" || target.kind === "internet" || target.kind === "isp-gateway")
        return fail(`ssh: connect to host ${res.ssh.address} port 22: Connection timed out`);
      if (!target.device || !canManage(world, s.deviceId, res.ssh.address, "ssh", ns))
        return fail(`ssh: connect to host ${res.ssh.address} port 22: Connection refused`);
      const opened = openDeviceSession(state, data, target.device.id, {
        username: res.ssh.username,
        fromId: s.deviceId,
        address: res.ssh.address,
      });
      return { ...opened, output: [`Opened SSH to ${res.ssh.address} in a new tab.`] };
    }
    case "rmm-script": {
      const dev = world.devices.find((d) => d.id === a.device);
      const script = data.scripts.get(a.script);
      if (!dev || !script) return { ok: false, error: "No such device or script." };
      if (!agentOnline(world, dev, netState(world, clock.now)))
        return { ok: false, error: "Agent is offline. The job is queued until it checks in." };
      touchUserPc(state, data, dev.id, `Ran "${script.name}"`);
      const output = runScript(world, dev, script);
      spend(state, data, script.minutes);
      return { ok: true, output };
    }
    case "consent-request": {
      const dev = world.devices.find((d) => d.id === a.device);
      if (!dev?.user) return { ok: false, error: "Nobody is signed in there." };
      spend(state, data, cost(data, "consent-request"));
      if (state.consent[dev.id] !== undefined)
        return { ok: true, output: [`${dev.user} already said yes.`] };
      if (!clientAvailable(state, clock.now))
        return { ok: true, output: [`No answer from ${dev.user}. They may be out of the office.`] };
      state.consent[dev.id] = clock.now;
      return { ok: true, output: [`${dev.user}: Sure, go ahead.`] };
    }
    case "session-close": {
      const s = state.sessions[a.session];
      if (!s) return { ok: false, error: `No session ${a.session}.` };
      s.closed = true;
      return { ok: true };
    }
    case "ticket-open": {
      const t = find(book, a.ticket);
      if (!t) return { ok: false, error: `No ticket ${a.ticket}.` };
      t.openedAt ??= clock.now;
      return { ok: true };
    }
    case "ticket-status":
      return setStatus(book, clock, data, a.ticket, a.status);
    case "ticket-priority":
      return setPriority(book, clock, data, a.ticket, a.priority, "tech");
    case "ticket-flag-p1":
      return flagP1(book, clock, a.ticket, a.reason);
    case "ticket-note": {
      spend(state, data, cost(data, "ticket-note"));
      const t = find(book, a.ticket);
      // A tech note is a response to the client, so it stops the response clock.
      if (t && t.closedAt === undefined) t.respondedAt ??= clock.now;
      return addNote(book, clock, a.ticket, a.text);
    }
    case "handoff": {
      const t = find(book, a.ticket);
      const def = data.handoffs.handoffs.find((h) => h.id === a.handoff);
      if (!t || !def) return { ok: false, error: "No such ticket or handoff." };
      if (def.id === "resolved") return { ok: false, error: "Use Resolve to close a ticket." };
      if (t.closedAt !== undefined) return { ok: false, error: `${t.id} is closed.` };
      const notes = handoffNotes(data, world, t, def.id);
      const pick = notes[a.note];
      if (!pick) return { ok: false, error: "Pick a note." };
      t.handoffs++;
      points(
        state,
        data,
        pick.quality === "good"
          ? "goodNote"
          : pick.quality === "vague"
            ? "vagueNote"
            : "jargonNote",
        `${def.name} note on ${t.id} was ${pick.quality}.`,
        t.id,
      );
      const text = `${def.name}: ${pick.text}${a.detail ? ` Detail: ${a.detail}` : ""}${a.askClose ? " Is it good to close?" : ""}`;
      if (def.status) setStatus(book, clock, data, t.id, def.status, text);
      else addNote(book, clock, t.id, text);
      if (def.dispatch) t.history.push({ at: clock.now, by: "dispatch", text: def.dispatch });
      if (def.followUp) {
        const at = addBusinessMinutes(data.calendar, clock.now, def.followUp.afterMinutes);
        schedule(clock, at, "handoff-follow-up", {
          ticket: t.id,
          handoff: def.id,
          version: t.version,
          askClose: a.askClose ? 1 : 0,
        });
        if (def.status === "scheduled")
          state.calendar.push({ at, ticketId: t.id, title: `${def.name}: ${t.title}` });
      }
      if (def.id === "new-ticket") {
        createTicket(book, clock, data, {
          clientId: world.client.id,
          title: a.detail || `Follow-up from ${t.id}`,
          body: `Opened from ${t.id}. ${a.detail}`,
          priority: "P4",
          origin: "tech",
        });
      }
      spend(state, data, cost(data, "handoff"));
      return { ok: true };
    }
    case "attach-proof": {
      const t = find(book, a.ticket);
      if (!t) return { ok: false, error: `No ticket ${a.ticket}.` };
      const c = world.cases.find((x) => x.caseId === t.caseId);
      const fixed = !!c && caseFixed(world, c, clock.now);
      let lines: string[];
      let source: string;
      if (a.source === "ovik") {
        const v = ovikView(world, clock.now);
        const dev = c ? world.devices.find((d) => d.id === c.bindings[c.primary]) : undefined;
        const row = v.inventory.find((r) => r.deviceId === dev?.id);
        source = "Ovik";
        lines = row
          ? [`${row.hostname} (${row.ip}): ${row.status}`]
          : [
              `Collector ${v.collector.hostname}: ${v.collector.online ? "online" : "offline"}`,
              `${v.alerts.length} active alerts`,
            ];
      } else {
        // "s3" is the session's last output, "s3#1" an earlier one from its list.
        const [sid = "", n] = a.source.split("#");
        const s = state.sessions[sid];
        const pick = n === undefined ? s?.last : s?.outputs?.[Number(n)];
        if (!s || !pick)
          return { ok: false, error: "Run a command first, then attach its output." };
        const host = world.devices.find((d) => d.id === s.deviceId)?.hostname ?? s.deviceId;
        source = `${host}: ${pick.line}`;
        lines = pick.output.slice(0, 40);
      }
      t.proofs.push({ at: clock.now, kind: "output", source, lines, provesFixed: fixed });
      t.history.push({ at: clock.now, by: "tech", text: `Attached output: ${source}` });
      spend(state, data, cost(data, "attach-proof"));
      return { ok: true };
    }
    case "resolve": {
      const t = find(book, a.ticket);
      const c = t ? world.cases.find((x) => x.caseId === t.caseId) : undefined;
      if (!t) return { ok: false, error: `No ticket ${a.ticket}.` };
      if (t.closedAt !== undefined || t.sentBack)
        return { ok: false, error: `${t.id} is not in your queue.` };
      if (!c) {
        // Closing works, but a misroute or a duplicate should have gone back to dispatch.
        if (!plainResolutionNotes(t)[a.note])
          return { ok: false, error: "Pick a resolution note." };
        spend(state, data, cost(data, "resolve"));
        const x = world.extraTickets.find((e) => e.id === t.extraId);
        points(
          state,
          data,
          "closedNotOurs",
          x?.kind === "duplicate"
            ? `${t.id} was a duplicate. Send duplicates back so dispatch can merge them.`
            : `${t.id} was not a network problem. Send it back so the right team gets it.`,
          t.id,
        );
        setStatus(book, clock, data, t.id, "closed", plainResolutionNotes(t)[a.note]?.join("\n"));
        return { ok: true, output: [] };
      }
      const note = resolutionNotes(world, t, c)[a.note];
      if (!note) return { ok: false, error: "Pick a resolution note." };
      spend(state, data, cost(data, "resolve"));
      const blockers = closeBlockers(t);
      const fixed = caseFixed(world, c, clock.now);
      const s = data.handoffs.scoring;
      // A close that will reopen earns nothing for its note, or close and reopen would farm points.
      if (fixed)
        state.score.push({
          at: clock.now,
          points: note.parts.length * (s.resolutionPart ?? 0),
          reason: `Resolution note covered ${note.parts.length} of 6 parts.`,
          ticketId: t.id,
        });
      if (note.wrongCause)
        points(state, data, "wrongRootCause", "Resolution note named the wrong root cause.", t.id);
      setStatus(book, clock, data, t.id, "closed", note.lines.join("\n"));
      if (!fixed) {
        schedule(clock, clock.now + 90, "reopen", { ticket: t.id });
        return { ok: true, output: blockers };
      }
      const down = collateralDown(state, caseSite(state, c));
      const fresh = down.filter((id) => !(state.collateral ?? []).includes(id));
      state.collateral = [...(state.collateral ?? []), ...fresh];
      if (fresh.length > 0)
        points(
          state,
          data,
          "collateralOutage",
          `Closed ${t.id} while ${whereDown(state, fresh)} is down because of a change.`,
          t.id,
        );
      // An outage you already paid for still rules out a clean close, and the proof rule still holds.
      const proven =
        blockers.length === 0 && t.proofs.some((p) => p.kind === "output" && p.provesFixed);
      if (!proven)
        points(
          state,
          data,
          "closedNoProof",
          `${t.id} closed without the proof the closing rule wants.`,
          t.id,
        );
      else if (down.length === 0)
        points(state, data, "closedClean", `${t.id} closed with proof.`, t.id);
      return { ok: true, output: blockers };
    }
    case "send-back": {
      const t = find(book, a.ticket);
      if (!t) return { ok: false, error: `No ticket ${a.ticket}.` };
      if (t.closedAt !== undefined || t.sentBack)
        return { ok: false, error: `${t.id} is not in your queue.` };
      const x = world.extraTickets.find((e) => e.id === t.extraId);
      const reason = data.handoffs.sendBack.find((r) => r.id === a.reason);
      if (!reason) return { ok: false, error: "Pick a reason." };
      spend(state, data, cost(data, "send-back"));
      if (x && x.sendBack === a.reason) {
        if (x.kind === "misroute") {
          const worked = clock.now - (t.openedAt ?? clock.now);
          points(
            state,
            data,
            worked <= 30 ? "misrouteBouncedEarly" : "misrouteWorkedLong",
            worked <= 30
              ? "Sent a misroute back quickly."
              : `Worked a misroute for ${worked} minutes before sending it back.`,
            t.id,
          );
        } else points(state, data, "duplicateBounced", "Spotted a duplicate.", t.id);
      } else {
        points(
          state,
          data,
          "wrongSendBack",
          `Sent ${t.id} back as "${reason.name}", but it was not.`,
          t.id,
        );
      }
      t.sentBack = a.reason;
      setStatus(book, clock, data, t.id, "dispatch-review", `Sent back: ${reason.name}`);
      return { ok: true };
    }
    case "doc-edit": {
      const f = editField(world, a.target, a.field);
      if (!f) return { ok: false, error: "Cannot edit that." };
      const value = a.value.trim();
      const before = f.get();
      if (!value) return { ok: false, error: `${a.field} cannot be empty.` };
      if (f.format !== "text" && !isAddress(value, f.format === "cidr"))
        return {
          ok: false,
          error: `"${value}" is not ${f.format === "cidr" ? "an address block like 203.0.113.8/29" : "an IP address"}.`,
        };
      f.set(value);
      // Ovik is its own tool. Only Hoodoo edits land in the docs history.
      if (!a.target.startsWith("ovik:"))
        world.docs.history.push({
          at: clock.now,
          by: "You",
          entry: a.target,
          field: a.field,
          from: before,
          to: value,
        });
      const key = `${a.target}:${a.field}`;
      // Judge against the value before your first edit, so breaking a right entry and fixing it pays nothing.
      state.edits ??= {};
      state.edits[key] ??= before;
      const original = state.edits[key];
      if (original !== f.truth && value === f.truth && !state.docFixes.includes(key)) {
        state.docFixes.push(key);
        points(
          state,
          data,
          "docFix",
          a.target.startsWith("ovik:")
            ? `Fixed Ovik: ${a.field} on ${f.name}.`
            : `Fixed the docs: ${a.field} on ${f.name}.`,
        );
      }
      spend(state, data, cost(data, "doc-edit"));
      return { ok: true };
    }
    case "doc-add": {
      const site = world.docs.sites.find((x) => x.siteId === a.site);
      const hostname = a.hostname.trim();
      const ip = a.ip.trim();
      if (!site) return { ok: false, error: "Pick a site." };
      if (!hostname) return { ok: false, error: "Type a name." };
      if (!isIp(ip)) return { ok: false, error: `"${ip}" is not an IP address.` };
      if (!DEVICE_KINDS.includes(a.kind)) return { ok: false, error: "Pick a type." };
      const real = world.devices.find((d) => d.siteId === a.site && d.ip === ip);
      // Credit a device that really sits at that address and the docs never had.
      const credit = !!real && !world.docs.devices.some((d) => d.deviceId === real.id);
      const id = credit && real ? real.id : `added-${world.docs.devices.length + 1}`;
      world.docs.devices.push({
        deviceId: id,
        siteId: a.site,
        hostname,
        kind: a.kind,
        model: "",
        ip,
        firmware: "",
        roomId: real?.roomId && credit ? real.roomId : "",
        notes: `Added by you ${formatTime(data.calendar, clock.now)}.`,
      });
      world.docs.history.push({
        at: clock.now,
        by: "You",
        entry: `device:${id}`,
        field: "added",
        from: "",
        to: `${hostname} ${ip}`,
      });
      const key = `device:${id}:added`;
      if (credit && !state.docFixes.includes(key)) {
        state.docFixes.push(key);
        points(state, data, "docAdd", `Added ${hostname} (${ip}) to the docs.`);
      }
      spend(state, data, cost(data, "doc-edit"));
      return { ok: true };
    }
    case "call": {
      const person = findPerson(world, a.person);
      if (!person) return { ok: false, error: "Nobody by that name." };
      const t = a.ticket ? find(book, a.ticket) : undefined;
      if (a.ticket && !t) return { ok: false, error: `No ticket ${a.ticket}.` };
      state.calls ??= {};
      const id = `c${Object.keys(state.calls).length + 1}`;
      const call = dial(
        callCtx(state, data, Object.keys(state.calls).length + 1),
        id,
        person,
        a.ticket,
      );
      state.calls[id] = call;
      spend(state, data, data.calls.dialMinutes + (call.hold ?? 0));
      if (call.answered && person.insider && world.client.contactPreference === "scheduled-only") {
        // They take the call, but they asked for scheduled contact only.
        call.transcript.push(
          fill(data.calls.lines.unwanted ?? "", (k) => (k === "name" ? person.name : "")),
        );
        const key = `${person.id}:${Math.floor(clock.now / 1440)}`;
        state.unwantedCalls ??= [];
        if (!state.unwantedCalls.includes(key)) {
          state.unwantedCalls.push(key);
          points(
            state,
            data,
            "callUnwanted",
            `Called ${person.name} directly. ${world.client.name} wants calls scheduled through dispatch.`,
            a.ticket,
          );
        }
      }
      if (t) {
        // Only talking to the client counts as a response, not the ISP.
        if (call.answered && !person.isp) t.respondedAt ??= clock.now;
        t.history.push({
          at: clock.now,
          by: "tech",
          text: `Called ${person.name}. ${call.transcript.at(-1) ?? ""}`,
        });
      }
      return { ok: true, session: id, output: call.transcript };
    }
    case "call-ask": {
      const call = state.calls?.[a.call];
      if (!call) return { ok: false, error: `No call ${a.call}.` };
      const person = findPerson(world, call.person);
      if (!person) return { ok: false, error: "Nobody on the line." };
      const t = call.ticket ? find(book, call.ticket) : undefined;
      const c = t ? world.cases.find((x) => x.caseId === t.caseId) : undefined;
      const def =
        data.calls.asks.find((x) => x.id === a.ask) ??
        data.calls.isp.asks.find((x) => x.id === a.ask);
      const before = call.transcript.length;
      const res = ask(callCtx(state, data, Number(call.id.slice(1))), call, person, a.ask, {
        ...(a.device ? { device: a.device } : {}),
        ...(c ? { caseInst: c } : {}),
        collateral: () => (c ? whereDown(state, collateralDown(state, caseSite(state, c))) : ""),
      });
      if ("error" in res) return { ok: false, error: res.error };
      if (res.cycled) touchUserPc(state, data, res.cycled, "Had someone unplug");
      if (res.fact) {
        state.heard ??= [];
        if (!state.heard.includes(res.fact)) state.heard.push(res.fact);
      }
      if (t && res.test) {
        t.clientConfirmed = res.test.ok;
        t.proofs.push({
          at: clock.now,
          kind: "client",
          source: person.name,
          lines: res.lines.slice(1),
          provesFixed: res.test.fixed,
        });
      }
      if (t)
        t.history.push({
          at: clock.now,
          by: person.isp ? "isp" : "client",
          // Account numbers and PINs stay off the ticket, like passwords.
          text:
            def && "kind" in def && def.kind === "isp-bill"
              ? "Read the account numbers and PINs off the ISP bill."
              : res.lines.slice(1).join(" "),
        });
      spend(state, data, def?.minutes ?? 5);
      return { ok: true, output: call.transcript.slice(before) };
    }
    case "call-end": {
      const call = state.calls?.[a.call];
      if (!call) return { ok: false, error: `No call ${a.call}.` };
      call.closed = true;
      return { ok: true };
    }
    case "vault-view": {
      const cred = world.docs.credentials.find((c) => c.deviceId === a.device);
      if (!cred) return { ok: false, error: "No vault entry." };
      world.docs.accessLog.push({ at: clock.now, who: "You", entry: `vault:${a.device}` });
      return { ok: true, output: [cred.username, cred.password] };
    }
  }
}

/** Apply one player action. Every action is logged, even a failed one, so replay is exact. */
export function applyAction(state: GameState, data: GameData, a: Action): ActionResult {
  const result = run(state, data, a);
  state.log.push(a);
  if (state.log.length % SNAPSHOT_EVERY === 0) {
    const { log: _log, snapshot: _snap, ...rest } = state;
    state.snapshot = { at: state.log.length, state: JSON.stringify(rest) };
  }
  return result;
}

export function totalScore(state: GameState): number {
  return state.score.reduce((s, e) => s + e.points, 0);
}
