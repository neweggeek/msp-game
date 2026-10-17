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

/** Is a weekly window (day 0 is Monday, same-day only) active at this game minute? */
export function inWeeklyWindow(now: number, w: { day: number; from: number; to: number }): boolean {
  const day = ((Math.floor(now / 1440) % 7) + 7) % 7;
  const m = ((now % 1440) + 1440) % 1440;
  return day === w.day && m >= w.from && m < w.to;
}

/** The most recent end of a weekly window at or before now, or undefined. */
export function lastWeeklyEnd(
  now: number,
  w: { day: number; from: number; to: number },
): number | undefined {
  const week = 7 * 1440;
  const firstMonday = Math.floor(now / week) * week;
  for (let k = 0; k < 2; k++) {
    const end = firstMonday - k * week + w.day * 1440 + w.to;
    if (end <= now) return end;
  }
  return undefined;
}
