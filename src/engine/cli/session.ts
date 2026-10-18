import { syncSwitchPorts } from "../gen/gear";
import type { Device, Fields, World } from "../model/types";
import { netState } from "../net/state";
import type { CliMode, Dialect } from "../schema";
import { isIp } from "../util/ip";
import { fill } from "../util/template";
import { type FieldDef, formatValue, parseValue } from "./codecs";
import { matchCommand, nextWords } from "./match";
import { pingData, renderView, traceData, viewData } from "./views";

/** One open device CLI session. Plain data so it saves and replays. */
export interface CliSession {
  id: string;
  kind: "device";
  deviceId: string;
  /** The RMM host this SSH session runs from, if any. */
  fromId?: string;
  /** The address typed after ssh. */
  address?: string;
  /** The RMM or ScreenLink shell this SSH session was typed in. */
  parent?: string;
  /** Typed in the laptop terminal over this VPN connection (its id). */
  vpn?: string;
  dialect: string;
  mode: CliMode;
  section?: string; // dialect path, like "system interface"
  /** Section to go back to when leaving an item, for dialects that enter items from config mode. */
  parentSection?: string;
  item?: string;
  staged?: Fields | Record<string, Fields>;
  /** Set while the password prompt is up. */
  login?: { username: string; tries: number };
  /** Last command and its output, for attaching as proof. */
  last?: { line: string; output: string[] };
  /** Recent commands that printed something, oldest first, so earlier output can be attached. */
  outputs?: { line: string; output: string[] }[];
  closed: boolean;
  transcript: string[];
}

type Section = Dialect["sections"][number];

export interface CliContext {
  world: World;
  dialect: Dialect;
  /** Device clock text, like "Tue Oct 20 08:00:00 2026". */
  time: string;
  now: number;
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
  if (s.login) return `${s.login.username}@${s.address ?? dev.ip}'s password: `;
  const sec = sectionDef(ctx.dialect, s.section);
  const tpl = ctx.dialect.prompts[s.mode];
  return fill(tpl, (k) => {
    if (k === "hostname") return dev.hostname;
    if (k === "section") return sec?.prompt ?? s.section?.split(" ").pop();
    if (k === "item") return s.item;
    if (k === "itemPrompt") return fill(sec?.itemPrompt ?? "", (x) => (x === "item" ? s.item : ""));
    return "";
  });
}

function banner(world: World, dialect: Dialect, dev: Device, address?: string): string[] {
  return dialect.banner.map((l) =>
    fill(l, (k) =>
      k === "hostname"
        ? dev.hostname
        : k === "ip"
          ? (address ?? dev.ip)
          : k === "model"
            ? dev.model.replace(/^Aurora CX /, "")
            : k === "firmware"
              ? dev.firmware
              : "",
    ),
  );
}

export interface OpenOptions {
  /** Ask for this user's password first, the way SSH does. */
  username?: string;
  fromId?: string;
  address?: string;
  parent?: string;
  vpn?: string;
}

export function openSession(
  id: string,
  ctx: CliContext,
  deviceId: string,
  opts: OpenOptions = {},
): CliSession {
  const { world, dialect } = ctx;
  const dev = device(world, deviceId);
  const s: CliSession = {
    id,
    kind: "device",
    deviceId,
    dialect: dialect.id,
    mode: "exec",
    closed: false,
    transcript: [],
  };
  if (opts.fromId) s.fromId = opts.fromId;
  if (opts.address) s.address = opts.address;
  if (opts.parent) s.parent = opts.parent;
  if (opts.vpn) s.vpn = opts.vpn;
  if (opts.username) s.login = { username: opts.username, tries: 0 };
  else s.transcript.push(...banner(world, dialect, dev, opts.address));
  s.transcript.push(prompt(s, ctx));
  return s;
}

