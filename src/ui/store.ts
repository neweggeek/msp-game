import { create } from "zustand";
import {
  type Action,
  type ActionResult,
  type GameState,
  type ScoreEntry,
  applyAction,
  exportSave,
  gameData,
  importSave,
  loadSave,
  makeSave,
  newGame,
  readSlot,
  writeSlot,
} from "../engine";
import { diag, errorText } from "./diag";

const data = gameData();

export type Tab = "desk" | "rmm" | "ovik" | "docs" | "terminal" | "kb" | "debug";
export type Dialog =
  | { kind: "handoff" | "resolve" | "send-back"; ticket: string }
  | { kind: "web"; from: string; address: string }
  | { kind: "diag" }
  | { kind: "score"; summary?: boolean }
  | { kind: "bug" }
  | null;

interface UiState {
  game: GameState | null;
  /** Bumps after every engine change, since the engine mutates state in place. */
  rev: number;
  slot: number;
  tab: Tab;
  ticket?: string;
  session?: string;
  dialog: Dialog;
  message?: string;
  /** Score changes from the last action, shown briefly so points never move without a reason. */
  toast?: { id: number; entries: ScoreEntry[] };
  start: (seed: string, scenario?: string) => void;
  act: (a: Action) => ActionResult;
  setTab: (t: Tab) => void;
  openTicket: (id: string) => void;
  setSession: (id: string | undefined) => void;
  setDialog: (d: Dialog) => void;
  setSlot: (slot: number) => void;
  say: (m: string | undefined) => void;
  loadSlot: (slot: number) => Promise<void>;
  exportFile: () => void;
  importFile: (text: string) => void;
}

function autosave(game: GameState, slot: number) {
  try {
    writeSlot(slot, makeSave(game)).catch((e) => {
      // Private windows can block IndexedDB. Export still works.
      diag("warn", `Autosave to slot ${slot} failed: ${errorText(e)}`);
    });
  } catch (e) {
    diag("error", `Autosave crashed: ${errorText(e)}`);
  }
}

export const useUi = create<UiState>((set, get) => ({
  game: null,
  rev: 0,
  slot: 1,
  tab: "desk",
  dialog: null,
  start(seed, scenario = "slice") {
    try {
      const game = newGame(seed, data, { scenario });
      set({
        game,
        rev: get().rev + 1,
        ticket: undefined,
        session: undefined,
        dialog: null,
        message: `New shift. Client: ${game.world.client.name}.`,
      });
      diag(
        "info",
        `New game. Seed "${seed}", scenario ${scenario}, client ${game.world.client.name}.`,
      );
      autosave(game, get().slot);
    } catch (e) {
      diag("error", `New game failed for seed "${seed}": ${errorText(e)}`);
      set({ message: (e as Error).message });
    }
  },
  act(a) {
    const { game, slot } = get();
    if (!game) return { ok: false, error: "No game." };
    let result: ActionResult;
    const scored = game.score.length;
    const queued = openCount(game);
    try {
      result = applyAction(game, data, a);
    } catch (e) {
      diag("error", `Action crashed ${JSON.stringify(a)}: ${errorText(e)}`);
      result = { ok: false, error: "Something broke. It is in the diagnostics log." };
      set({ rev: get().rev + 1, message: result.error });
      return result;
    }
    diag("action", `${JSON.stringify(a)}${result.ok ? "" : ` -> refused: ${result.error}`}`);
    const patch: Partial<UiState> = {
      rev: get().rev + 1,
      message: result.ok ? undefined : result.error,
    };
    if (result.session) patch.session = result.session;
    const fresh = game.score.slice(scored);
    if (fresh.length > 0) patch.toast = { id: game.log.length, entries: fresh };
    // The queue just emptied: end of shift.
    if (queued > 0 && openCount(game) === 0) patch.dialog = { kind: "score", summary: true };
    set(patch);
    autosave(game, slot);
    return result;
  },
  setTab: (tab) => set({ tab }),
  openTicket(id) {
    const { game } = get();
    const t = game?.book.tickets.find((x) => x.id === id);
    if (t && t.openedAt === undefined) get().act({ t: "ticket-open", ticket: id });
    set({ ticket: id, tab: "desk" });
  },
  setSession: (id) => set({ session: id }),
  setDialog: (dialog) => set({ dialog }),
  setSlot: (slot) => set({ slot }),
  say: (message) => set({ message }),
  async loadSlot(slot) {
    const save = await readSlot(slot).catch(() => undefined);
    if (!save) {
      set({ message: `Slot ${slot} is empty.` });
      return;
    }
    try {
      const game = loadSave(save, data);
      diag("info", `Loaded slot ${slot}: seed "${game.seed}", ${game.log.length} actions.`);
      const open = Object.values(game.sessions).find((s) => !s.closed);
      set({
        game,
        slot,
        rev: get().rev + 1,
        session: lastSession(game) ?? open?.id,
        dialog: null,
        message: `Loaded slot ${slot}: ${game.log.length} actions.`,
      });
    } catch (e) {
      diag("error", `Load slot ${slot} failed: ${errorText(e)}`);
      set({ message: (e as Error).message });
    }
  },
  exportFile() {
    const { game } = get();
    if (!game) return;
    const blob = new Blob([exportSave(game)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `msp-save-${game.seed}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  },
  importFile(text) {
    try {
      const game = importSave(text, data);
      set({
        game,
        rev: get().rev + 1,
        ticket: undefined,
        session: undefined,
        dialog: null,
        message: `Imported seed "${game.seed}".`,
      });
      diag("info", `Imported seed "${game.seed}".`);
      autosave(game, get().slot);
    } catch (e) {
      diag("error", `Import failed: ${errorText(e)}`);
      set({ message: (e as Error).message });
    }
  },
}));

/** Tickets still in your queue. */
export function openCount(game: GameState): number {
  return game.book.tickets.filter((t) => t.closedAt === undefined && !t.sentBack).length;
}

/** The open session the player typed in last, so a reload lands back in the same tab. */
function lastSession(game: GameState): string | undefined {
  for (let i = game.log.length - 1; i >= 0; i--) {
    const a = game.log[i];
    if (a && (a.t === "cli" || a.t === "rmm") && !game.sessions[a.session]?.closed)
      return a.session;
  }
  return undefined;
}

/** The game, for components that only render once one exists. */
export function useGame(): GameState {
  const g = useUi((s) => s.game);
  useUi((s) => s.rev);
  if (!g) throw new Error("no game");
  return g;
}

export { data };
