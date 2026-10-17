import { describe, expect, it } from "vitest";
import { gameData } from "../src/engine/data";
import { generate } from "../src/engine/gen";

describe("solvability sweep", () => {
  it("300 slice seeds generate with all six cases solvable", () => {
    const data = gameData();
    const attempts: number[] = [];
    const faultTries: number[] = [];
    for (let i = 0; i < 300; i++) {
      const w = generate(`sweep-${i}`, data);
      expect(w.solvability.solvable, `seed sweep-${i}`).toBe(true);
      expect(w.cases.map((c) => c.caseId)).toEqual([
        "camera-day",
        "wrong-phonebook",
        "nobody-home",
        "branch-silence",
        "tuesday-seven",
        "lights-out",
      ]);
      const text = JSON.stringify([w.cases, w.extraTickets]);
      expect(
        text.match(/\{[a-z-]+(\.[a-z]+)?\}/),
        `unfilled placeholder, seed sweep-${i}`,
      ).toBeNull();
      attempts.push(w.solvability.attempts.world);
      faultTries.push(w.solvability.attempts.faults);
    }
    const avg = attempts.reduce((a, b) => a + b, 0) / attempts.length;
    console.log(
      `world attempts avg ${avg.toFixed(2)} max ${Math.max(...attempts)}, fault tries max ${Math.max(...faultTries)}`,
    );
    expect(Math.max(...attempts)).toBeLessThan(100);
  });

  it("quick play seeds plant one fitting case", () => {
    const data = gameData();
    for (let i = 0; i < 100; i++) {
      const w = generate(`quick-${i}`, data, { scenario: "quick" });
      expect(w.cases).toHaveLength(1);
      expect(w.solvability.solvable).toBe(true);
    }
  });
});
