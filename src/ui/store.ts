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

interface UiState {
  game: GameState | null;
  /** Bumps after every engine change, since the engine mutates state in place. */
  rev: number;
  slot: number;
  selected?: string;
  showDocs: boolean;
  session?: string;
  message?: string;
  generate: (seed: string) => void;
  act: (a: Action) => ActionResult;
  select: (id: string) => void;
  setShowDocs: (v: boolean) => void;
  setSlot: (slot: number) => void;
  setSession: (id: string | undefined) => void;
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
  showDocs: false,
  generate(seed) {
    try {
      const game = newGame(seed, data);
      set({
        game,
        rev: get().rev + 1,
        selected: undefined,
        session: undefined,
        message: `Generated seed "${seed}".`,
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
    set({ rev: get().rev + 1, message: result.ok ? get().message : result.error });
    autosave(game, slot);
    return result;
  },
  select: (id) => set({ selected: id }),
  setShowDocs: (v) => set({ showDocs: v }),
  setSlot: (slot) => set({ slot }),
  setSession: (id) => set({ session: id }),
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
        message: `Loaded slot ${slot}: seed "${game.seed}", ${game.log.length} actions.`,
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
        selected: undefined,
        session: undefined,
        message: `Imported seed "${game.seed}".`,
      });
      autosave(game, get().slot);
    } catch (e) {
      set({ message: (e as Error).message });
    }
  },
}));

export { data };
