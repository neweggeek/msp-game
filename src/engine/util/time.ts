/** "2d 10:30" -> minutes since the epoch. Day 0 is the Monday epoch, negative days go back. */
export function parseGameTime(text: string): number {
  const m = text.match(/^(-?\d+)d (\d{2}):(\d{2})$/);
  if (!m) throw new Error(`bad game time ${text}`);
  return Number(m[1]) * 1440 + Number(m[2]) * 60 + Number(m[3]);
}

/** "22:04" -> minute of the day. */
export function parseClock(text: string): number {
  const [h, m] = text.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Is a nightly window (which may wrap midnight) active at this game minute? */
export function inDailyWindow(now: number, window: { from: number; to: number }): boolean {
  const m = ((now % 1440) + 1440) % 1440;
  return window.from <= window.to
    ? m >= window.from && m < window.to
    : m >= window.from || m < window.to;
}

/** A window that opens at `from` on each listed weekday (0 is Monday) and may run past midnight. */
export interface DayWindow {
  days: number[];
  from: number;
  to: number;
}

const windowLength = (w: DayWindow) => (w.to - w.from + 1440) % 1440 || 1440;
const weekday = (min: number) => ((Math.floor(min / 1440) % 7) + 7) % 7;

/** Is the window open at this game minute? */
export function inDayWindow(now: number, w: DayWindow): boolean {
  const today = Math.floor(now / 1440) * 1440;
  for (const start of [today + w.from, today - 1440 + w.from])
    if (w.days.includes(weekday(start)) && now >= start && now < start + windowLength(w))
      return true;
  return false;
}

/** The most recent close of the window at or before now, looking back up to a week. */
export function lastWindowEnd(now: number, w: DayWindow): number | undefined {
  const today = Math.floor(now / 1440) * 1440;
  for (let k = 0; k <= 8; k++) {
    const start = today - k * 1440 + w.from;
    const end = start + windowLength(w);
    if (w.days.includes(weekday(start)) && end <= now) return end;
  }
  return undefined;
}
