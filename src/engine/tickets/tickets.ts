import {
  type ClockState,
  DAY,
  type Timer,
  addBusinessMinutes,
  endOfBusinessDays,
  schedule,
} from "../clock/clock";
import type { GameData } from "../data";
import type { Origin, Priority } from "../model/types";

export interface TicketEntry {
  at: number;
  /** "tech", "dispatch", "system", "client", or a coworker's name. */
  by: string;
  text: string;
}

export interface Proof {
  at: number;
  kind: "output" | "client";
  source: string;
  lines: string[];
  /** Engine truth at the moment it was attached. The player never sees this flag. */
  provesFixed: boolean;
}

export interface Ticket {
  id: string;
  clientId: string;
  title: string;
  body: string;
  priority: Priority;
  status: string;
  caseId?: string;
  extraId?: string;
  origin: Origin;
  /** Who reported it, for client tickets. */
  contact?: string;
  createdAt: number;
  /** First time the tech opened it. Time on the ticket counts from here. */
  openedAt?: number;
  proofs: Proof[];
  /** Client said it is good to close. */
  clientConfirmed: boolean;
  sentBack?: string;
  /** Handoffs picked so far, so note options stay fresh. */
  handoffs: number;
  lastStatusAt: number;
  respondedAt?: number;
  closedAt?: number;
  responseDue: number;
  resolveDue: number;
  breaches: { response?: number; resolve?: number };
  flaggedP1: boolean;
  /** Dispatch's hourly P1 check-ins are running for this ticket. */
  p1Clock?: boolean;
  /** Escalated to the senior, who answered with a hint. */
  escalatedAt?: number;
  /** Bumps on every tech status update, so stale aging timers know to stand down. */
  version: number;
  history: TicketEntry[];
}

export interface TicketBook {
  tickets: Ticket[];
  nextNumber: number;
}

export type TicketResult = { ok: true } | { ok: false; error: string };

export interface TicketEvent {
  at: number;
  ticketId: string;
  text: string;
}

function dueTimes(
  data: GameData,
  priority: Priority,
  from: number,
): { responseDue: number; resolveDue: number } {
  const rule = data.sla[priority];
  const cal = data.calendar;
  if (rule.clock === "wall") {
    return {
      responseDue: from + rule.responseMinutes,
      resolveDue: from + (rule.resolveMinutes ?? 0),
    };
  }
  return {
    responseDue: addBusinessMinutes(cal, from, rule.responseMinutes),
    resolveDue: rule.resolveBusinessDays
      ? endOfBusinessDays(cal, from, rule.resolveBusinessDays)
      : addBusinessMinutes(cal, from, rule.resolveMinutes ?? 0),
  };
}

function scheduleTimers(clock: ClockState, data: GameData, t: Ticket): void {
  schedule(clock, t.responseDue, "ticket-response-due", { ticket: t.id, version: t.version });
  schedule(clock, t.resolveDue, "ticket-resolve-due", { ticket: t.id, version: t.version });
  scheduleAging(clock, data, t);
}

function scheduleAging(clock: ClockState, data: GameData, t: Ticket): void {
  schedule(clock, t.lastStatusAt + data.tickets.aging.followUpAfterDays * DAY, "ticket-follow-up", {
    ticket: t.id,
    version: t.version,
  });
}

const statusName = (data: GameData, id: string) =>
  data.tickets.statuses.find((s) => s.id === id)?.name ?? id;

export function createTicket(
  book: TicketBook,
  clock: ClockState,
  data: GameData,
  input: {
    clientId: string;
    title: string;
    body: string;
    priority: Priority;
    origin: Origin;
    caseId?: string;
    extraId?: string;
    contact?: string;
    history?: TicketEntry[];
  },
): Ticket {
  const initial = data.tickets.statuses.find((s) => s.initial)?.id ?? "open";
  const now = clock.now;
  const { history: past = [], ...rest } = input;
  const t: Ticket = {
    id: `T-${book.nextNumber++}`,
    ...rest,
    proofs: [],
    clientConfirmed: false,
    handoffs: 0,
    status: initial,
    createdAt: now,
    lastStatusAt: now,
    ...dueTimes(data, input.priority, now),
    breaches: {},
    flaggedP1: false,
    version: 1,
    history: [...past, { at: now, by: "dispatch", text: `Ticket created at ${input.priority}.` }],
  };
  book.tickets.push(t);
  scheduleTimers(clock, data, t);
  return t;
}

export function find(book: TicketBook, id: string): Ticket | undefined {
  return book.tickets.find((t) => t.id === id);
}

