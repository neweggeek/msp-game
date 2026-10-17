import { create } from "zustand";

// UI-only pacing for terminal output. The engine answers at once; this just
// holds lines back so ping replies trickle in and timeouts make you wait.
// Game time and saves never see it.

const PING_INTERVAL = 1000;
const WIN_PING_TIMEOUT = 4000;
const UNIX_PING_FAIL = 5000;
const TRACE_HOP = 400;
const TRACE_TIMEOUT = 3000;
const DNS_TIMEOUT = 2000;
const SSH_TIMEOUT = 5000;
const MIN_FIRST_REPLY = 300;

/** Milliseconds to wait before showing each line. 0 means show with the line before it. */
export function paceDelays(lines: string[]): number[] {
  let replies = 0;
  return lines.map((l) => {
    const rtt = /time[=<]\s*([\d.]+)\s*ms/i.exec(l);
    if (rtt) {
      replies++;
      return replies === 1 ? Math.max(MIN_FIRST_REPLY, Number(rtt[1])) : PING_INTERVAL;
    }
    if (/^Request timed out\./.test(l)) return WIN_PING_TIMEOUT;
    if (/^\s*\d+\s.*Request timed out\./.test(l)) return TRACE_TIMEOUT;
    if (/^\s*\d+\s+\*/.test(l)) return TRACE_TIMEOUT;
    if (/^\s*\d+\s+\S+\s+[\d.]+\s*ms/.test(l) || /^\s*\d+\s+\d+ ms/.test(l)) return TRACE_HOP;
    if (/^--- .* ping statistics ---$/.test(l) && replies === 0) return UNIX_PING_FAIL;
    if (/^DNS request timed out\./.test(l)) return DNS_TIMEOUT;
    if (/^ssh: connect to host .* Connection timed out$/.test(l)) return SSH_TIMEOUT;
    return 0;
  });
}

interface PaceState {
  /** Lines visible per session while output is still coming. Absent means show all. */
  shown: Record<string, number>;
}

export const usePace = create<PaceState>(() => ({ shown: {} }));

const timers: Record<string, ReturnType<typeof setTimeout>> = {};

function setShown(id: string, n: number | undefined) {
  const shown = { ...usePace.getState().shown };
  if (n === undefined) delete shown[id];
  else shown[id] = n;
  usePace.setState({ shown });
}

/** Play out transcript lines from index `from` on, with real-feeling delays. */
export function playOut(id: string, transcript: string[], from: number) {
  skip(id);
  const delays = paceDelays(transcript.slice(from));
  if (delays.every((d) => d === 0)) return;
  const run = (i: number, waited: boolean) => {
    let j = i;
    while (j < delays.length && (delays[j] === 0 || (j === i && waited))) j++;
    if (j >= delays.length) {
      delete timers[id];
      setShown(id, undefined);
      return;
    }
    setShown(id, from + j);
    timers[id] = setTimeout(() => run(j, true), delays[j]);
  };
  run(0, false);
}

/** Show everything now (Ctrl+C, closing the session). */
export function skip(id: string) {
  const t = timers[id];
  if (t) clearTimeout(t);
  delete timers[id];
  if (usePace.getState().shown[id] !== undefined) setShown(id, undefined);
}
