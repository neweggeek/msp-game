// The only API the UI may call.
export { gameData, type GameData } from "./data";
export { generate, GENERATOR_VERSION } from "./gen";
export { accessPaths } from "./gen/validate";
export { netState, poeFor } from "./net/state";
export { formatTime } from "./clock/clock";
export { prompt } from "./cli/session";
export { applyAction, newGame, type Action, type GameState, type ActionResult } from "./save/game";
export { exportSave, importSave, loadSave, makeSave, SaveError, type SaveFile } from "./save/save";
export { readSlot, writeSlot, SLOTS } from "./save/storage";
export * from "./model/types";
export { docsDiff, type DocDiff } from "./gen/diff";