/** Config text for one section, block style (config/edit/set/next/end). */
function renderBlock(
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

/** Config text, line style (IOS-like): one header per table entry, indented settings. */
function renderLines(dialect: Dialect, dev: Device): string[] {
  const render = dialect.render ?? { style: "lines" };
  const out: string[] = [];
  const lineFor = (model: string, f: Fields, indent: string) => {
    const r = (render as Record<string, unknown>)[model] as
      | Record<string, string | Record<string, string>>
      | undefined;
    const lines: string[] = [];
    for (const [name, def] of Object.entries(dialect.fields[model] ?? {})) {
      const v = f[def.model];
      if (v === undefined) continue;
      const tpl = r?.[name];
      const text =
        typeof tpl === "object"
          ? (tpl[String(v)] ?? "")
          : fill(tpl ?? `${name} {value}`, (k) => (k === "value" ? v : ""));
      if (text) lines.push(`${indent}${text}`);
    }
    return lines;
  };
  for (const sec of dialect.sections) {
    const value = (dev.running?.[sec.model] ?? {}) as Fields | Record<string, Fields>;
    if (sec.kind === "single") {
      out.push(...lineFor(sec.model, value as Fields, ""));
      continue;
    }
    const sel = dialect.commands.find((c) => c.verb === "select" && c.table === sec.path);
    for (const [key, f] of Object.entries(value as Record<string, Fields>)) {
      out.push(
        fill(sel?.words ?? `${sec.path} {name}`, (k) => (k === "name" ? key : "")),
        ...lineFor(sec.model, f, "    "),
      );
    }
  }
  return out;
}

/** Write a staged section into the running config. Fortress-style devices save as they apply. */
function commit(model: string, staged: Fields | Record<string, Fields>, dev: Device): void {
  if (!dev.running) return;
  dev.running[model] = structuredClone(staged);
  afterChange(dev, model);
  dev.startup = structuredClone(dev.running);
}

/** Make the device's live state match its running config, after a boot or a restore. */
export function applyRunning(dev: Device): void {
  afterChange(dev, "system");
}

function afterChange(dev: Device, model: string): void {
  if (model === "system") {
    const host = (dev.running?.system as Fields | undefined)?.hostname;
    if (typeof host === "string") dev.hostname = host;
  }
  if (dev.kind === "switch") syncSwitchPorts(dev);
}

/** Run one line. Mutates the session and the device config. Returns output lines. */
export function runLine(s: CliSession, line: string, ctx: CliContext): string[] {
  const dev = device(ctx.world, s.deviceId);
  const last = s.transcript.length - 1;
  // The prompt is already the last transcript line; finish it with what was typed. Passwords stay hidden.
  if (!s.login) s.transcript[last] = `${s.transcript[last] ?? prompt(s, ctx)}${line}`;
  const out = s.login ? login(s, line, ctx, dev) : execute(s, line, ctx, dev);
  s.transcript.push(...out);
  if (!s.closed) s.transcript.push(prompt(s, ctx));
  return out;
}

function login(s: CliSession, line: string, ctx: CliContext, dev: Device): string[] {
  const auth = s.login as NonNullable<CliSession["login"]>;
  if (
    dev.credentials &&
    !dev.credentials.disabled &&
    auth.username === dev.credentials.username &&
    line === dev.credentials.password
  ) {
    s.login = undefined;
    return banner(ctx.world, ctx.dialect, dev, s.address);
  }
  auth.tries++;
  if (auth.tries >= 3) {
    s.closed = true;
    return [`${auth.username}@${s.address ?? dev.ip}: Permission denied (publickey,password).`];
  }
  return ["Permission denied, please try again."];
}

function leaveConfig(s: CliSession): void {
  s.mode = "exec";
  s.section = undefined;
  s.parentSection = undefined;
  s.item = undefined;
  s.staged = undefined;
}

function execute(s: CliSession, line: string, ctx: CliContext, dev: Device): string[] {
  const { world, dialect } = ctx;
  if (s.closed) return ["Session is closed."];
  const trimmed = line.trim();
  if (trimmed === "") return [];
  const live = dialect.apply === "live";

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
  // Live dialects edit the running config directly; staged ones edit a copy until "end".
  const working = (model: string): Fields | Record<string, Fields> => {
    if (!live) return s.staged as Fields;
    dev.running ??= {};
    dev.running[model] ??= {};
    return dev.running[model] as Fields;
  };

  switch (cmd.verb) {
    case "enter-config": {
      const words = cmd.section ? cmd.section.split(" ") : (args.section ?? []);
      const hit = resolveSection(dialect, words, true);
      if (hit === "ambiguous") return err(dialect, "ambiguous", words.join(" "));
      if (!hit) return err(dialect, "unknown-field", words[words.length - 1]);
      s.mode = "section";
      s.section = hit.section.path;
      s.item = undefined;
      if (!live) s.staged = structuredClone((dev.running?.[hit.section.model] ?? {}) as Fields);
      return [];
    }
    case "select": {
      const target = cmd.table ? sectionDef(dialect, cmd.table) : sec;
      if (!target || target.kind !== "table") return err(dialect, "unknown-command");
      if (cmd.table && s.section !== cmd.table) {
        s.parentSection ??= s.section;
        s.section = cmd.table;
      }
      const table = working(target.model) as Record<string, Fields>;
      let name = (args.name?.[0] ?? "").replace(/^"(.*)"$/, "$1");
      if (target.autoKey && name === "0")
        name = String(Math.max(0, ...Object.keys(table).map(Number).filter(Number.isFinite)) + 1);
      if (!target.autoKey && !/^[\w./-]{1,15}$/.test(name)) return err(dialect, "bad-value", name);
      if (!(name in table)) {
        if (!target.create) {
          if (s.parentSection) s.section = s.parentSection;
          return err(dialect, "no-entry", name);
        }
        table[name] = {};
      }
      s.mode = "item";
      s.item = name;
      return [];
    }
    case "set":
    case "negate": {
      if (!sec) return err(dialect, "unknown-command");
      if (sec.kind === "table" && s.mode !== "item") return err(dialect, "unknown-command");
      const fieldTok = cmd.field ?? args.field?.[0] ?? "";
      const f = resolveField(dialect, sec.model, fieldTok);
      if (f === "ambiguous") return err(dialect, "ambiguous", fieldTok);
      if (!f) return err(dialect, "unknown-field", fieldTok);
      const [, def] = f;
      if (def.readOnly) return err(dialect, "read-only", fieldTok);
      const w = working(sec.model);
      const target =
        sec.kind === "table" ? (w as Record<string, Fields>)[s.item as string] : (w as Fields);
      if (!target) return err(dialect, "no-entry", s.item);
      if (cmd.verb === "negate") {
        delete target[def.model];
      } else {
        const parsed = parseValue(def, cmd.value !== undefined ? [cmd.value] : (args.value ?? []));
        if (!parsed.ok) return err(dialect, parsed.error, parsed.token);
        const v = parsed.value;
        if (
          typeof v === "number" &&
          ((def.min !== undefined && v < def.min) || (def.max !== undefined && v > def.max))
        )
          return err(dialect, "bad-value", String(v));
        const refs = def.refersTo ? (dev.running?.[def.refersTo] ?? {}) : undefined;
        if (refs && !(String(v) in refs))
          return err(dialect, dialect.errors["no-ref"] ? "no-ref" : "no-entry", String(v));
        target[def.model] = v;
      }
      if (live) afterChange(dev, sec.model);
      return [];
    }
    case "exit-item":
      s.mode = "section";
      s.item = undefined;
      if (s.parentSection) {
        s.section = s.parentSection;
        s.parentSection = undefined;
      }
      return [];
    case "exit-config":
      leaveConfig(s);
      return [];
    case "save-exit":
      if (!live && sec && s.staged) commit(sec.model, s.staged, dev);
      leaveConfig(s);
      return [];
    case "discard-exit":
      leaveConfig(s);
      return [];
    case "show": {
      if (dialect.render?.style === "lines") return renderLines(dialect, dev);
      const path = args.path ?? [];
      if (s.mode === "item" && sec && s.staged)
        return renderBlock(dialect, sec, s.staged, s.item)
          .slice(1, -1)
          .map((l) => l.slice(4));
      if (s.mode === "section" && sec && s.staged && path.length === 0)
        return renderBlock(dialect, sec, s.staged);
      if (path.length === 0)
        return dialect.sections.flatMap((x) =>
          renderBlock(dialect, x, (dev.running?.[x.model] ?? {}) as Fields),
        );
      const hit = resolveSection(dialect, path, false);
      if (hit === "ambiguous") return err(dialect, "ambiguous", path.join(" "));
      if (!hit) return err(dialect, "unknown-field", path[path.length - 1]);
      const value = (dev.running?.[hit.section.model] ?? {}) as Fields;
      const only = path[hit.used]?.replace(/^"(.*)"$/, "$1");
      if (only !== undefined && hit.section.kind === "table" && !(only in value))
        return err(dialect, "no-entry", only);
      return renderBlock(dialect, hit.section, value, only);
    }
    case "view":
    case "counters": {
      const view = cmd.view ? dialect.views[cmd.view] : undefined;
      if (!view || !cmd.view) return err(dialect, "unknown-command");
      const data = viewData(cmd.view, { world, device: dev, args, time: ctx.time, now: ctx.now });
      if (!data.ok) return err(dialect, data.error, data.token);
      return renderView(view, data.data);
    }
    case "ping": {
      const target = args.target?.[0] ?? "";
      if (!isIp(target)) return err(dialect, "no-target", target);
      const { reachable, data } = pingData(world, dev, target, netState(world, ctx.now));
      const view = dialect.views[reachable ? "ping-ok" : "ping-fail"];
      return view ? renderView(view, data) : [];
    }
    case "traceroute": {
      const target = args.target?.[0] ?? "";
      if (!isIp(target)) return err(dialect, "no-target", target);
      const view = dialect.views.traceroute;
      return view ? renderView(view, traceData(world, dev, target, netState(world, ctx.now))) : [];
    }
    case "exit-shell":
      s.closed = true;
      return [`Connection to ${s.address ?? dev.hostname} closed.`];
    case "save":
      if (dev.running) dev.startup = structuredClone(dev.running);
      return live ? ["Configuration saved."] : [];
  }
}
