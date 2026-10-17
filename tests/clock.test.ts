import { describe, expect, it } from "vitest";
import {
  addBusinessMinutes,
  advance,
  endOfBusinessDays,
  formatTime,
  newClock,
  schedule,
} from "../src/engine/clock/clock";
import { gameData } from "../src/engine/data";

const cal = gameData().calendar;
const at = (day: number, h: number, m = 0) => day * 1440 + h * 60 + m;

describe("clock", () => {
  it("formats game time from the epoch Monday", () => {
    expect(formatTime(cal, at(1, 8))).toBe("Tue Oct 20 08:00");
    expect(formatTime(cal, at(6, 23, 5))).toBe("Sun Oct 25 23:05");
  });

  it("business minutes skip nights and weekends", () => {
    expect(addBusinessMinutes(cal, at(0, 9), 120)).toBe(at(0, 11));
    expect(addBusinessMinutes(cal, at(0, 16), 120)).toBe(at(1, 9));
    expect(addBusinessMinutes(cal, at(4, 16), 120)).toBe(at(7, 9)); // Friday to Monday
    expect(addBusinessMinutes(cal, at(5, 12), 30)).toBe(at(7, 8, 30)); // Saturday start
  });

  it("end of next business day", () => {
    expect(endOfBusinessDays(cal, at(4, 10), 1)).toBe(at(7, 17));
  });

  it("fires timers in order, including ones scheduled while firing", () => {
    const c = newClock(0);
    const fired: string[] = [];
    schedule(c, 30, "b", {});
    schedule(c, 10, "a", {});
    advance(c, 60, (t) => {
      fired.push(`${t.kind}@${t.at}`);
      if (t.kind === "a") schedule(c, 20, "c", {});
    });
    expect(fired).toEqual(["a@10", "c@20", "b@30"]);
    expect(c.now).toBe(60);
  });
});
