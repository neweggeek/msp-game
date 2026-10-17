import type { Device, Fields, World } from "../model/types";
import type { CliMode, Dialect } from "../schema";
import { isIp } from "../util/ip";
import { fill } from "../util/template";
import { type FieldDef, formatValue, parseValue } from "./codecs";
import { matchCommand, nextWords } from "./match";
import { pingData, renderView, traceData, viewData } from "./views";

/** One open CLI session. Plain data so it saves and replays. */
export interface CliSession {
  id: string;
  deviceId: string;
  dialect: string;
  mode: CliMode;
  section?: string; // dialect path, like "system interface"
  item?: string;
  staged?: Fields | Record<string, Fields>;
  closed: boolean;
  transcript: string[];
}

type Section = Dialect["sections"][number];

export interface CliContext {
  world: World;
  dialect: Dialect;
  time: string;
}

export function tokenize(line: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  for (let m = re.exec(line); m; m = re.exec(line))
    out.push(m[1] !== undefined ? `"${m[1]}"` : (m[2] as string));
  return out;
}

function device(world: World, id: string): Device {
  const d = world.devices.find((x) => x.id === id);
  if (!d) throw new Error(`no device ${id}`);
  return d;
}

function err(dialect: Dialect, key: string, token = ""): string[] {
  return fill(dialect.errors[key] ?? dialect.errors["unknown-command"] ?? "error", (k) =>
    k === "token" ? token : "",
  ).split("\n");
}

function sectionDef(dialect: Dialect, path: string | undefined): Section | undefined {
  return dialect.sections.find((s) => s.path === path);
}

/** Resolve "sys int" style words to a section, allowing unique prefixes. Returns words used. */
function resolveSection(
  dialect: Dialect,
  tokens: string[],
  exact: boolean,
): { section: Section; used: number } | "ambiguous" | null {
  const prefix = dialect.abbreviations === "unique-prefix";
  const hits = dialect.sections
    .map((s) => {
      const words = s.path.split(" ");
      if (tokens.length < words.length || (exact && tokens.length !== words.length)) return null;
      const ok = words.every(
        (w, i) => w === tokens[i] || (prefix && w.startsWith(tokens[i] as string)),
      );
      return ok ? { section: s, used: words.length } : null;
    })
    .filter((x): x is { section: Section; used: number } => x !== null);
  if (hits.length === 1) return hits[0] as { section: Section; used: number };
  const exactHit = hits.find((h) => h.section.path.split(" ").every((w, i) => w === tokens[i]));
  if (exactHit) return exactHit;
  return hits.length > 1 ? "ambiguous" : null;
}

function resolveField(
  dialect: Dialect,
  model: string,
  token: string,
): [string, FieldDef] | "ambiguous" | null {
  const fields = Object.entries(dialect.fields[model] ?? {});
  const exact = fields.find(([name]) => name === token);
  if (exact) return exact;
  if (dialect.abbreviations !== "unique-prefix") return null;
  const hits = fields.filter(([name]) => name.startsWith(token));
  if (hits.length === 1) return hits[0] as [string, FieldDef];
  return hits.length > 1 ? "ambiguous" : null;
}

export function prompt(s: CliSession, ctx: CliContext): string {
  const dev = device(ctx.world, s.deviceId);
  const sec = sectionDef(ctx.dialect, s.section);
  const tpl = ctx.dialect.prompts[s.mode];
  return fill(tpl, (k) =>
    k === "hostname"
      ? dev.hostname
      : k === "section"
        ? (sec?.prompt ?? s.section?.split(" ").pop())
        : k === "item"
          ? s.item
          : "",
  );
}

export function openSession(
  id: string,
  world: World,
  dialect: Dialect,
  deviceId: string,
): CliSession {
  const dev = device(world, deviceId);
  const s: CliSession = {
    id,
    deviceId,
    dialect: dialect.id,
    mode: "exec",
    closed: false,
    transcript: [],
  };
  s.transcript.push(
    ...dialect.banner.map((l) =>
      fill(l, (k) => (k === "hostname" ? dev.hostname : k === "ip" ? dev.ip : "")),
    ),
  );
  s.transcript.push(prompt(s, { world, dialect, time: "" }));
  return s;
}

