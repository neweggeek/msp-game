import { z } from "zod";

const range = z.tuple([z.number(), z.number()]);
export const tierSchema = z.enum(["low", "mid", "high"]);
export const deviceKindSchema = z.enum([
  "firewall",
  "switch",
  "ap",
  "phone",
  "camera",
  "pc",
  "server",
]);

export const brandSchema = z.object({
  id: z.string(),
  name: z.string(),
  vpnClient: z.string().optional(),
  dialect: z.string().optional(),
});

export const deviceTemplateSchema = z.object({
  id: z.string(),
  kind: deviceKindSchema,
  brand: z.string(),
  model: z.string(),
  dialect: z.string().optional(),
  tiers: z.array(tierSchema).min(1),
  firmware: z.array(z.string()).min(1),
  credentials: z.object({ username: z.string() }).optional(),
  poeBudgetW: z.number().optional(),
  poe: z.object({ class: z.number().int().min(0).max(8), drawW: z.number() }).optional(),
  rmmAgent: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  ports: z
    .array(
      z.object({
        pattern: z.string(),
        from: z.number().int(),
        to: z.number().int(),
        role: z.enum(["wan", "lan", "uplink"]).optional(),
        poe: z.boolean().optional(),
      }),
    )
    .min(1),
});

export const roomTemplateSchema = z.object({
  id: z.string(),
  industry: z.string(),
  rooms: z.array(
    z.object({
      type: z.string(),
      name: z.string(),
      count: range,
      pcs: range,
      phones: range,
      ap: z.number().min(0).max(1),
      networkCloset: z.boolean().optional(),
    }),
  ),
});

/** "docs", "monitoring", "rmm", or "ssh:<role>" / "rmm:<role>" for one bound device. */
export const accessTokenSchema = z.string().regex(/^(docs|rmm|monitoring|(ssh|rmm):[a-z-]+)$/);
/** "<day>d HH:MM", day 0 is the Monday epoch. Negative days are before it. */
export const gameTimeSchema = z.string().regex(/^-?\d+d \d{2}:\d{2}$/);
const clock = z.string().regex(/^\d{2}:\d{2}$/);

const effectSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("set-poe-priority-all"),
    target: z.string(),
    value: z.enum(["low", "high", "critical"]),
  }),
  z.object({
    type: z.literal("add-endpoints"),
    target: z.string(),
    template: z.string(),
    count: z.number().int().min(1),
    label: z.string(),
  }),
  z.object({ type: z.literal("set-dns"), target: z.string(), servers: z.array(z.string()).min(1) }),
  z.object({ type: z.literal("sleep-nightly"), target: z.string(), from: clock, to: clock }),
  z.object({ type: z.literal("change-wan-ip"), target: z.string() }),
  z.object({ type: z.literal("mangle-phase2"), target: z.string() }),
]);

const proofSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("poe-denied"), kind: deviceKindSchema }),
  z.object({ type: z.literal("tunnel-down"), role: z.string() }),
]);

export const checkSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("device-online"), role: z.string() }),
  z.object({ type: z.literal("tunnel-up"), role: z.string() }),
  z.object({ type: z.literal("dns-internal"), role: z.string() }),
  z.object({ type: z.literal("no-sleep"), role: z.string() }),
]);

export const faultSchema = z.object({
  id: z.string(),
  name: z.string(),
  layer: z.number().int().min(1).max(8),
  device: deviceKindSchema,
  startedAt: gameTimeSchema,
  effects: z.array(effectSchema).min(1),
  proof: z.array(proofSchema),
  clues: z
    .array(
      z.object({
        id: z.string(),
        text: z.string(),
        surface: z.enum(["monitoring", "cli", "docs", "rmm", "ticket"]),
        requires: accessTokenSchema,
      }),
    )
    .min(1),
});

const priority = z.enum(["P1", "P2", "P3", "P4"]);
const origin = z.enum(["client", "alert", "tech"]);

export const caseSchema = z.object({
  id: z.string(),
  name: z.string(),
  pick: z.enum(["first-slice", "later", "cut"]),
  playbook: z.string(),
  requires: z.object({
    sites: z.array(z.string()).min(1),
    kinds: z.record(deviceKindSchema, z.number().int()),
    probe: z.boolean().optional(),
  }),
  roles: z.record(
    z.object({
      kind: deviceKindSchema,
      site: z.string(),
      tag: z.string().optional(),
      hasUser: z.boolean().optional(),
      pick: z.enum(["first", "random"]).default("first"),
    }),
  ),
  primary: z.string(),
  ticket: z.object({
    origin,
    priority,
    title: z.string(),
    body: z.string(),
    history: z
      .array(z.object({ at: gameTimeSchema, by: z.string(), text: z.string() }))
      .default([]),
  }),
  faults: z.array(z.string()).min(1),
  fixed: z.array(checkSchema).min(1),
  redHerring: z.string(),
  rootCause: z.string(),
  fix: z.string(),
  note: z.object({
    issue: z.string(),
    findings: z.string(),
    changes: z.string(),
    rootCause: z.string(),
    nextSteps: z.string(),
    wrongCause: z.string(),
    wrongChange: z.string(),
  }),
});

