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

export const accessTokenSchema = z.string().regex(/^(docs|rmm|monitoring|ssh:[a-z]+)$/);

const effectSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("set-poe-priority-all"), value: z.enum(["low", "high", "critical"]) }),
  z.object({
    type: z.literal("add-endpoints"),
    template: z.string(),
    count: z.number().int().min(1),
    label: z.string(),
  }),
]);

const proofSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("poe-denied"), kind: deviceKindSchema }),
]);

export const faultSchema = z.object({
  id: z.string(),
  name: z.string(),
  layer: z.number().int().min(1).max(8),
  device: deviceKindSchema,
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

export const caseSchema = z.object({
  id: z.string(),
  name: z.string(),
  pick: z.enum(["first-slice", "later", "cut"]),
  requires: z.object({ kinds: z.record(deviceKindSchema, z.number().int()) }),
  ticket: z.object({
    title: z.string(),
    body: z.string(),
    priority: z.enum(["P1", "P2", "P3", "P4"]),
  }),
  faults: z.array(z.string()).min(1),
  redHerring: z.string(),
  rootCause: z.string(),
  fix: z.string(),
});

const codecSchema = z.enum(["string", "quoted", "int", "enum", "list", "ip", "ip-mask"]);

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
  save: z.enum(["on-end", "explicit"]),
  banner: z.array(z.string()),
  prompts: z.object({ exec: z.string(), section: z.string(), item: z.string() }),
  sections: z.array(
    z.object({
      path: z.string(),
      model: z.string(),
      kind: z.enum(["single", "table"]),
      prompt: z.string().optional(),
      autoKey: z.boolean().optional(),
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
  keywords: z.record(z.string()).default({}),
  commands: z.array(
    z.object({
      words: z.string(),
      verb: z.enum(baseVerbs),
      view: z.string().optional(),
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
export type DeviceTemplate = z.infer<typeof deviceTemplateSchema>;
export type RoomTemplate = z.infer<typeof roomTemplateSchema>;
export type FaultDef = z.infer<typeof faultSchema>;
export type CaseDef = z.infer<typeof caseSchema>;
export type Dialect = z.infer<typeof dialectSchema>;
export type SlaRules = z.infer<typeof slaSchema>;
export type TicketRules = z.infer<typeof ticketRulesSchema>;
export type CalendarRules = z.infer<typeof calendarSchema>;
export type StalenessRules = z.infer<typeof stalenessSchema>;
export type ClientRules = z.infer<typeof clientRulesSchema>;
export type BaseVerb = (typeof baseVerbs)[number];
export type CliMode = z.infer<typeof cliModeSchema>;
