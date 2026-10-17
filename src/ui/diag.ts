import { GENERATOR_VERSION, type GameState, formatTime } from "../engine";

// In-game diagnostics. Catches errors, warnings, failed actions and the
// action trail, keeps the last few hundred in localStorage so they survive a
// crash and reload, and builds one text report the player can copy or save.

export type Level = "error" | "warn" | "info" | "action" | "bug";

export interface DiagEntry {
  at: string;
  level: Level;
  text: string;
}

export interface BugReport {
  at: string;
  text: string;
  /** What the game looked like when it was filed: tab, ticket, terminal tail and so on. */
  context: string[];
}

const KEY = "msp-diagnostics";
const BUG_KEY = "msp-bug-reports";
const MAX = 400;
const MAX_BUGS = 30;

let entries: DiagEntry[] = load(KEY, MAX);
let bugs: BugReport[] = load(BUG_KEY, MAX_BUGS);
let installed = false;

function load<T>(key: string, max: number): T[] {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? (JSON.parse(raw) as T[]).slice(-max) : [];
  } catch {
    return [];
  }
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function flush() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = undefined;
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(entries));
    globalThis.localStorage?.setItem(BUG_KEY, JSON.stringify(bugs));
  } catch {
    /* Storage full or blocked. The in-memory log still works. */
  }
}
function persist() {
  if (!saveTimer) saveTimer = setTimeout(flush, 500);
}

export function diag(level: Level, text: string) {
  entries.push({ at: new Date().toISOString(), level, text: text.slice(0, 4000) });
  if (entries.length > MAX) entries = entries.slice(-MAX);
  persist();
}

/** File a player bug report. Kept apart from the rolling log so it is never trimmed away. */
export function reportBug(text: string, context: string[]) {
  bugs.push({ at: new Date().toISOString(), text, context });
  if (bugs.length > MAX_BUGS) bugs = bugs.slice(-MAX_BUGS);
  diag("bug", text);
  flush();
}

export function bugCount() {
  return bugs.length;
}

export function errorText(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}${e.stack ? `\n${e.stack}` : ""}`;
  try {
    return typeof e === "string" ? e : JSON.stringify(e);
  } catch {
    return String(e);
  }
}

export function diagCounts() {
  return {
    errors: entries.filter((e) => e.level === "error").length,
    warnings: entries.filter((e) => e.level === "warn").length,
  };
}

export function clearDiag() {
  entries = [];
  bugs = [];
  persist();
}

/** Hook window errors, unhandled promise rejections and console warnings. Safe to call twice. */
export function installDiag() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("pagehide", flush);
  diag("info", `Session start. ${navigator.userAgent}`);
  window.addEventListener("error", (e) =>
    diag("error", `Uncaught ${errorText(e.error ?? e.message)} at ${e.filename}:${e.lineno}`),
  );
  window.addEventListener("unhandledrejection", (e) =>
    diag("error", `Unhandled rejection ${errorText(e.reason)}`),
  );
  for (const level of ["error", "warn"] as const) {
    const orig = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      diag(level, args.map((a) => (typeof a === "string" ? a : errorText(a))).join(" "));
      orig(...args);
    };
  }
}

/** One plain-text report: build info, game state summary, log, and the action log for a replay. */
export function diagReport(game: GameState | null, calendar?: Parameters<typeof formatTime>[0]) {
  const lines = [
    "MSP game diagnostics",
    `Made: ${new Date().toISOString()}`,
    `Generator: v${GENERATOR_VERSION}`,
    `Page: ${typeof location === "undefined" ? "" : location.href}`,
    `Browser: ${typeof navigator === "undefined" ? "" : navigator.userAgent}`,
  ];
  if (game) {
    lines.push(
      `Seed: ${game.seed}`,
      `Scenario: ${game.scenario ?? ""}${game.caseId ? ` case ${game.caseId}` : ""}`,
      `Client: ${game.world.client.name}`,
      `Game time: ${calendar ? formatTime(calendar, game.clock.now) : game.clock.now}`,
      `Actions: ${game.log.length}`,
      `Open tickets: ${game.book.tickets.filter((t) => t.closedAt === undefined).length}`,
    );
  }
  if (bugs.length) {
    lines.push("", `--- Bug reports (${bugs.length}) ---`);
    bugs.forEach((b, i) => {
      lines.push("", `#${i + 1} ${b.at}`, b.text, ...b.context.map((c) => `  ${c}`));
    });
  }
  lines.push("", `--- Log (last ${entries.length}) ---`);
  for (const e of entries) lines.push(`${e.at} ${e.level.toUpperCase()} ${e.text}`);
  if (game) {
    lines.push("", "--- Action log (replays this game) ---");
    try {
      lines.push(JSON.stringify(game.log));
    } catch (e) {
      lines.push(errorText(e));
    }
  }
  return lines.join("\n");
}