export const extraTicketSchema = z.object({
  id: z.string(),
  kind: z.enum(["misroute", "duplicate", "nothing"]),
  origin,
  priority,
  title: z.string(),
  body: z.string(),
  sendBack: z.enum(["misrouted", "duplicate", "nothing"]),
  duplicateOf: z.string().optional(),
  hint: z.string(),
});

export const scenarioSchema = z.object({
  id: z.string(),
  name: z.string(),
  sites: z.array(z.enum(["hq", "branch"])).min(1),
  tier: z.enum(["low", "mid", "high"]).optional(),
  switchBrand: z.string().optional(),
  probe: z.boolean().optional(),
  cases: z.array(z.string()),
  extraTickets: z.array(z.string()),
});

export const scriptSchema = z.object({
  id: z.string(),
  name: z.string(),
  minutes: z.number().int().min(0),
  effect: z.enum(["reset-dns", "no-sleep", "none"]),
  description: z.string(),
});

export const kbSchema = z.object({
  id: z.string(),
  brand: z.string(),
  type: z.enum(["cli", "release-notes", "compat", "defaults", "naming"]),
  title: z.string(),
  body: z.array(z.string()).min(1),
});

const followUp = z.object({ afterMinutes: z.number(), status: z.string(), text: z.string() });
export const handoffRulesSchema = z.object({
  handoffs: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      detail: z.string(),
      status: z.string().optional(),
      dispatch: z.string().optional(),
      followUp: followUp.optional(),
    }),
  ),
  sendBack: z.array(z.object({ id: z.string(), name: z.string() })),
  notes: z.object({
    good: z.string(),
    vague: z.array(z.string()).min(1),
    jargon: z.array(z.string()).min(1),
  }),
  summaries: z.record(z.string()),
  scoring: z.record(z.number()),
});

export const actionCostSchema = z.record(z.number().int().min(0));

const codecSchema = z.enum([
  "string",
  "quoted",
  "int",
  "enum",
  "list",
  "ip",
  "ip-mask",
  "bool",
  "secret",
]);

const viewNodeSchema: z.ZodType<ViewNode> = z.lazy(() =>
  z.object({
    lines: z.array(z.string()).optional(),
    rows: z.string().optional(),
    each: viewNodeSchema.optional(),
    footer: z.array(z.string()).optional(),
    empty: z.string().optional(),
  }),
);
export interface ViewNode {
  lines?: string[];
  rows?: string;
  each?: ViewNode;
  footer?: string[];
  empty?: string;
}

export const baseVerbs = [
  "enter-config",
  "select",
  "set",
  "negate",
  "exit-item",
  "exit-config",
  "save-exit",
  "discard-exit",
  "save",
  "show",
  "view",
  "counters",
  "ping",
  "traceroute",
  "exit-shell",
] as const;
export const cliModeSchema = z.enum(["exec", "section", "item"]);

export const dialectSchema = z.object({
  id: z.string(),
  name: z.string(),
  abbreviations: z.enum(["unique-prefix", "none"]),
  apply: z.enum(["on-end", "live"]),
  banner: z.array(z.string()),
  prompts: z.object({ exec: z.string(), section: z.string(), item: z.string() }),
  sections: z.array(
    z.object({
      path: z.string(),
      model: z.string(),
      kind: z.enum(["single", "table"]),
      prompt: z.string().optional(),
      itemPrompt: z.string().optional(),
      autoKey: z.boolean().optional(),
      create: z.boolean().default(true),
    }),
  ),
  fields: z.record(
    z.record(
      z.object({
        model: z.string(),
        codec: codecSchema,
        values: z.array(z.string()).optional(),
        readOnly: z.boolean().optional(),
      }),
    ),
  ),
  render: z
    .object({ style: z.literal("lines") })
    .catchall(z.record(z.union([z.string(), z.record(z.string())])))
    .optional(),
  keywords: z.record(z.string()).default({}),
  commands: z.array(
    z.object({
      words: z.string(),
      verb: z.enum(baseVerbs),
      view: z.string().optional(),
      section: z.string().optional(),
      table: z.string().optional(),
      field: z.string().optional(),
      value: z.string().optional(),
      modes: z.array(cliModeSchema).min(1),
      help: z.string(),
    }),
  ),
  errors: z.record(z.string()),
  views: z.record(viewNodeSchema),
});