/** Render a section (or one entry of it) the way the dialect shows config. Block style. */
function renderSection(
  dialect: Dialect,
  sec: Section,
  value: Fields | Record<string, Fields>,
  only?: string,
): string[] {
  const defs = Object.entries(dialect.fields[sec.model] ?? {});
  const setLines = (f: Fields, indent: string) =>
    defs
      .filter(
        ([, d]) =>
          f[d.model] !== undefined &&
          !(Array.isArray(f[d.model]) && (f[d.model] as string[]).length === 0),
      )
      .map(([name, d]) => `${indent}set ${name} ${formatValue(d, f[d.model] as never)}`);
  const out = [`config ${sec.path}`];
  if (sec.kind === "single") {
    out.push(...setLines(value as Fields, "    "));
  } else {
    for (const [key, f] of Object.entries(value as Record<string, Fields>)) {
      if (only !== undefined && key !== only) continue;
      out.push(
        `    edit ${sec.autoKey ? key : `"${key}"`}`,
        ...setLines(f, "        "),
        "    next",
      );
    }
  }
  out.push("end");
  return out;
}

function commit(model: string, staged: Fields | Record<string, Fields>, dev: Device): void {
  if (!dev.running) return;
  dev.running[model] = structuredClone(staged);
  if (model === "system") {
    const host = (staged as Fields).hostname;
    if (typeof host === "string") dev.hostname = host;
  }
  dev.startup = structuredClone(dev.running);
}

/** Run one line. Mutates the session and the device config. Returns output lines. */
export function runLine(s: CliSession, line: string, ctx: CliContext): string[] {
  const dev = device(ctx.world, s.deviceId);
  // The prompt is already the last transcript line; finish it with what was typed.
  const last = s.transcript.length - 1;
  s.transcript[last] = `${s.transcript[last] ?? prompt(s, ctx)}${line}`;
  const out = execute(s, line, ctx, dev);
  s.transcript.push(...out);
  if (!s.closed) s.transcript.push(prompt(s, ctx));
  return out;
}

