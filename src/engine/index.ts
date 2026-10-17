// The only API the UI may call.
export { gameData, type GameData } from "./data";
export { generate, GENERATOR_VERSION } from "./gen";
export { accessPaths } from "./gen/validate";
export { netState, poeFor } from "./net/state";
export { tunnelStates } from "./net/vpn";
export { formatTime } from "./clock/clock";
export { prompt, type CliSession } from "./cli/session";
export { agents, publicIp, type AgentRow, type RmmSession } from "./rmm/rmm";
export { ovikView, type OvikView } from "./monitor/ovik";
export { webPage, type WebPage } from "./web/web";
export { caseFixed } from "./tickets/checks";
export {
  closeBlockers,
  handoffNotes,
  resolutionNotes,
  plainResolutionNotes,
  ticketDevice,
  NOTE_PARTS,
  type NoteOption,
  type ResolutionOption,
} from "./tickets/desk";
export type { Ticket, Proof, TicketEntry } from "./tickets/tickets";
export {
  applyAction,
  newGame,
  totalScore,
  type Action,
  type GameState,
  type ActionResult,
  type TermSession,
  type ScoreEntry,
  type CalendarEntry,
} from "./save/game";
export { exportSave, importSave, loadSave, makeSave, SaveError, type SaveFile } from "./save/save";
export { readSlot, writeSlot, SLOTS } from "./save/storage";
export * from "./model/types";
export { docsDiff, type DocDiff } from "./gen/diff";
export { assetTypes, assetTypeOf, connectCommand, type AssetType } from "./docs/assets";
export {
  people,
  findPerson,
  unlockedFixes,
  type Person,
  type PhoneCall,
} from "./calls/calls";
export { bootTime } from "./net/state";
