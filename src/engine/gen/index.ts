import type { GameData } from "../data";
import type { World } from "../model/types";
import { Rng } from "../rng/rng";
import { genDocs } from "./docs";
import { plantCase } from "./faults";
import { genGear } from "./gear";
import { genProfile } from "./profile";
import { genSite } from "./site";
import { checkSolvable } from "./validate";

/** Bump when a code change alters what an existing seed builds. */
export const GENERATOR_VERSION = 1;

const MAX_WORLD_ATTEMPTS = 200;
const MAX_FAULT_ATTEMPTS = 8;
const MAX_DOC_ATTEMPTS = 8;

export class GenerationError extends Error {}

/**
 * Seed in, client out. Steps each draw from their own stream.
 * A case that does not fit rerolls the client; unsolvable docs reroll the docs.
 */
export function generate(seed: string, data: GameData, caseId?: string): World {
  const root = new Rng(seed);
  const cases = [...data.cases.values()].filter((c) =>
    caseId ? c.id === caseId : c.pick === "first-slice",
  );
  if (cases.length === 0)
    throw new GenerationError(`no case to plant (${caseId ?? "first-slice"})`);

  for (let attempt = 0; attempt < MAX_WORLD_ATTEMPTS; attempt++) {
    const rng = attempt === 0 ? root : root.fork(`attempt-${attempt}`);
    const client = genProfile(rng.fork("profile"), data);
    const { site, plan } = genSite(rng.fork("site"), data, client);
    const { devices, network } = genGear(rng.fork("gear"), data, client, site, plan);
    const base = { generatorVersion: GENERATOR_VERSION, seed, client, site, devices, network };
    const caseDef = rng.fork("case-pick").pick(cases);

    // Faults mutate the network, so each try works on a fresh copy.
    for (let f = 0; f < MAX_FAULT_ATTEMPTS; f++) {
      const draft = structuredClone(base);
      const planted = plantCase(rng.fork(f === 0 ? "faults" : `faults-${f}`), data, caseDef, draft);
      if (!planted) continue;
      for (let d = 0; d < MAX_DOC_ATTEMPTS; d++) {
        const docs = genDocs(rng.fork(`docs-${d}`), data, { ...draft, case: planted });
        const world = { ...draft, docs, case: planted };
        const report = checkSolvable(world, { world: attempt + 1, faults: f + 1, docs: d + 1 });
        if (report.solvable) return { ...world, solvability: report };
      }
    }
  }
  throw new GenerationError(
    `seed ${seed}: no solvable client after ${MAX_WORLD_ATTEMPTS} attempts`,
  );
}
