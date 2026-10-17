import type { GameData } from "../data";
import type { CaseInstance, Device, ExtraTicket, OvikDevice, Site, World } from "../model/types";
import { Rng } from "../rng/rng";
import type { CaseDef } from "../schema";
import { genDocs } from "./docs";
import { type Draft, caseFits, plantCase, renderBound } from "./faults";
import { type GearContext, addTunnel, genSiteGear, switchConfig } from "./gear";
import { genProfile } from "./profile";
import { genSite } from "./site";
import { checkSolvable } from "./validate";

/** Bump when a code change alters what an existing seed builds. */
export const GENERATOR_VERSION = 6;

const MAX_WORLD_ATTEMPTS = 200;
const MAX_FAULT_ATTEMPTS = 8;
const MAX_DOC_ATTEMPTS = 8;

export class GenerationError extends Error {}

export interface GenerateOptions {
  scenario?: string;
  /** Plant just this case (debug and tests). */
  caseId?: string;
}

/** Build the network with no faults in it. */
function buildBase(
  rng: Rng,
  data: GameData,
  seed: string,
  scenarioId: string,
  playStart: number,
): { draft: Draft; ctx: GearContext } {
  const scenario = data.scenarios.get(scenarioId);
  if (!scenario) throw new GenerationError(`no scenario ${scenarioId}`);
  const client = genProfile(rng.fork("profile"), data, scenario.tier);
  const ctx: GearContext = {
    devices: [],
    links: [],
    counters: {},
    staff: [...client.staff],
    now: playStart,
  };
  const hqOctet = rng.int(10, 60);
  const sites: Site[] = [];
  for (const role of scenario.sites) {
    const { site, plan } = genSite(rng.fork(`site-${role}`), data, client, role);
    const octet = role === "hq" ? hqOctet : hqOctet + rng.int(10, 40);
    const opts = {
      role,
      octet,
      switchBrand: scenario.switchBrand,
      probe: role === "hq" && scenario.probe === true,
    };
    sites.push(genSiteGear(rng.fork(`gear-${role}`), data, client, site, plan, opts, ctx));
  }
  const fwOf = (siteId: string) =>
    ctx.devices.find((d) => d.kind === "firewall" && d.siteId === siteId) as Device;
  const hq = sites.find((s) => s.id === "hq");
  const branch = sites.find((s) => s.id === "branch");
  if (hq && branch) addTunnel(rng.fork("tunnel"), fwOf("hq"), hq, fwOf("branch"), branch);

  const collector =
    ctx.devices.find((d) => d.tags?.includes("probe")) ??
    ctx.devices.find((d) => d.kind === "server");
  const draft: Draft = {
    generatorVersion: GENERATOR_VERSION,
    seed,
    scenario: scenarioId,
    client,
    sites,
    devices: ctx.devices,
    links: ctx.links,
    history: [],
    monitoring: { collectorId: collector?.id ?? "", inventory: [] },
  };
  return { draft, ctx };
}

/** Configs are derived once the network is final, so faults that touch ports show up in them. */
function finishConfigs(draft: Draft): void {
  for (const d of draft.devices) {
    if (d.kind === "switch" && d.dialect) {
      const site = draft.sites.find((s) => s.id === d.siteId);
      d.running = switchConfig(d, site?.vlans ?? []);
    }
    if (d.running) d.startup = structuredClone(d.running);
  }
}

/** What Ovik thinks is out there. It was set up once and drifted. */
function ovikInventory(rng: Rng, draft: Draft, snapshot: Draft): OvikDevice[] {
  const uplinkOf = (d: Device) => {
    const p = d.ports.find((x) => x.link)?.link;
    const sw = p ? draft.devices.find((x) => x.id === p.device) : undefined;
    return sw?.kind === "switch" ? `${sw.hostname} ${p?.port}` : undefined;
  };
  const known = snapshot.devices.filter((d) => d.ip && d.kind !== "pc");
  const inv: OvikDevice[] = known.map((d) => {
    const o: OvikDevice = { deviceId: d.id, hostname: d.hostname, ip: d.ip as string };
    const up = uplinkOf(d);
    if (up) o.uplink = up;
    return o;
  });
  for (const d of draft.devices.filter((x) => x.addedBy && x.ip)) {
    inv.push({
      deviceId: d.id,
      hostname: `unknown-${d.mac.slice(-5).replace(":", "")}`,
      ip: d.ip as string,
    });
  }
  // Planted bad data: one stale address, one wrong uplink port.
  const plain = inv.filter(
    (o) =>
      !draft.devices.find((d) => d.id === o.deviceId)?.addedBy &&
      !["firewall", "switch", "server"].includes(
        draft.devices.find((d) => d.id === o.deviceId)?.kind ?? "",
      ),
  );
  const stale = plain.length > 0 ? rng.pick(plain) : undefined;
  if (stale) {
    const parts = stale.ip.split(".");
    parts[3] = String(((Number(parts[3]) + rng.int(3, 30)) % 240) + 10);
    stale.ip = parts.join(".");
  }
  const wired = plain.filter((o) => o !== stale && o.uplink);
  const wrong = wired.length > 0 ? rng.pick(wired) : undefined;
  if (wrong?.uplink) {
    const [sw, port = ""] = wrong.uplink.split(" ");
    const n = Number(port.match(/(\d+)$/)?.[1] ?? 1);
    wrong.uplink = `${sw} ${port.replace(/\d+$/, String(n === 1 ? 2 : n - 1))}`;
  }
  return inv;
}

