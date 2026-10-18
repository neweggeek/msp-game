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
  "nvr",
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
  /** default: the factory password, listed in the vendor KB. */
  credentials: z.object({ username: z.string(), default: z.string().optional() }).optional(),
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
      /** Other gear a room of this type may hold. One of each kind per site at most. */
      gear: z
        .array(
          z.object({ kind: deviceKindSchema, chance: z.number().min(0).max(1), name: z.string() }),
        )
        .default([]),
    }),
  ),
});

/** "docs", "monitoring", "rmm", "hands" (a phone call), "isp" (its support line), or "ssh:<role>" / "rmm:<role>". */
export const accessTokenSchema = z
  .string()
  .regex(/^(docs|rmm|monitoring|hands|isp|screen|vpn|(ssh|rmm):[a-z-]+)$/);
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
  z.object({
    type: z.literal("power-cut"),
    target: z.string(),
    /** Weekdays the cut starts on, 0 is Monday. The window may run past midnight. */
    days: z.array(z.number().int().min(0).max(6)).min(1),
    from: clock,
    to: clock,
    /** What remote hands say the device is plugged into, before and after the fix. */
    source: z.string(),
    fixedSource: z.string(),
  }),
  z.object({ type: z.literal("change-wan-ip"), target: z.string() }),
  z.object({ type: z.literal("mangle-phase2"), target: z.string() }),
  /** A patch cable with both ends in wall jacks on the same switch. No loop protection, so a storm. */
  z.object({ type: z.literal("loop-cable"), target: z.string() }),
  /** The ISP's side of the site goes down until they fix it. Target is the site's firewall. */
  z.object({ type: z.literal("isp-outage"), target: z.string() }),
  /** NTP sync off and the firewall clock drifts this many minutes, so token codes stop matching. */
  z.object({
    type: z.literal("clock-drift"),
    target: z.string(),
    minutes: z.tuple([z.number().int(), z.number().int()]),
  }),
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
  z.object({ type: z.literal("no-power-cut"), role: z.string() }),
  z.object({ type: z.literal("no-loop"), role: z.string() }),
  z.object({ type: z.literal("isp-up"), role: z.string() }),
  z.object({ type: z.literal("clock-synced"), role: z.string() }),
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
        surface: z.enum(["monitoring", "cli", "docs", "rmm", "ticket", "call"]),
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
    /** The main office firewall gives the MSP a VPN account with this sign-in. */
    vpn: z.enum(["totp", "push"]).optional(),
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
  /** Dispatch grants a P1 flag on this case: the business is stopped. */
  p1Worthy: z.boolean().optional(),
  fixed: z.array(checkSchema).min(1),
  /** What the client's contacts say and can do on a call for this case. */
  call: z
    .object({
      /** Answers to "fact" asks in calls.yaml, by ask id. Contacts know these; other staff do not. */
      facts: z.record(z.string()).default({}),
      /** Override the test answers when the problem is weekly and nobody can test on the spot. */
      testFixed: z.string().optional(),
      testBroken: z.string().optional(),
      /** Remote hands tasks that show up once the contact has given the fact they hang on. */
      fixes: z
        .array(
          z.object({
            id: z.string(),
            label: z.string(),
            /** A fact ask id, or "power:<role>" once someone says what that device plugs into. */
            unlockedBy: z.string(),
            effect: z.enum(["end-power-cut", "unplug-loop"]),
            roles: z.array(z.string()).min(1),
          }),
        )
        .default([]),
    })
    .optional(),
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
  /** false: a break-fix client. No RMM agents and no monitoring; one-time sessions only. */
  managed: z.boolean().optional(),
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

