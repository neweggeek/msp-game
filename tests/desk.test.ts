import { describe, expect, it } from "vitest";
import { gameData } from "../src/engine/data";
import { applyAction, newGame } from "../src/engine/save/game";
import type { Ticket } from "../src/engine/tickets/tickets";

const data = gameData();

function setup(opts: { caseId?: string } = {}, caseId?: string) {
  const g = newGame("desk-1", data, opts);
  const act = (a: Parameters<typeof applyAction>[2]) => applyAction(g, data, a);
  const t = g.book.tickets.find((x) => x.caseId === (caseId ?? opts.caseId)) as Ticket;
  const pts = (key: string) => g.score.filter((e) => e.points === data.handoffs.scoring[key]);
  return { g, act, t, pts };
}

describe("desk rules", () => {
  it("dispatch checks in on a P1 every hour; a note keeps it quiet", () => {
    const { g, act, t } = setup({ caseId: "tidy-desk" });
    expect(t.priority).toBe("P1");
    act({ t: "ticket-open", ticket: t.id });
    act({ t: "ticket-note", ticket: t.id, text: "Whole site dark. Calling the contact." });
    act({ t: "advance", minutes: 59 });
    expect(t.history.some((h) => h.text.includes("update every hour"))).toBe(false);
    act({ t: "advance", minutes: 61 });
    expect(t.history.some((h) => h.by === "dispatch" && h.text.includes("every hour"))).toBe(true);
    expect(g.score.some((e) => e.reason.includes("P1 hourly check-in"))).toBe(true);
  });

  it("a P1 flag on a one-user problem is declined", () => {
    const { g, act, t } = setup({}, "wrong-phonebook");
    expect(act({ t: "ticket-flag-p1", ticket: t.id, reason: "User is upset" }).ok).toBe(true);
    expect(act({ t: "ticket-flag-p1", ticket: t.id, reason: "again" }).ok).toBe(false);
    act({ t: "advance", minutes: 20 });
    expect(t.priority).toBe("P3");
    expect(t.history.some((h) => h.text.includes("stays P3"))).toBe(true);
    expect(g.score.some((e) => e.reason.includes("not one"))).toBe(true);
  });

  it("escalating too early earns a push back; after 30 minutes the senior answers", () => {
    const { g, act, t } = setup({}, "branch-silence");
    act({ t: "ticket-open", ticket: t.id });
    const early = act({ t: "escalate", ticket: t.id, note: "Tunnel down, no idea." });
    expect(early.output?.join(" ")).toContain("real try first");
    expect(g.score.some((e) => e.reason.includes("escalated before"))).toBe(true);
    act({ t: "advance", minutes: 30 });
    const r = act({ t: "escalate", ticket: t.id, note: "Phase 1 never answers. Ruled out PSK." });
    expect(r.output?.join(" ")).toContain("will look");
    act({ t: "advance", minutes: 45 });
    const c = g.world.cases.find((x) => x.caseId === "branch-silence");
    expect(
      t.history.some((h) => h.by === "Dev (senior)" && h.text.includes(c?.rootCause ?? "?")),
    ).toBe(true);
    expect(act({ t: "escalate", ticket: t.id, note: "more?" }).output?.join(" ")).toContain(
      "already",
    );
  });

  it("an hour on a ticket with no fix and no word costs a little; a note avoids it", () => {
    const { g, act } = setup();
    const quiet = g.book.tickets.find((x) => x.caseId === "camera-day") as Ticket;
    const noted = g.book.tickets.find((x) => x.caseId === "nobody-home") as Ticket;
    act({ t: "ticket-open", ticket: quiet.id });
    act({ t: "ticket-open", ticket: noted.id });
    act({ t: "advance", minutes: 30 });
    act({
      t: "ticket-note",
      ticket: noted.id,
      text: "Probe sleeps at night. Checking power plan.",
    });
    act({ t: "advance", minutes: 31 });
    const stuck = g.score.filter((e) => e.reason.includes("no check-in"));
    expect(stuck.map((e) => e.ticketId)).toEqual([quiet.id]);
  });
});
