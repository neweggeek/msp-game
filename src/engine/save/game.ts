import { type CliSession, openSession, runLine } from "../cli/session";
import { type ClockState, advance, formatTime, newClock } from "../clock/clock";
import type { GameData } from "../data";
import { GENERATOR_VERSION, generate } from "../gen";
import type { Priority, World } from "../model/types";
import {
  type TicketBook,
  addNote,
  createTicket,
  flagP1,
  onTicketTimer,
  setPriority,
  setStatus,
} from "../tickets/tickets";

export const SAVE_VERSION = 1;
export const SNAPSHOT_EVERY = 50;

/** Everything the player can do. The log of these, plus the seed, is the save. */
export type Action =
  | { t: "advance"; minutes: number }
  | { t: "cli-open"; device: string }
  | { t: "cli"; session: string; line: string }
  | { t: "ticket-status"; ticket: string; status: string }
  | { t: "ticket-priority"; ticket: string; priority: Priority }
  | { t: "ticket-flag-p1"; ticket: string; reason: string }
  | { t: "ticket-note"; ticket: string; text: string };

export interface GameEvent {
  at: number;
  text: string;
}

export interface GameState {
  saveVersion: number;
  generatorVersion: number;
  seed: string;
  caseId?: string;
  world: World;
  clock: ClockState;
  book: TicketBook;
  sessions: Record<string, CliSession>;
  nextSession: number;
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

export function newGame(seed: string, data: GameData, caseId?: string): GameState {
  const world = generate(seed, data, caseId);
  const clock = newClock(data.calendar.startMinute);
  const book: TicketBook = { tickets: [], nextNumber: 1001 };
  createTicket(book, clock, data, {
    clientId: world.client.id,
    title: world.case.ticketTitle,
    body: world.case.ticketBody,
    priority: world.case.priority,
    caseId: world.case.caseId,
  });
  const state: GameState = {
    saveVersion: SAVE_VERSION,
    generatorVersion: GENERATOR_VERSION,
    seed,
    world,
    clock,
    book,
    sessions: {},
    nextSession: 1,
    events: [],
    log: [],
  };
  if (caseId) state.caseId = caseId;
  return state;
}

function run(state: GameState, data: GameData, a: Action): ActionResult {
  const { clock, book } = state;
  switch (a.t) {
    case "advance":
      advance(clock, a.minutes, (timer) => {
        if (timer.kind.startsWith("ticket-")) {
          const ev = onTicketTimer(book, clock, data, timer);
          if (ev) state.events.push({ at: ev.at, text: ev.text });
        }
      });
      return { ok: true };
    case "cli-open": {
      const dev = state.world.devices.find((d) => d.id === a.device);
      const dialect = dev?.dialect ? data.dialects.get(dev.dialect) : undefined;
      if (!dev || !dialect) return { ok: false, error: `${a.device} has no CLI.` };
      const id = `s${state.nextSession++}`;
      state.sessions[id] = openSession(id, state.world, dialect, dev.id);
      return { ok: true, session: id };
    }
    case "cli": {
      const s = state.sessions[a.session];
      const dialect = s ? data.dialects.get(s.dialect) : undefined;
      if (!s || !dialect) return { ok: false, error: `No session ${a.session}.` };
      const output = runLine(s, a.line, {
        world: state.world,
        dialect,
        time: formatTime(data.calendar, clock.now, true),
      });
      return { ok: true, output };
    }
    case "ticket-status":
      return setStatus(book, clock, data, a.ticket, a.status);
    case "ticket-priority":
      return setPriority(book, clock, data, a.ticket, a.priority, "tech");
    case "ticket-flag-p1":
      return flagP1(book, clock, a.ticket, a.reason);
    case "ticket-note":
      return addNote(book, clock, a.ticket, a.text);
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
