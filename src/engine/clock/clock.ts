import type { CalendarRules } from "../schema";

/** Game time is whole minutes since the epoch (a Monday at 00:00). No wall clock, so replays are exact. */
export interface Timer {
  id: number;
  at: number;
  kind: string;
  payload: Record<string, string | number>;
}

export interface ClockState {
  now: number;
  timers: Timer[];
  nextTimerId: number;
}

export const DAY = 1440;

export function newClock(start: number): ClockState {
  return { now: start, timers: [], nextTimerId: 1 };
}

export function schedule(
  clock: ClockState,
  at: number,
  kind: string,
  payload: Timer["payload"],
): number {
  const id = clock.nextTimerId++;
  clock.timers.push({ id, at: Math.max(at, clock.now), kind, payload });
  return id;
}

/**
 * Move time forward, firing timers in order. A handler may schedule more timers;
 * those fire too if they land before the target.
 */
export function advance(clock: ClockState, minutes: number, fire: (t: Timer) => void): void {
  const target = clock.now + Math.max(0, Math.floor(minutes));
  for (;;) {
    let next: Timer | undefined;
    for (const t of clock.timers)
      if (t.at <= target && (!next || t.at < next.at || (t.at === next.at && t.id < next.id)))
        next = t;
    if (!next) break;
    clock.timers = clock.timers.filter((t) => t !== next);
    clock.now = next.at;
    fire(next);
  }
  clock.now = target;
}

export const dayIndex = (min: number) => Math.floor(min / DAY);
export const dayOfWeek = (min: number) => ((dayIndex(min) % 7) + 7) % 7; // 0 = Monday
export const minuteOfDay = (min: number) => ((min % DAY) + DAY) % DAY;

export function isWorkDay(cal: CalendarRules, min: number): boolean {
  return cal.workDays.includes(dayOfWeek(min));
}

export function isBusinessTime(cal: CalendarRules, min: number): boolean {
  const m = minuteOfDay(min);
  return isWorkDay(cal, min) && m >= cal.mspHours.start && m < cal.mspHours.end;
}

/** Add minutes that only count during MSP business hours. */
export function addBusinessMinutes(cal: CalendarRules, start: number, minutes: number): number {
  let t = start;
  let left = minutes;
  // Walk day by day so a long span stays cheap.
  for (let guard = 0; guard < 10000 && left > 0; guard++) {
    const day = dayIndex(t) * DAY;
    if (!isWorkDay(cal, t) || minuteOfDay(t) >= cal.mspHours.end) {
      t = day + DAY + cal.mspHours.start;
      continue;
    }
    if (minuteOfDay(t) < cal.mspHours.start) t = day + cal.mspHours.start;
    const room = day + cal.mspHours.end - t;
    if (left <= room) return t + left;
    left -= room;
    t = day + DAY + cal.mspHours.start;
  }
  return t;
}

/** End of business on the Nth work day after start. */
export function endOfBusinessDays(cal: CalendarRules, start: number, days: number): number {
  let d = dayIndex(start);
  let counted = 0;
  while (counted < days) {
    d++;
    if (cal.workDays.includes(d % 7)) counted++;
  }
  return d * DAY + cal.mspHours.end;
}

const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Tue Oct 20 08:00" from game minutes. */
export function formatTime(cal: CalendarRules, min: number, seconds = false): string {
  const epoch = Date.parse(`${cal.epochDate}T00:00:00Z`);
  const d = new Date(epoch + dayIndex(min) * 86400000);
  const m = minuteOfDay(min);
  const hh = String(Math.floor(m / 60)).padStart(2, "0");
  const mm = String(m % 60).padStart(2, "0");
  const time = seconds ? `${hh}:${mm}:00 ${d.getUTCFullYear()}` : `${hh}:${mm}`;
  return `${weekdays[dayOfWeek(min)]} ${months[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, "0")} ${time}`;
}
