import { z } from "zod";
import type { GameData } from "../data";
import { GENERATOR_VERSION } from "../gen";
import { type Action, type GameState, SAVE_VERSION, applyAction, newGame } from "./game";

export class SaveError extends Error {}

const saveSchema = z.object({
  format: z.literal("msp-game-save"),
  saveVersion: z.number().int(),
  generatorVersion: z.number().int(),
  seed: z.string(),
  caseId: z.string().optional(),
  log: z.array(z.object({ t: z.string() }).passthrough()),
  snapshot: z.object({ at: z.number().int(), state: z.string() }).optional(),
});

export type SaveFile = z.infer<typeof saveSchema>;

export function makeSave(state: GameState): SaveFile {
  const save: SaveFile = {
    format: "msp-game-save",
    saveVersion: SAVE_VERSION,
    generatorVersion: state.generatorVersion,
    seed: state.seed,
    log: structuredClone(state.log),
  };
  if (state.caseId) save.caseId = state.caseId;
  if (state.snapshot) save.snapshot = { ...state.snapshot };
  return save;
}

/** Rebuild from the seed and replay the log. Starts from the snapshot when there is one. */
export function loadSave(
  raw: unknown,
  data: GameData,
  opts: { useSnapshot?: boolean } = {},
): GameState {
  const parsed = saveSchema.safeParse(raw);
  if (!parsed.success) throw new SaveError(`Not a valid save: ${parsed.error.issues[0]?.message}`);
  const save = parsed.data;
  if (save.saveVersion !== SAVE_VERSION)
    throw new SaveError(`Save format v${save.saveVersion} is not supported.`);
  if (save.generatorVersion !== GENERATOR_VERSION) {
    throw new SaveError(
      `This save was made by generator v${save.generatorVersion}; this build runs v${GENERATOR_VERSION}.`,
    );
  }
  const log = save.log as Action[];
  let state: GameState;
  let from = 0;
  if (save.snapshot && opts.useSnapshot !== false && save.snapshot.at <= log.length) {
    state = {
      ...(JSON.parse(save.snapshot.state) as GameState),
      log: log.slice(0, save.snapshot.at),
      snapshot: save.snapshot,
    };
    from = save.snapshot.at;
  } else {
    state = newGame(save.seed, data, save.caseId);
  }
  for (const a of log.slice(from)) applyAction(state, data, a);
  return state;
}

export function exportSave(state: GameState): string {
  return JSON.stringify(makeSave(state), null, 1);
}

export function importSave(text: string, data: GameData): GameState {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SaveError("That file is not JSON.");
  }
  return loadSave(raw, data);
}
