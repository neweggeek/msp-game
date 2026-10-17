import { describe, expect, it } from "vitest";
import { gameData } from "../src/engine/data";
import { type Action, type GameState, applyAction, newGame } from "../src/engine/save/game";
import { SaveError, exportSave, importSave, loadSave, makeSave } from "../src/engine/save/save";

const data = gameData();

function play(seed: string, n: number): GameState {
  const g = newGame(seed, data);
  const fw = g.world.devices.find((d) => d.kind === "firewall")?.id as string;
  applyAction(g, data, { t: "cli-open", device: fw });
  const lines = [
    "config system interface",
    "edit data",
    "set allowaccess ping ssh https",
    "next",
    "end",
    "get system status",
    "diagnose switch poe status",
    "bogus",
    "conf sys glo",
    "set hostname FG-SAVE01",
  ];
  const actions: Action[] = [];
  for (let i = 0; actions.length < n; i++) {
    actions.push({ t: "cli", session: "s1", line: lines[i % lines.length] as string });
    if (i % 7 === 0) actions.push({ t: "advance", minutes: 37 });
    if (i % 11 === 0) actions.push({ t: "ticket-note", ticket: "T-1001", text: `Note ${i}` });
  }
  for (const a of actions.slice(0, n)) applyAction(g, data, a);
  return g;
}

const strip = (g: GameState) => JSON.parse(JSON.stringify({ ...g, snapshot: undefined }));

describe("save system", () => {
  it("save, reload, load: the state matches (full replay and snapshot)", () => {
    const g = play("save-1", 137);
    expect(g.snapshot?.at).toBe(100);
    const save = JSON.parse(JSON.stringify(makeSave(g)));
    const fromSnapshot = loadSave(save, data);
    const fromReplay = loadSave(save, data, { useSnapshot: false });
    expect(strip(fromSnapshot)).toEqual(strip(g));
    expect(strip(fromReplay)).toEqual(strip(g));
  });

  it("export and import round trip", () => {
    const g = play("save-2", 20);
    expect(strip(importSave(exportSave(g), data))).toEqual(strip(g));
  });

  it("a save from another generator version is refused", () => {
    const save = { ...makeSave(play("save-3", 3)), generatorVersion: 999 };
    expect(() => loadSave(save, data)).toThrow(SaveError);
  });

  it("junk is refused with a clear error", () => {
    expect(() => importSave("{not json", data)).toThrow(/not JSON/);
    expect(() => importSave('{"format":"other"}', data)).toThrow(SaveError);
  });

  it("the save stays small: seed plus actions", () => {
    const g = play("save-4", 30);
    expect(JSON.stringify({ ...makeSave(g), snapshot: undefined }).length).toBeLessThan(5000);
  });
});
