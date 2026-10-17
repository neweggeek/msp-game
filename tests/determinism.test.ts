import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { gameData } from "../src/engine/data";
import { GENERATOR_VERSION, generate } from "../src/engine/gen";
import { digest } from "../src/engine/util/hash";

const GOLDEN = new URL("./golden/seeds.json", import.meta.url);
const GOLDEN_SEEDS = ["alpha", "bravo", "charlie", "delta", "echo", "camera-day", "12345", "msp"];

describe("determinism", () => {
  it("the same seed builds an identical client, over 200 seeds", () => {
    const data = gameData();
    for (let i = 0; i < 200; i++) {
      const a = JSON.stringify(generate(`det-${i}`, data));
      const b = JSON.stringify(generate(`det-${i}`, data));
      expect(a === b, `seed det-${i}`).toBe(true);
    }
  });

  it("different seeds build different clients", () => {
    const data = gameData();
    expect(digest(generate("one", data))).not.toBe(digest(generate("two", data)));
  });

  // If this fails after a code change, old saves would rebuild a different world.
  // Bump GENERATOR_VERSION on purpose, then rerun with UPDATE_GOLDEN=1.
  it("golden seeds still build the same clients", () => {
    const data = gameData();
    const now = Object.fromEntries(GOLDEN_SEEDS.map((s) => [s, digest(generate(s, data))]));
    if (process.env.UPDATE_GOLDEN || !existsSync(GOLDEN)) {
      writeFileSync(
        GOLDEN,
        `${JSON.stringify({ generatorVersion: GENERATOR_VERSION, seeds: now }, null, 2)}\n`,
      );
    }
    const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as {
      generatorVersion: number;
      seeds: Record<string, string>;
    };
    expect(golden.generatorVersion, "generator version changed: rerun with UPDATE_GOLDEN=1").toBe(
      GENERATOR_VERSION,
    );
    expect(now).toEqual(golden.seeds);
  });
});