function execute(s: CliSession, line: string, ctx: CliContext, dev: Device): string[] {
  const { world, dialect } = ctx;
  if (s.closed) return ["Session is closed."];
  const trimmed = line.trim();
  if (trimmed === "") return [];

  if (trimmed.endsWith("?")) {
    const body = trimmed.slice(0, -1);
    const tokens = tokenize(body);
    const partial = body.endsWith(" ") || body === "" ? "" : (tokens.pop() ?? "");
    const words = nextWords(dialect, s.mode, tokens, partial);
    if (words.length === 0) return ["<cr>"];
    return words.map((w) => (w.help ? `${w.word.padEnd(12)} ${w.help}` : w.word));
  }

  const tokens = tokenize(trimmed);
  const res = matchCommand(dialect, s.mode, tokens);
  if (!res.ok) return err(dialect, res.error, res.token);
  const { cmd, args } = res.match;
  const sec = sectionDef(dialect, s.section);

  switch (cmd.verb) {
    case "enter-config": {
      const words = args.section ?? [];
      const hit = resolveSection(dialect, words, true);
      if (hit === "ambiguous") return err(dialect, "ambiguous", words.join(" "));
      if (!hit) return err(dialect, "unknown-field", words[words.length - 1]);
      s.mode = "section";
      s.section = hit.section.path;
      s.staged = structuredClone((dev.running?.[hit.section.model] ?? {}) as Fields);
      if (hit.section.kind === "single") s.item = undefined;
      return [];
    }
    case "select": {
      if (!sec || sec.kind !== "table") return err(dialect, "unknown-command");
      const table = s.staged as Record<string, Fields>;
      let name = (args.name?.[0] ?? "").replace(/^"(.*)"$/, "$1");
      if (sec.autoKey && name === "0")
        name = String(Math.max(0, ...Object.keys(table).map(Number).filter(Number.isFinite)) + 1);
      if (!sec.autoKey && !/^[\w.-]{1,15}$/.test(name)) return err(dialect, "bad-value", name);
      table[name] ??= {};
      s.mode = "item";
      s.item = name;
      return [];
    }
    case "set":
    case "negate": {
      if (!sec) return err(dialect, "unknown-command");
      if (sec.kind === "table" && s.mode !== "item") return err(dialect, "unknown-command");
      const fieldTok = args.field?.[0] ?? "";
      const f = resolveField(dialect, sec.model, fieldTok);
      if (f === "ambiguous") return err(dialect, "ambiguous", fieldTok);
      if (!f) return err(dialect, "unknown-field", fieldTok);
      const [, def] = f;
      if (def.readOnly) return err(dialect, "read-only", fieldTok);
      const target =
        sec.kind === "table"
          ? (s.staged as Record<string, Fields>)[s.item as string]
          : (s.staged as Fields);
      if (!target) return err(dialect, "no-entry");
      if (cmd.verb === "negate") {
        delete target[def.model];
        return [];
      }
      const parsed = parseValue(def, args.value ?? []);
      if (!parsed.ok) return err(dialect, parsed.error, parsed.token);
      target[def.model] = parsed.value;
      return [];
    }
    case "exit-item":
      s.mode = "section";
      s.item = undefined;
      return [];
    case "save-exit":
      if (dialect.save === "on-end" && sec && s.staged) commit(sec.model, s.staged, dev);
      s.mode = "exec";
      s.section = undefined;
      s.item = undefined;
      s.staged = undefined;
      return [];
    case "discard-exit":
      s.mode = "exec";
      s.section = undefined;
      s.item = undefined;
      s.staged = undefined;
      return [];
    case "show": {
      const path = args.path ?? [];
      if (s.mode === "item" && sec && s.staged)
        return renderSection(dialect, sec, s.staged, s.item)
          .slice(1, -1)
          .map((l) => l.slice(4));
      if (s.mode === "section" && sec && s.staged && path.length === 0)
        return renderSection(dialect, sec, s.staged);
      if (path.length === 0) {
        return dialect.sections.flatMap((x) =>
          renderSection(dialect, x, (dev.running?.[x.model] ?? {}) as Fields),
        );
      }
      const hit = resolveSection(dialect, path, false);
      if (hit === "ambiguous") return err(dialect, "ambiguous", path.join(" "));
      if (!hit) return err(dialect, "unknown-field", path[path.length - 1]);
      const value = (dev.running?.[hit.section.model] ?? {}) as Fields;
      const only = path[hit.used]?.replace(/^"(.*)"$/, "$1");
      if (only !== undefined && hit.section.kind === "table" && !(only in value))
        return err(dialect, "no-entry");
      return renderSection(dialect, hit.section, value, only);
    }
    case "view":
    case "counters": {
      const view = cmd.view ? dialect.views[cmd.view] : undefined;
      if (!view || !cmd.view) return err(dialect, "unknown-command");
      const data = viewData(cmd.view, { world, device: dev, args, time: ctx.time });
      if (!data.ok) return err(dialect, data.error, data.token);
      return renderView(view, data.data);
    }
    case "ping": {
      const target = args.target?.[0] ?? "";
      if (!isIp(target)) return err(dialect, "no-target", target);
      const { reachable, data } = pingData(world, dev, target);
      const view = dialect.views[reachable ? "ping-ok" : "ping-fail"];
      return view ? renderView(view, data) : [];
    }
    case "traceroute": {
      const target = args.target?.[0] ?? "";
      if (!isIp(target)) return err(dialect, "no-target", target);
      const view = dialect.views.traceroute;
      return view ? renderView(view, traceData(world, dev, target)) : [];
    }
    case "exit-shell":
      s.closed = true;
      return [`Connection to ${dev.hostname} closed.`];
    case "save":
      if (dev.running) dev.startup = structuredClone(dev.running);
      return [];
  }
}
