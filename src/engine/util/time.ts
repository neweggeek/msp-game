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
