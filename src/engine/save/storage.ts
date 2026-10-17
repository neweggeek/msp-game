import { get, set } from "idb-keyval";
import type { SaveFile } from "./save";

/** Browser save slots in IndexedDB. */
export const SLOTS = [1, 2, 3] as const;
const key = (slot: number) => `msp-game/slot-${slot}`;

export async function writeSlot(slot: number, save: SaveFile): Promise<void> {
  await set(key(slot), save);
}

export async function readSlot(slot: number): Promise<SaveFile | undefined> {
  return (await get(key(slot))) as SaveFile | undefined;
}
