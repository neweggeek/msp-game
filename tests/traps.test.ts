import { describe, expect, it } from "vitest";
import { gameData } from "../src/engine/data";
import { type GameState, applyAction, newGame } from "../src/engine/save/game";
import type { Ticket } from "../src/engine/tickets/tickets";

const data = gameData();

/** Dial the ticket's contact until they bring up this question. Returns the call id. */
function callWithTrap(g: GameState, t: Ticket, trap: string): string {
  const act = (a: Parameters<typeof applyAction>[2]) => applyAction(g, data, a);
  // Client hours are hidden; start mid-morning.
  act({ t: "advance", minutes: 120 });
  for (let i = 0; i < 200; i++) {
    for (const c of g.world.client.contacts) {
      const id = act({ t: "call", person: c.id, ticket: t.id }).session as string;
      if (g.calls?.[id]?.trap?.id === trap) return id;
      act({ t: "call-end", call: id });
    }
    if (g.clock.now % 1440 > 15 * 60) act({ t: "advance", minutes: 1440 - 300 });
  }
  throw new Error(`no ${trap} question`);
}

function setup() {
  const g = newGame("traps-1", data);
  const act = (a: Parameters<typeof applyAction>[2]) => applyAction(g, data, a);
  const t = g.book.tickets.find((x) => x.caseId === "camera-day") as Ticket;
  return { g, act, t };
}

describe("client dialogue traps", () => {
  it("promising a time that passes costs points on another ticket", () => {
    const { g, act, t } = setup();
    const id = callWithTrap(g, t, "when-fixed");
    const before = g.score.length;
    expect(act({ t: "call-answer", call: id, answer: 0 }).ok).toBe(true);
    expect(act({ t: "call-answer", call: id, answer: 1 }).ok).toBe(false);
    act({ t: "advance", minutes: 100 });
    const hit = g.score.slice(before).find((e) => e.reason.includes("would be fixed by"));
    expect(hit).toBeTruthy();
    expect(hit?.ticketId).not.toBe(t.id);
  });

  it("the right answer to when-fixed costs nothing", () => {
    const { g, act, t } = setup();
    const id = callWithTrap(g, t, "when-fixed");
    const before = g.score.length;
    act({ t: "call-answer", call: id, answer: 1 });
    act({ t: "advance", minutes: 200 });
    expect(g.score.slice(before).some((e) => e.reason.includes("would be fixed"))).toBe(false);
  });

  it("training eats an hour; speaking for another tech backfires", () => {
    const { g, act, t } = setup();
    const show = callWithTrap(g, t, "show-me");
    const at = g.clock.now;
    act({ t: "call-answer", call: show, answer: 0 });
    expect(g.clock.now - at).toBe(data.calls.traps.trainingMinutes);
    const other = callWithTrap(g, t, "other-tech");
    act({ t: "call-answer", call: other, answer: 0 });
    act({ t: "advance", minutes: 600 });
    expect(g.score.some((e) => e.reason.includes("never agreed"))).toBe(true);
  });

  it("a promise on a ticket rightly sent back is kept; a close without a fix is not", () => {
    const { g, act } = setup();
    const edr = g.book.tickets.find((x) => x.extraId === "edr-misroute") as Ticket;
    const id = callWithTrap(g, edr, "when-fixed");
    act({ t: "call-answer", call: id, answer: 0 });
    act({ t: "send-back", ticket: edr.id, reason: "misrouted" });
    act({ t: "advance", minutes: 100 });
    expect(g.score.some((e) => e.reason.includes("would be fixed by"))).toBe(false);

    const { g: g2, act: act2, t } = setup();
    const id2 = callWithTrap(g2, t, "when-fixed");
    act2({ t: "call-answer", call: id2, answer: 0 });
    act2({ t: "resolve", ticket: t.id, note: 0 });
    act2({ t: "advance", minutes: 100 });
    expect(g2.score.some((e) => e.reason.includes("would be fixed by"))).toBe(true);
  });

  it("the trap's lines do not move the ask draws on the call", () => {
    const { g, act, t } = setup();
    const id = callWithTrap(g, t, "when-fixed");
    const call = g.calls?.[id];
    expect(call?.trap?.lines).toBe(1);
    act({ t: "call-answer", call: id, answer: 1 });
    expect(call?.trap?.lines).toBe(3);
    expect((call?.transcript.length ?? 0) - (call?.trap?.lines ?? 0)).toBe(1);
  });
});
