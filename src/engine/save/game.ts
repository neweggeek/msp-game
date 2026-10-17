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
import type { Priority, World } from "../model/types";
import { ovikView } from "../monitor/ovik";
import { canManage, resolveTarget } from "../net/reach";
import { netState } from "../net/state";
import { type RmmSession, agentOnline, openRmm, runRmmLine, runScript } from "../rmm/rmm";
import { caseFixed } from "../tickets/checks";
import { closeBlockers, handoffNotes, resolutionNotes } from "../tickets/desk";
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
  | { t: "vault-view"; device: string };

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
  events: GameEvent[];
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
    t.clientConfirmed = fixed;
    text = fixed
      ? `${t.contact ?? "Client"}: Tested it, all good here. OK to close.`
      : `${t.contact ?? "Client"}: Still not working here.`;
    t.proofs.push({ at: now, kind: "client", source: "client", lines: [text], provesFixed: fixed });
  }
  if (t.version === Number(p.version)) {
    t.status = def.followUp.status;
    t.lastStatusAt = now;
  }
  t.history.push({ at: now, by: p.askClose === 1 ? "client" : "dispatch", text });
  state.events.push({ at: now, text: `${t.id}: ${text}` });
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
      const output = runLine(s, a.line, cliContext(state, data, s));
      s.last = { line: a.line, output };
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
      s.last = { line: a.line, output: res.output };
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
    case "ticket-note":
      spend(state, data, cost(data, "ticket-note"));
      return addNote(book, clock, a.ticket, a.text);
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
        const s = state.sessions[a.source];
        if (!s?.last) return { ok: false, error: "Run a command first, then attach its output." };
        const host = world.devices.find((d) => d.id === s.deviceId)?.hostname ?? s.deviceId;
        source = `${host}: ${s.last.line}`;
        lines = s.last.output.slice(0, 40);
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
      if (!c) return { ok: false, error: "There is nothing to fix here. Send it back instead." };
      if (t.closedAt !== undefined) return { ok: false, error: `${t.id} is closed.` };
      const note = resolutionNotes(world, t, c)[a.note];
      if (!note) return { ok: false, error: "Pick a resolution note." };
      spend(state, data, cost(data, "resolve"));
      const blockers = closeBlockers(t);
      const fixed = caseFixed(world, c, clock.now);
      const s = data.handoffs.scoring;
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
      } else if (
        blockers.length === 0 &&
        t.proofs.some((p) => p.kind === "output" && p.provesFixed)
      ) {
        points(state, data, "closedClean", `${t.id} closed with proof.`, t.id);
      } else {
        points(
          state,
          data,
          "closedNoProof",
          `${t.id} closed without the proof the closing rule wants.`,
          t.id,
        );
      }
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
      const [kind, id] = a.target.split(":");
      const docs = world.docs;
      let before: string | undefined;
      let truth: string | undefined;
      if (kind === "device") {
        const doc = docs.devices.find((d) => d.deviceId === id);
        const dev = world.devices.find((d) => d.id === id);
        if (!doc || !dev || !["ip", "firmware"].includes(a.field))
          return { ok: false, error: "Cannot edit that." };
        before = a.field === "ip" ? doc.ip : doc.firmware;
        truth = a.field === "ip" ? dev.ip : dev.firmware;
        if (a.field === "ip") doc.ip = a.value;
        else doc.firmware = a.value;
      } else if (kind === "site") {
        const doc = docs.sites.find((s) => s.siteId === id);
        const site = world.sites.find((s) => s.id === id);
        if (!doc || !site || a.field !== "wanIp") return { ok: false, error: "Cannot edit that." };
        before = doc.isp.wanIp;
        truth = site.isp.wanIp;
        doc.isp.wanIp = a.value;
      } else return { ok: false, error: "Cannot edit that." };
      docs.history.push({
        at: clock.now,
        by: "You",
        entry: a.target,
        field: a.field,
        from: before ?? "",
        to: a.value,
      });
      const key = `${a.target}:${a.field}`;
      if (before !== truth && a.value === truth && !state.docFixes.includes(key)) {
        state.docFixes.push(key);
        points(state, data, "docFix", `Fixed the docs: ${a.field} on ${a.target}.`);
      }
      spend(state, data, cost(data, "doc-edit"));
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