const slaEntry = z.object({
  responseMinutes: z.number(),
  resolveMinutes: z.number().optional(),
  resolveBusinessDays: z.number().optional(),
  clock: z.enum(["wall", "business"]),
});
export const slaSchema = z.object({ P1: slaEntry, P2: slaEntry, P3: slaEntry, P4: slaEntry });

export const ticketRulesSchema = z.object({
  statuses: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      initial: z.boolean().optional(),
      automatic: z.boolean().optional(),
      final: z.boolean().optional(),
    }),
  ),
  techPriorities: z.array(z.enum(["P1", "P2", "P3", "P4"])),
  aging: z.object({ followUpAfterDays: z.number(), p1AfterBusinessDays: z.number() }),
});

export const calendarSchema = z.object({
  epochDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startMinute: z.number().int(),
  mspHours: z.object({ start: z.number(), end: z.number() }),
  workDays: z.array(z.number().int().min(0).max(6)),
});

export const assetRulesSchema = z.object({
  types: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        kinds: z.array(deviceKindSchema).min(1),
        connect: z.string().optional(),
      }),
    )
    .min(1),
  wifi: z.object({
    label: z.string(),
    networks: z.array(
      z.object({
        ssid: z.string(),
        vlan: z.enum(["data", "voice", "mgmt"]),
        security: z.string(),
        notes: z.string().optional(),
      }),
    ),
  }),
});

const stalenessLevel = z.object({
  wrongIp: z.number(),
  missingDevice: z.number(),
  missingCredential: z.number(),
  wrongFirmware: z.number(),
});
export const stalenessSchema = z.object({
  levels: z.object({ fresh: stalenessLevel, partly: stalenessLevel, stale: stalenessLevel }),
  byTier: z.record(
    tierSchema,
    z.object({ fresh: z.number(), partly: z.number(), stale: z.number() }),
  ),
});

const window = z.object({ start: z.number(), end: z.number(), weight: z.number() });
export const clientRulesSchema = z.object({
  tiers: z.record(tierSchema, z.object({ weight: z.number(), headcount: range })),
  industries: z.array(
    z.object({ id: z.string(), rooms: z.string(), names: z.array(z.string()).min(1) }),
  ),
  places: z.array(z.string()).min(1),
  firstNames: z.array(z.string()).min(1),
  lastNames: z.array(z.string()).min(1),
  contactRoles: z.array(z.string()).min(1),
  afterHoursWindows: z.array(window.extend({ label: z.string() })).min(1),
  businessHours: z.array(window).min(1),
  contactPreference: z.record(z.enum(["quick-call-ok", "scheduled-only"]), z.number()),
  lan: z.object({
    vlans: z.array(
      z.object({
        id: z.number().int(),
        name: z.string(),
        subnet: z.string(),
        role: z.enum(["data", "voice", "mgmt"]),
      }),
    ),
  }),
});

export type Brand = z.infer<typeof brandSchema>;
export type ExtraTicketDef = z.infer<typeof extraTicketSchema>;
export type ScenarioDef = z.infer<typeof scenarioSchema>;
export type ScriptDef = z.infer<typeof scriptSchema>;
export type KbEntry = z.infer<typeof kbSchema>;
export type HandoffRules = z.infer<typeof handoffRulesSchema>;
export type CheckDef = z.infer<typeof checkSchema>;
export type DeviceTemplate = z.infer<typeof deviceTemplateSchema>;
export type RoomTemplate = z.infer<typeof roomTemplateSchema>;
export type FaultDef = z.infer<typeof faultSchema>;
export type CaseDef = z.infer<typeof caseSchema>;
export type Dialect = z.infer<typeof dialectSchema>;
export type SlaRules = z.infer<typeof slaSchema>;
export type TicketRules = z.infer<typeof ticketRulesSchema>;
export type CalendarRules = z.infer<typeof calendarSchema>;
export type AssetRules = z.infer<typeof assetRulesSchema>;
export type StalenessRules = z.infer<typeof stalenessSchema>;
export type ClientRules = z.infer<typeof clientRulesSchema>;
export type BaseVerb = (typeof baseVerbs)[number];
export type CliMode = z.infer<typeof cliModeSchema>;