export const vpnRulesSchema = z.object({
  apps: z.array(
    z.object({
      brand: z.string(),
      name: z.string(),
      installed: z.string(),
      latest: z.string(),
      minVersion: z.record(z.string()),
    }),
  ),
  upgradeMinutes: z.number().int(),
  connectMinutes: z.number().int(),
  chance: z.number().min(0).max(1),
  ports: z.array(z.number().int()).min(1),
  pushChance: z.number().min(0).max(1),
  wrongPort: z.object({ fresh: z.number(), partly: z.number(), stale: z.number() }),
  mfa: z.object({
    stepMinutes: z.number().int().min(1),
    badCodesToLock: z.number().int().min(1),
    lockMinutes: z.number().int(),
    pushMinutes: z.number().int(),
  }),
  messages: z.record(z.string()),
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

export const callRulesSchema = z.object({
  dialMinutes: z.number().int().min(0),
  answerChance: z.object({ usually: z.number(), sometimes: z.number(), rarely: z.number() }),
  patience: z.object({ base: z.number().int(), perPoint: z.number() }),
  rebootMinutes: z.number().int().min(1),
  asks: z.array(
    z.object({
      id: z.string(),
      kind: z.enum([
        "test",
        "lights",
        "power-source",
        "power-cycle",
        "fact",
        "isp-bill",
        "device-password",
        "enable-account",
        "screenlink-join",
      ]),
      minutes: z.number().int().min(0),
      label: z.string(),
      device: z.boolean().optional(),
      ticket: z.boolean().optional(),
      default: z.string().optional(),
    }),
  ),
  lines: z.record(z.string()),
  /** The MSP's own techs. They pick up during MSP hours and know what they did. */
  team: z.object({
    people: z.array(z.object({ id: z.string(), name: z.string(), role: z.string() })).min(1),
    asks: z.array(
      z.object({
        id: z.string(),
        kind: z.enum(["vault-password"]),
        minutes: z.number().int().min(0),
        label: z.string(),
      }),
    ),
    lines: z.record(z.string()),
  }),
  /** Questions clients ask on a call. Trap answers cost later; ignoring one is fine. */
  traps: z.object({
    chance: z.number().min(0).max(1),
    promiseMinutes: z.number().int(),
    otherTechMinutes: z.number().int(),
    trainingMinutes: z.number().int(),
    list: z
      .array(
        z.object({
          id: z.string(),
          ticket: z.boolean().optional(),
          question: z.string(),
          answers: z
            .array(
              z.object({
                text: z.string(),
                says: z.string(),
                effect: z.enum(["none", "promise-time", "promise-other", "training"]),
              }),
            )
            .min(2),
        }),
      )
      .min(1),
    lines: z.record(z.string()),
  }),
  /** The ISP's business support line: open all hours, on hold first, account and PIN before anything. */
  isp: z.object({
    holdMinutes: z.tuple([z.number().int().min(0), z.number().int().min(0)]),
    patience: z.number().int().min(1),
    rebootMinutes: z.number().int().min(1),
    agents: z.array(z.string()).min(1),
    asks: z.array(
      z.object({
        id: z.string(),
        kind: z.enum(["isp-verify", "isp-status", "isp-reboot"]),
        minutes: z.number().int().min(0),
        label: z.string(),
      }),
    ),
    lines: z.record(z.string()),
  }),
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
        /** int codec: allowed range. */
        min: z.number().optional(),
        max: z.number().optional(),
        /** The value must name an entry in this config table, like a VLAN that exists. */
        refersTo: z.string().optional(),
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
  desk: z.object({
    p1CheckInMinutes: z.number().int().min(1),
    p1FlagReviewMinutes: z.number().int(),
    escalateAfterMinutes: z.number().int(),
    checkInAfterMinutes: z.number().int().min(1),
    seniorReplyMinutes: z.number().int(),
    senior: z.string(),
    lines: z.record(z.string()),
  }),
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
  /** The vault password is wrong. Half the time the docs history still has the right one. */
  wrongCredential: z.number(),
  /** A device nobody ever changed off its factory password, and so never saved in the vault. */
  defaultPassword: z.number(),
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
  /** Chance the client turns the MSP's admin accounts off between tickets. */
  disablesMspAccounts: z.number().min(0).max(1),
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
export type VpnRules = z.infer<typeof vpnRulesSchema>;
export type HandoffRules = z.infer<typeof handoffRulesSchema>;
export type CallRules = z.infer<typeof callRulesSchema>;
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
