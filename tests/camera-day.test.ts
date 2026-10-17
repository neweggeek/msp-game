import { describe, expect, it } from "vitest";
import { gameData } from "../src/engine/data";
import { netState } from "../src/engine/net/state";
import { applyAction, newGame } from "../src/engine/save/game";

const data = gameData();

describe("Camera Day", () => {
  it("diagnose switch poe status shows the PoE budget blown and the AP denied", () => {
    for (const seed of ["camera-day", "cd-2", "cd-3"]) {
      const g = newGame(seed, data, "camera-day");
      const w = g.world;
      const fault = w.case.faults[0];
      const ap = w.devices.find((d) => d.id === fault?.bindings.ap);
      const sw = w.devices.find((d) => d.kind === "switch");
      expect(ap && sw).toBeTruthy();
      expect(fault?.addedDevices).toHaveLength(4);

      const fw = w.devices.find((d) => d.kind === "firewall")?.id as string;
      const open = applyAction(g, data, { t: "cli-open", device: fw });
      const out =
        applyAction(g, data, {
          t: "cli",
          session: open.session as string,
          line: "diagnose switch poe status",
        }).output ?? [];
      const header = out.find((l) => l.startsWith("Power budget")) as string;
      const [, budget, , requested] =
        header.match(/budget: (\d+) W .*Allocated: ([\d.]+) W .*Requested: ([\d.]+) W/) ?? [];
      expect(Number(requested)).toBeGreaterThan(Number(budget));
      expect(out.some((l) => l.includes("Denied") && l.includes(ap?.hostname as string))).toBe(
        true,
      );
      expect(netState(w).online.get(ap?.id as string)).toBe(false);
      expect(w.docs.devices.some((d) => fault?.addedDevices.includes(d.deviceId))).toBe(false);
    }
  });

  it("unplugging the new cameras brings the AP back", () => {
    const g = newGame("camera-day", data, "camera-day");
    const w = g.world;
    const sw = w.devices.find((d) => d.kind === "switch");
    const fault = w.case.faults[0];
    for (const p of sw?.ports ?? [])
      if (fault?.addedDevices.includes(p.link?.device ?? "")) p.poeEnabled = false;
    expect(netState(w).online.get(fault?.bindings.ap as string)).toBe(true);
  });
});
