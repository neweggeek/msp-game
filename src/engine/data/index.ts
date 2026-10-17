import { type GameData, loadData } from "./load";

const files = import.meta.glob("../../../data/**/*.yaml", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

let cached: GameData | null = null;

/** The bundled game data, parsed and validated once. */
export function gameData(): GameData {
  cached ??= loadData(files);
  return cached;
}

export { loadData, DataError, type GameData, type RawFiles } from "./load";
