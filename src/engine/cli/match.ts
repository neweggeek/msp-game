import type { CliMode, Dialect } from "../schema";

type Pat = { lit: string } | { ph: string; rest: "+" | "*" | null };
type Command = Dialect["commands"][number];

export interface Match {
  cmd: Command;
  args: Record<string, string[]>;
}

export type MatchResult =
  | { ok: true; match: Match }
  | { ok: false; error: "unknown-command" | "ambiguous" | "missing-arg"; token?: string };

function patterns(words: string): Pat[] {
  return words.split(/\s+/).map((w) => {
    const m = w.match(/^\{(\w+)([+*])?\}$/);
    return m ? { ph: m[1] as string, rest: (m[2] as "+" | "*" | undefined) ?? null } : { lit: w };
  });
}

interface Cand {
  cmd: Command;
  pats: Pat[];
  pi: number;
  args: Record<string, string[]>;
  lits: number;
}

/** Pick the literal a token means: exact first, then a unique prefix if the dialect allows it. */
function resolveLiteral(
  token: string,
  lits: string[],
  prefix: boolean,
): string | "ambiguous" | null {
  if (lits.includes(token)) return token;
  if (!prefix) return null;
  const hits = [...new Set(lits.filter((l) => l.startsWith(token)))];
  if (hits.length === 1) return hits[0] as string;
  return hits.length > 1 ? "ambiguous" : null;
}

export function matchCommand(dialect: Dialect, mode: CliMode, tokens: string[]): MatchResult {
  const prefix = dialect.abbreviations === "unique-prefix";
  let cands: Cand[] = dialect.commands
    .filter((c) => c.modes.includes(mode))
    .map((c) => ({ cmd: c, pats: patterns(c.words), pi: 0, args: {}, lits: 0 }));

  for (const token of tokens) {
    const litCands = cands.filter((c) => {
      const p = c.pats[c.pi];
      return p && "lit" in p;
    });
    const lits = litCands.map((c) => (c.pats[c.pi] as { lit: string }).lit);
    const chosen = resolveLiteral(token, lits, prefix);
    if (chosen === "ambiguous") return { ok: false, error: "ambiguous", token };

    const next: Cand[] = [];
    for (const c of cands) {
      const p = c.pats[c.pi];
      if (!p) {
        const last = c.pats[c.pats.length - 1];
        if (last && "ph" in last && last.rest) {
          next.push({ ...c, args: { ...c.args, [last.ph]: [...(c.args[last.ph] ?? []), token] } });
        }
        continue;
      }
      if ("lit" in p) {
        if (chosen && p.lit === chosen) next.push({ ...c, pi: c.pi + 1, lits: c.lits + 1 });
        continue;
      }
      // A literal match beats a placeholder at the same spot.
      if (chosen) continue;
      const args = { ...c.args, [p.ph]: [...(c.args[p.ph] ?? []), token] };
      next.push({ ...c, args, pi: c.pi + 1 });
    }
    if (next.length === 0) return { ok: false, error: "unknown-command", token };
    cands = next;
  }

  const complete = cands.filter((c) =>
    c.pats.slice(c.pi).every((p) => "ph" in p && p.rest === "*"),
  );
  if (complete.length === 0) {
    // Every word matched the start of some command, so the line is cut short, not wrong.
    const needsArg = tokens.length > 0 && cands.length > 0;
    return { ok: false, error: needsArg ? "missing-arg" : "unknown-command" };
  }
  complete.sort((a, b) => b.lits - a.lits);
  const best = complete[0] as Cand;
  for (const p of best.pats) if ("ph" in p) best.args[p.ph] ??= [];
  return { ok: true, match: { cmd: best.cmd, args: best.args } };
}

/** Words that can come next, for "?" help. */
export function nextWords(
  dialect: Dialect,
  mode: CliMode,
  tokens: string[],
  partial: string,
): { word: string; help: string }[] {
  const out = new Map<string, string>();
  for (const c of dialect.commands.filter((x) => x.modes.includes(mode))) {
    const pats = patterns(c.words);
    let ok = true;
    for (let i = 0; i < tokens.length; i++) {
      const p = pats[i];
      const t = tokens[i] as string;
      if (!p) {
        const last = pats[pats.length - 1];
        ok = !!last && "ph" in last && !!last.rest;
        break;
      }
      if (
        "lit" in p &&
        !(p.lit === t || (dialect.abbreviations === "unique-prefix" && p.lit.startsWith(t)))
      ) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    const p = pats[Math.min(tokens.length, pats.length - 1)];
    if (!p || tokens.length > pats.length) continue;
    const word = "lit" in p ? p.lit : `<${p.ph}>`;
    if ("lit" in p && partial && !p.lit.startsWith(partial)) continue;
    if (!out.has(word))
      out.set(word, tokens.length === 0 ? (dialect.keywords[word] ?? c.help) : "");
  }
  return [...out.entries()].map(([word, help]) => ({ word, help }));
}
