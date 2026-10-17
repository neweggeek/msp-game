import { describe, expect, it } from "vitest";
import { gameData } from "../src/engine/data";
import { generate } from "../src/engine/gen";

describe("solvability sweep", () => {
  it("500 seeds generate and every one is solvable", () => {
    const data = gameData();
    const attempts: number[] = [];
    const faultTries: number[] = [];
    const tiers: Record<string, number> = {};
    for (let i = 0; i < 500; i++) {
      const w = generate(`sweep-${i}`, data);
      expect(w.solvability.solvable, `seed sweep-${i}`).toBe(true);
      expect(w.solvability.clues.every((c) => c.reachable)).toBe(true);
      attempts.push(w.solvability.attempts.world);
      faultTries.push(w.solvability.attempts.faults);
      tiers[w.client.tier] = (tiers[w.client.tier] ?? 0) + 1;
    }
    const avg = attempts.reduce((a, b) => a + b, 0) / attempts.length;
    console.log(
      `world attempts avg ${avg.toFixed(2)} max ${Math.max(...attempts)}; fault tries max ${Math.max(...faultTries)}; tiers ${JSON.stringify(tiers)}`,
    );
    // A seed that needs most of the retry budget means the content is too picky.
    expect(Math.max(...attempts)).toBeLessThan(100);
  });
});
