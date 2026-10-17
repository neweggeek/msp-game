import { describe, expect, it } from "vitest";
import { gameData } from "../src/engine/data";
import { applyAction, newGame } from "../src/engine/save/game";

const data = gameData();
const DAY = 1440;

describe("tickets", () => {
  it("the case opens one ticket in the initial status with SLA due times", () => {
    const g = newGame("tickets-1", data);
    const t = g.book.tickets[0];
    expect(t?.status).toBe("open");
    expect(t?.priority).toBe("P2");
    expect(t?.responseDue).toBe(g.clock.now + 120);
  });

  it("a ticket left 3 game days goes to Follow-up Needed", () => {
    const g = newGame("tickets-2", data);
    applyAction(g, data, { t: "advance", minutes: 3 * DAY - 1 });
    expect(g.book.tickets[0]?.status).toBe("open");
    applyAction(g, data, { t: "advance", minutes: 1 });
    expect(g.book.tickets[0]?.status).toBe("follow-up-needed");
  });

  it("left longer, dispatch raises it to P1", () => {
    const g = newGame("tickets-3", data);
    applyAction(g, data, { t: "advance", minutes: 3 * DAY });
    expect(g.book.tickets[0]?.priority).toBe("P2");
    applyAction(g, data, { t: "advance", minutes: 6 * DAY });
    expect(g.book.tickets[0]?.priority).toBe("P1");
    expect(
      g.book.tickets[0]?.history.some((h) => h.by === "dispatch" && h.text.includes("P1")),
    ).toBe(true);
  });

  it("a status update resets the aging clock", () => {
    const g = newGame("tickets-4", data);
    applyAction(g, data, { t: "advance", minutes: 2 * DAY });
    applyAction(g, data, { t: "ticket-status", ticket: "T-1001", status: "awaiting-client" });
    applyAction(g, data, { t: "advance", minutes: 2 * DAY });
    expect(g.book.tickets[0]?.status).toBe("awaiting-client");
    applyAction(g, data, { t: "advance", minutes: DAY });
    expect(g.book.tickets[0]?.status).toBe("follow-up-needed");
  });

  it("the tech cannot set P1 or Follow-up Needed", () => {
    const g = newGame("tickets-5", data);
    expect(
      applyAction(g, data, { t: "ticket-priority", ticket: "T-1001", priority: "P1" }).ok,
    ).toBe(false);
    expect(
      applyAction(g, data, { t: "ticket-priority", ticket: "T-1001", priority: "P3" }).ok,
    ).toBe(true);
    expect(
      applyAction(g, data, { t: "ticket-status", ticket: "T-1001", status: "follow-up-needed" }).ok,
    ).toBe(false);
    expect(
      applyAction(g, data, { t: "ticket-flag-p1", ticket: "T-1001", reason: "Whole office down" })
        .ok,
    ).toBe(true);
    expect(g.book.tickets[0]?.flaggedP1).toBe(true);
  });

  it("an untouched ticket breaches its response target", () => {
    const g = newGame("tickets-6", data);
    applyAction(g, data, { t: "advance", minutes: 121 });
    expect(g.book.tickets[0]?.breaches.response).toBeDefined();
    expect(g.events.some((e) => e.text.includes("response"))).toBe(true);
  });

  it("a closed ticket stops aging", () => {
    const g = newGame("tickets-7", data);
    applyAction(g, data, { t: "ticket-status", ticket: "T-1001", status: "closed" });
    applyAction(g, data, { t: "advance", minutes: 10 * DAY });
    expect(g.book.tickets[0]?.status).toBe("closed");
    expect(g.book.tickets[0]?.priority).toBe("P2");
  });
});
