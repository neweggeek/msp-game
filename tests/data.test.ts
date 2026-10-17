import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DataError, loadData } from "../src/engine/data";

function rawFiles(): Record<string, string> {
  const root = new URL("../data/", import.meta.url).pathname;
  const out: Record<string, string> = {};
  for (const dir of readdirSync(root)) {
    for (const f of readdirSync(join(root, dir)))
      out[`/data/${dir}/${f}`] = readFileSync(join(root, dir, f), "utf8");
  }
  return out;
}

describe("data files", () => {
  it("all load and cross-reference", () => {
    const data = loadData(rawFiles());
    expect(data.dialects.get("fortress")).toBeDefined();
    expect(data.cases.get("camera-day")?.pick).toBe("first-slice");
  });

  it("a fault with no clues fails with a message naming it", () => {
    const files = rawFiles();
    files["/data/faults/poe.yaml"] = (files["/data/faults/poe.yaml"] as string).replace(
      /clues:[\s\S]*$/,
      "clues: []\n",
    );
    expect(() => loadData(files)).toThrow(DataError);
    expect(() => loadData(files)).toThrow(/poe-budget-exhausted.*clues/);
  });

  it("an unknown template in a fault is caught", () => {
    const files = rawFiles();
    files["/data/faults/poe.yaml"] = (files["/data/faults/poe.yaml"] as string).replace(
      "hawkvision-ptz4",
      "nope-cam",
    );
    expect(() => loadData(files)).toThrow(/unknown device template nope-cam/);
  });

  it("player text has no em dashes", () => {
    for (const [path, text] of Object.entries(rawFiles()))
      expect(text.includes("—"), path).toBe(false);
  });
});