function extraTickets(
  data: GameData,
  ids: string[],
  cases: CaseInstance[],
  draft: Draft,
): ExtraTicket[] {
  const out: ExtraTicket[] = [];
  for (const id of ids) {
    const def = data.extraTickets.get(id);
    if (!def) continue;
    const of = def.duplicateOf ? cases.find((c) => c.caseId === def.duplicateOf) : undefined;
    if (def.duplicateOf && !of) continue;
    const r = (t: string) => renderBound(t, of?.bindings ?? {}, draft);
    const t: ExtraTicket = {
      id: def.id,
      kind: def.kind,
      origin: def.origin,
      priority: def.priority,
      title: r(def.title),
      body: r(def.body),
      sendBack: def.sendBack,
      hint: def.hint,
    };
    if (def.duplicateOf) t.duplicateOf = def.duplicateOf;
    out.push(t);
  }
  return out;
}

/**
 * Seed in, client out. Steps each draw from their own stream.
 * A case that does not fit rerolls the client; unsolvable docs reroll the docs.
 */
export function generate(seed: string, data: GameData, opts: GenerateOptions = {}): World {
  const scenarioId = opts.scenario ?? (opts.caseId ? "quick" : "slice");
  const scenario = data.scenarios.get(scenarioId);
  if (!scenario) throw new GenerationError(`no scenario ${scenarioId}`);
  const playStart = data.calendar.startMinute;
  const root = new Rng(seed);

  for (let attempt = 0; attempt < MAX_WORLD_ATTEMPTS; attempt++) {
    const rng = attempt === 0 ? root : root.fork(`attempt-${attempt}`);
    let base: ReturnType<typeof buildBase>;
    try {
      base = buildBase(rng, data, seed, scenarioId, playStart);
    } catch (e) {
      if (e instanceof GenerationError) throw e;
      continue;
    }
    let caseDefs: CaseDef[];
    if (opts.caseId) {
      const c = data.cases.get(opts.caseId);
      if (!c) throw new GenerationError(`no case ${opts.caseId}`);
      caseDefs = [c];
    } else if (scenario.cases.length > 0) {
      caseDefs = scenario.cases.map((id) => data.cases.get(id) as CaseDef);
    } else {
      const fits = [...data.cases.values()].filter(
        (c) => c.pick === "first-slice" && caseFits(c, base.draft),
      );
      if (fits.length === 0) continue;
      caseDefs = [rng.fork("case-pick").pick(fits)];
    }
    if (!caseDefs.every((c) => caseFits(c, base.draft))) continue;

    // Faults mutate the network, so each try works on a fresh copy.
    for (let f = 0; f < MAX_FAULT_ATTEMPTS; f++) {
      const draft = structuredClone(base.draft);
      const ctx: GearContext = {
        ...structuredClone({ counters: base.ctx.counters, staff: base.ctx.staff }),
        devices: draft.devices,
        links: draft.links,
        now: playStart,
      };
      const frng = rng.fork(f === 0 ? "faults" : `faults-${f}`);
      const taken = new Set<string>();
      const cases: CaseInstance[] = [];
      for (const c of caseDefs) {
        const planted = plantCase(frng.fork(c.id), data, c, draft, ctx, taken, playStart);
        if (!planted) break;
        cases.push(planted);
      }
      if (cases.length < caseDefs.length) continue;
      finishConfigs(draft);
      draft.history.sort((a, b) => a.at - b.at || a.deviceId.localeCompare(b.deviceId));
      const monitoring = {
        collectorId: draft.monitoring?.collectorId ?? "",
        inventory: ovikInventory(rng.fork("ovik"), draft, base.draft),
      };
      const extras = extraTickets(data, scenario.extraTickets, cases, draft);
      for (let d = 0; d < MAX_DOC_ATTEMPTS; d++) {
        const docs = genDocs(rng.fork(`docs-${d}`), data, base.draft, cases, playStart);
        const world = { ...draft, monitoring, docs, cases, extraTickets: extras };
        const report = checkSolvable(world, playStart, {
          world: attempt + 1,
          faults: f + 1,
          docs: d + 1,
        });
        if (report.solvable) return { ...world, solvability: report };
      }
    }
  }
  throw new GenerationError(
    `seed ${seed}: no solvable client after ${MAX_WORLD_ATTEMPTS} attempts`,
  );
}
