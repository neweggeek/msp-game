import { create } from "zustand";
import {
  type Action,
  type ActionResult,
  type GameState,
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

const data = gameData();

export type Tab = "desk" | "rmm" | "ovik" | "docs" | "terminal" | "kb" | "debug";
export type Dialog =
  | { kind: "handoff" | "resolve" | "send-back"; ticket: string }
  | { kind: "web"; from: string; address: string }
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
  writeSlot(slot, makeSave(game)).catch(() => {
    /* Private windows can block IndexedDB. Export still works. */
  });
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
      autosave(game, get().slot);
    } catch (e) {
      set({ message: (e as Error).message });
    }
  },
  act(a) {
    const { game, slot } = get();
    if (!game) return { ok: false, error: "No game." };
    const result = applyAction(game, data, a);
    const patch: Partial<UiState> = {
      rev: get().rev + 1,
      message: result.ok ? undefined : result.error,
    };
    if (result.session) patch.session = result.session;
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
      const open = Object.values(game.sessions).find((s) => !s.closed);
      set({
        game,
        slot,
        rev: get().rev + 1,
        session: open?.id,
        dialog: null,
        message: `Loaded slot ${slot}: ${game.log.length} actions.`,
      });
    } catch (e) {
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
      autosave(game, get().slot);
    } catch (e) {
      set({ message: (e as Error).message });
    }
  },
}));

/** The game, for components that only render once one exists. */
export function useGame(): GameState {
  const g = useUi((s) => s.game);
  useUi((s) => s.rev);
  if (!g) throw new Error("no game");
  return g;
}

export { data };
