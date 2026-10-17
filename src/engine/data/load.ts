import { parse } from "yaml";
import type { z } from "zod";
import {
  type AssetRules,
  type Brand,
  type CalendarRules,
  type CallRules,
  type CaseDef,
  type ClientRules,
  type DeviceTemplate,
  type Dialect,
  type ExtraTicketDef,
  type FaultDef,
  type HandoffRules,
  type KbEntry,
  type RoomTemplate,
  type ScenarioDef,
  type ScriptDef,
  type SlaRules,
  type StalenessRules,
  type TicketRules,
  actionCostSchema,
  assetRulesSchema,
  brandSchema,
  calendarSchema,
  callRulesSchema,
  caseSchema,
  clientRulesSchema,
  deviceTemplateSchema,
  dialectSchema,
  extraTicketSchema,
  faultSchema,
  handoffRulesSchema,
  kbSchema,
  roomTemplateSchema,
  scenarioSchema,
  scriptSchema,
  slaSchema,
  stalenessSchema,
  ticketRulesSchema,
} from "../schema";

export interface GameData {
  brands: Map<string, Brand>;
  devices: Map<string, DeviceTemplate>;
  rooms: Map<string, RoomTemplate>;
  faults: Map<string, FaultDef>;
  cases: Map<string, CaseDef>;
  dialects: Map<string, Dialect>;
  extraTickets: Map<string, ExtraTicketDef>;
  scenarios: Map<string, ScenarioDef>;
  scripts: Map<string, ScriptDef>;
  kb: Map<string, KbEntry>;
  handoffs: HandoffRules;
  actionCosts: Record<string, number>;
  sla: SlaRules;
  tickets: TicketRules;
  calendar: CalendarRules;
  staleness: StalenessRules;
  clients: ClientRules;
  assets: AssetRules;
  calls: CallRules;
}

/** Raw YAML text keyed by path, like "../../../data/devices/fortress.yaml". */
export type RawFiles = Record<string, string>;

export class DataError extends Error {}

function parseFile(path: string, text: string): unknown {
  try {
    return parse(text);
  } catch (err) {
    throw new DataError(`${path}: YAML error: ${(err as Error).message}`);
  }
}

function check<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, value: unknown, where: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    const at = issue?.path.join(".") || "(root)";
    throw new DataError(`${where}: ${at}: ${issue?.message}`);
  }
  return result.data;
}

function folder(files: RawFiles, name: string): [string, string][] {
  return Object.entries(files)
    .filter(([p]) => p.includes(`/data/${name}/`))
    .sort(([a], [b]) => a.localeCompare(b));
}

function listFolder<T extends { id: string }>(
  files: RawFiles,
  name: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
): Map<string, T> {
  const out = new Map<string, T>();
  for (const [path, text] of folder(files, name)) {
    const value = parseFile(path, text);
    const items = name === "dialects" ? [value] : value;
    if (!Array.isArray(items)) throw new DataError(`${path}: expected a list`);
    items.forEach((item, i) => {
      const where = `${path} [${i}${(item as { id?: string })?.id ? ` ${(item as { id: string }).id}` : ""}]`;
      const rec = check(schema, item, where);
      if (out.has(rec.id)) throw new DataError(`${where}: duplicate id ${rec.id}`);
      out.set(rec.id, rec);
    });
  }
  return out;
}

function rule<T>(files: RawFiles, file: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): T {
  const entry = folder(files, "rules").find(([p]) => p.endsWith(`/${file}.yaml`));
  if (!entry) throw new DataError(`missing data/rules/${file}.yaml`);
  return check(schema, parseFile(entry[0], entry[1]), entry[0]);
}

/** Parse and validate every data file, then check cross references. */
export function loadData(files: RawFiles): GameData {
  const data: GameData = {
    brands: listFolder(files, "brands", brandSchema),
    devices: listFolder(files, "devices", deviceTemplateSchema),
    rooms: listFolder(files, "rooms", roomTemplateSchema),
    faults: listFolder(files, "faults", faultSchema),
    cases: listFolder(files, "cases", caseSchema),
    dialects: listFolder(files, "dialects", dialectSchema),
    extraTickets: listFolder(files, "tickets", extraTicketSchema),
    scenarios: listFolder(files, "scenarios", scenarioSchema),
    scripts: listFolder(files, "rmm", scriptSchema),
    kb: listFolder(files, "kb", kbSchema),
    handoffs: rule(files, "handoffs", handoffRulesSchema),
    actionCosts: rule(files, "actions", actionCostSchema),
    sla: rule(files, "sla", slaSchema),
    tickets: rule(files, "tickets", ticketRulesSchema),
    calendar: rule(files, "calendar", calendarSchema),
    staleness: rule(files, "staleness", stalenessSchema),
    clients: rule(files, "clients", clientRulesSchema),
    assets: rule(files, "assets", assetRulesSchema),
    calls: rule(files, "calls", callRulesSchema),
  };
  for (const t of data.devices.values()) {
    if (!data.brands.has(t.brand)) throw new DataError(`device ${t.id}: unknown brand ${t.brand}`);
    if (t.dialect && !data.dialects.has(t.dialect))
      throw new DataError(`device ${t.id}: unknown dialect ${t.dialect}`);
  }
  for (const f of data.faults.values()) {
    for (const e of f.effects) {
      if (e.type === "add-endpoints" && !data.devices.has(e.template)) {
        throw new DataError(`fault ${f.id}: unknown device template ${e.template}`);
      }
    }
  }
  for (const c of data.cases.values()) {
    for (const f of c.faults)
      if (!data.faults.has(f)) throw new DataError(`case ${c.id}: unknown fault ${f}`);
  }
  const factAsks = data.calls.asks.filter((a) => a.kind === "fact").map((a) => a.id);
  for (const c of data.cases.values()) {
    for (const k of Object.keys(c.call?.facts ?? {}))
      if (!factAsks.includes(k))
        throw new DataError(`case ${c.id}: no fact ask ${k} in calls.yaml`);
    for (const f of c.call?.fixes ?? []) {
      const role = f.unlockedBy.startsWith("power:") ? f.unlockedBy.slice(6) : undefined;
      if (role ? !c.roles[role] : !factAsks.includes(f.unlockedBy))
        throw new DataError(`case ${c.id}: fix ${f.id} hangs on unknown fact ${f.unlockedBy}`);
      for (const r of f.roles)
        if (!c.roles[r]) throw new DataError(`case ${c.id}: fix ${f.id} names unknown role ${r}`);
    }
  }
  for (const ind of data.clients.industries) {
    if (!data.rooms.has(ind.rooms))
      throw new DataError(`industry ${ind.id}: unknown room set ${ind.rooms}`);
  }
  const kinds = data.assets.types.flatMap((t) => t.kinds);
  for (const k of new Set(kinds))
    if (kinds.filter((x) => x === k).length > 1)
      throw new DataError(`assets.yaml: kind ${k} is in more than one type`);
  for (const t of data.devices.values())
    if (!kinds.includes(t.kind))
      throw new DataError(`device ${t.id}: kind ${t.kind} has no type in assets.yaml`);
  if (!data.tickets.statuses.some((s) => s.initial))
    throw new DataError("tickets.yaml: no initial status");
  return data;
}