/** A tech status update. Resets the aging clock. */
export function setStatus(
  book: TicketBook,
  clock: ClockState,
  data: GameData,
  id: string,
  status: string,
  note?: string,
): TicketResult {
  const t = find(book, id);
  const def = data.tickets.statuses.find((s) => s.id === status);
  if (!t) return { ok: false, error: `No ticket ${id}.` };
  if (!def) return { ok: false, error: `Unknown status ${status}.` };
  if (def.automatic) return { ok: false, error: `${def.name} is set automatically.` };
  if (data.tickets.statuses.find((s) => s.id === t.status)?.final)
    return { ok: false, error: `${t.id} is closed.` };
  t.status = status;
  t.lastStatusAt = clock.now;
  t.respondedAt ??= clock.now;
  t.version++;
  if (def.final) t.closedAt = clock.now;
  t.history.push({
    at: clock.now,
    by: "tech",
    text: note ? `${note} (Status: ${def.name})` : `Status set to ${def.name}.`,
  });
  if (!def.final) scheduleAging(clock, data, t);
  return { ok: true };
}

export function setPriority(
  book: TicketBook,
  clock: ClockState,
  data: GameData,
  id: string,
  priority: Priority,
  by: "tech" | "dispatch",
): TicketResult {
  const t = find(book, id);
  if (!t) return { ok: false, error: `No ticket ${id}.` };
  if (by === "tech" && !data.tickets.techPriorities.includes(priority)) {
    return { ok: false, error: "Only dispatch sets P1. Flag it for dispatch instead." };
  }
  t.priority = priority;
  Object.assign(t, dueTimes(data, priority, t.createdAt));
  t.history.push({ at: clock.now, by, text: `Priority set to ${priority}.` });
  schedule(clock, t.responseDue, "ticket-response-due", { ticket: t.id, version: t.version });
  schedule(clock, t.resolveDue, "ticket-resolve-due", { ticket: t.id, version: t.version });
  return { ok: true };
}

export function flagP1(
  book: TicketBook,
  clock: ClockState,
  id: string,
  reason: string,
): TicketResult {
  const t = find(book, id);
  if (!t) return { ok: false, error: `No ticket ${id}.` };
  t.flaggedP1 = true;
  t.history.push({ at: clock.now, by: "tech", text: `Flagged for P1: ${reason}` });
  return { ok: true };
}

export function addNote(
  book: TicketBook,
  clock: ClockState,
  id: string,
  text: string,
): TicketResult {
  const t = find(book, id);
  if (!t) return { ok: false, error: `No ticket ${id}.` };
  t.history.push({ at: clock.now, by: "tech", text });
  return { ok: true };
}

/** Handle a ticket timer. Returns an event to show the player, if anything changed. */
export function onTicketTimer(
  book: TicketBook,
  clock: ClockState,
  data: GameData,
  timer: Timer,
): TicketEvent | null {
  const t = find(book, String(timer.payload.ticket));
  if (!t || t.closedAt !== undefined) return null;
  const at = timer.at;
  const fresh = timer.payload.version === t.version;
  switch (timer.kind) {
    case "ticket-response-due":
      if (t.respondedAt !== undefined || t.breaches.response !== undefined || at !== t.responseDue)
        return null;
      t.breaches.response = at;
      t.history.push({ at, by: "system", text: "Response SLA breached." });
      return { at, ticketId: t.id, text: `${t.id} breached its response target.` };
    case "ticket-resolve-due":
      if (t.breaches.resolve !== undefined || at !== t.resolveDue) return null;
      t.breaches.resolve = at;
      t.history.push({ at, by: "system", text: "Resolve SLA breached." });
      return { at, ticketId: t.id, text: `${t.id} breached its resolve target.` };
    case "ticket-follow-up": {
      if (!fresh) return null;
      t.status = "follow-up-needed";
      const days = data.tickets.aging.followUpAfterDays;
      t.history.push({
        at,
        by: "system",
        text: `No status update for ${days} days. Set to ${statusName(data, t.status)}.`,
      });
      schedule(
        clock,
        endOfBusinessDays(data.calendar, at, data.tickets.aging.p1AfterBusinessDays),
        "ticket-p1-aging",
        { ticket: t.id, version: t.version },
      );
      return { at, ticketId: t.id, text: `${t.id} is now Follow-up Needed.` };
    }
    case "ticket-p1-aging":
      if (!fresh || t.status !== "follow-up-needed" || t.priority === "P1") return null;
      t.priority = "P1";
      Object.assign(t, dueTimes(data, "P1", at));
      t.history.push({
        at,
        by: "dispatch",
        text: "Aged with no update or client contact. Dispatch raised it to P1.",
      });
      schedule(clock, t.resolveDue, "ticket-resolve-due", { ticket: t.id, version: t.version });
      return { at, ticketId: t.id, text: `Dispatch raised ${t.id} to P1.` };
  }
  return null;
}
