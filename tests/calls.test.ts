import { describe, expect, it } from "vitest";
import { powerCycle } from "../src/engine/calls/calls";
import { gameData } from "../src/engine/data";
import type { Device } from "../src/engine/model/types";
import { bootTime, netState } from "../src/engine/net/state";
import { type Action, applyAction, collateralDown, newGame } from "../src/engine/save/game";
import { caseFixed } from "../src/engine/tickets/checks";

// Phone calls and remote hands (ACC-04, ACC-06), and the weekly power cut they solve.
const data = gameData();

function setup(seed = "calls-1") {
  const g = newGame(seed, data);
  const act = (a: Action) => applyAction(g, data, a);
  const fw = g.world.devices.find((d) => d.kind === "firewall" && d.siteId === "hq") as Device;
  const sw = g.world.devices.find((d) => d.kind === "switch" && d.siteId === "hq") as Device;
  const openHours = () => {
    const h = g.world.client.businessHours;
    const m = g.clock.now % 1440;
    if (m < h.start) act({ t: "advance", minutes: h.start - m + 5 });
  };
  /** A call someone picked up. */
  const answered = (ticket?: string) => {
    for (let i = 0; i < 40; i++) {
      for (const c of g.world.client.contacts) {
        const id = act({ t: "call", person: c.id, ...(ticket ? { ticket } : {}) })
          .session as string;
        if (g.calls?.[id]?.answered) return id;
      }
      act({ t: "advance", minutes: 15 });
    }
    throw new Error("nobody answered");
  };
  const until = (hhmm: string) => {
    const [h = 0, m = 0] = hhmm.split(":").map(Number);
    const target = Math.floor(g.clock.now / 1440) * 1440 + h * 60 + m;
    act({ t: "advance", minutes: target - g.clock.now });
  };
  return { g, act, fw, sw, openHours, answered, until };
}

describe("phone calls", () => {
  it("after hours goes to voicemail", () => {
    const { g, act } = setup();
    act({ t: "advance", minutes: 14 * 60 });
    const id = act({ t: "call", person: "contact-1" }).session as string;
    expect(g.calls?.[id]?.answered).toBe(false);
    expect(g.calls?.[id]?.transcript.join("\n")).toContain("out of the office");
    expect(act({ t: "call-ask", call: id, ask: "after-hours" }).ok).toBe(false);
  });

  it("contacts know the office; a user on a ticket does not", () => {
    const { g, act, openHours, answered } = setup();
    openHours();
    const id = answered();
    expect(act({ t: "call-ask", call: id, ask: "after-hours" }).output?.join("\n")).toContain(
      "cleaning crew",
    );
    const t = g.book.tickets.find((x) => x.caseId === "wrong-phonebook");
    const user = `user:${t?.contact}`;
    for (let i = 0; i < 30; i++) {
      const u = act({ t: "call", person: user, ticket: t?.id as string }).session as string;
      if (!g.calls?.[u]?.answered) {
        act({ t: "advance", minutes: 15 });
        continue;
      }
      const out = act({ t: "call-ask", call: u, ask: "after-hours" }).output?.join("\n");
      expect(out).not.toContain("cleaning crew");
      return;
    }
    throw new Error("user never answered");
  });

  it("patience runs out and the call ends", () => {
    const { g, act, openHours, answered } = setup();
    openHours();
    const id = answered();
    for (let i = 0; i < 12 && !g.calls?.[id]?.closed; i++)
      act({ t: "call-ask", call: id, ask: "recent-changes" });
    expect(g.calls?.[id]?.closed).toBe(true);
    expect(g.calls?.[id]?.transcript.at(-1)).toContain("get back to work");
  });

  it("a client that wants scheduled calls costs points once a day per contact", () => {
    const { g, act, openHours, answered } = setup();
    g.world.client.contactPreference = "scheduled-only";
    openHours();
    const first = answered();
    const who = g.calls?.[first]?.person as string;
    const unwanted = () => g.score.filter((e) => e.reason.includes("scheduled through dispatch"));
    expect(unwanted()).toHaveLength(1);
    for (let i = 0; i < 20; i++) {
      const id = act({ t: "call", person: who }).session as string;
      if (g.calls?.[id]?.answered) break;
    }
    expect(unwanted()).toHaveLength(1);
    act({ t: "advance", minutes: 24 * 60 });
    for (let i = 0; i < 20; i++) {
      const id = act({ t: "call", person: who }).session as string;
      if (g.calls?.[id]?.answered) break;
      act({ t: "advance", minutes: 15 });
    }
    expect(unwanted()).toHaveLength(2);
  });

  it("a power-cycle drops the device for a few minutes and loses unsaved changes", () => {
    const { g, act, sw, openHours, answered } = setup();
    openHours();
    const s = act({ t: "cli-open", device: sw.id }).session as string;
    const port = sw.ports.find((p) => p.role === "access")?.name as string;
    for (const line of ["configure terminal", `interface ${port}`, "description scratch", "end"])
      act({ t: "cli", session: s, line });
    const ports = () => (sw.running?.ports ?? {}) as Record<string, Record<string, unknown>>;
    expect(ports()[port]?.description).toBe("scratch");
    let id = answered();
    // Low competence can cycle the wrong box. Keep asking until the switch went dark.
    for (let i = 0; i < 10 && sw.rebootUntil === undefined; i++) {
      if (g.calls?.[id]?.closed) id = answered();
      act({ t: "call-ask", call: id, ask: "power-cycle", device: sw.id });
    }
    expect(sw.rebootUntil).toBeDefined();
    expect(ports()[port]?.description).not.toBe("scratch");
    expect(netState(g.world, g.clock.now).online.get(sw.id)).toBe(false);
    expect(collateralDown(g)).toEqual([]);
    act({ t: "advance", minutes: data.calls.rebootMinutes + 1 });
    expect(netState(g.world, g.clock.now).online.get(sw.id)).toBe(true);
    expect(bootTime(sw, g.clock.now)).toBe(sw.rebootUntil);
  });
});

describe("Tuesday 7 PM power cut", () => {
  it("takes the site dark tonight without counting as your outage, and uptime resets", () => {
    const { g, fw, until } = setup();
    until("19:10");
    const ns = netState(g.world, g.clock.now);
    expect(ns.online.get(fw.id)).toBe(false);
    expect(collateralDown(g)).toEqual([]);
    until("19:45");
    expect(netState(g.world, g.clock.now).online.get(fw.id)).toBe(true);
    expect(g.clock.now - bootTime(fw, g.clock.now)).toBe(8);
  });

  it("the remote hands fix stops it", () => {
    const { g, act, fw, openHours, answered, until } = setup();
    openHours();
    let id = answered();
    act({ t: "call-ask", call: id, ask: "closet-power" });
    for (let i = 0; i < 20 && fw.powerCut?.until === undefined; i++) {
      if (g.calls?.[id]?.closed) id = answered();
      act({ t: "call-ask", call: id, ask: "closet-wall-outlet" });
    }
    expect(fw.powerCut?.until).toBeDefined();
    until("19:10");
    expect(netState(g.world, g.clock.now).online.get(fw.id)).toBe(true);
  });

  it("the fix is not on offer until a contact tells you about the closet", () => {
    const { act, openHours, answered } = setup();
    openHours();
    const id = answered();
    expect(act({ t: "call-ask", call: id, ask: "closet-wall-outlet" }).ok).toBe(false);
  });
});

describe("calls review fixes", () => {
  it("a power-cycle wipes an unsaved PoE fix, so Camera Day breaks again", () => {
    const { g, act } = setup("case-a");
    const c = g.world.cases.find((x) => x.caseId === "camera-day");
    if (!c) throw new Error("no camera day");
    const sw = g.world.devices.find((d) => d.id === c.bindings.switch) as Device;
    const s = act({ t: "cli-open", device: sw.id }).session as string;
    const ports = sw.ports
      .filter((p) =>
        ["ap", "phone"].includes(g.world.devices.find((d) => d.id === p.link?.device)?.kind ?? ""),
      )
      .map((p) => p.name);
    for (const line of [
      "configure terminal",
      ...ports.flatMap((p) => [`interface ${p}`, "power-over-ethernet priority high"]),
      "end",
    ])
      act({ t: "cli", session: s, line });
    expect(caseFixed(g.world, c, g.clock.now)).toBe(true);
    powerCycle(data, sw, g.clock.now);
    expect(act({ t: "cli", session: s, line: "show vlan" }).output?.[0]).toContain("closed");
    act({ t: "advance", minutes: data.calls.rebootMinutes + 1 });
    expect(caseFixed(g.world, c, g.clock.now)).toBe(false);
  });

  it("PoE gear behind a dark switch has no power", () => {
    const { g, sw } = setup();
    const ap = g.world.devices.find(
      (d) =>
        d.poe &&
        sw.ports.some((p) => p.link?.device === d.id) &&
        netState(g.world, g.clock.now).powered.get(d.id),
    ) as Device;
    powerCycle(data, sw, g.clock.now);
    expect(netState(g.world, g.clock.now).powered.get(ap.id)).toBe(false);
  });

  it("a real outage still counts while something else is power-cycling", () => {
    const { g, sw } = setup();
    const victim = g.world.devices.find(
      (d) => d.siteId === "hq" && d.kind === "ap" && g.baselineUp?.includes(d.id),
    ) as Device;
    const port = sw.ports.find((p) => p.link?.device === victim.id);
    if (port) port.shutdown = true;
    const other = g.world.devices.find((d) => d.siteId === "hq" && d.kind === "phone") as Device;
    powerCycle(data, other, g.clock.now);
    expect(collateralDown(g, "hq")).toContain(victim.id);
    expect(collateralDown(g, "hq")).not.toContain(other.id);
  });

  it("fixed in the middle of a cut, uptime starts at the fix", () => {
    const { g, fw, until } = setup();
    until("19:15");
    if (fw.powerCut) fw.powerCut.until = g.clock.now;
    until("19:25");
    expect(g.clock.now - bootTime(fw, g.clock.now)).toBe(10);
  });

  it("voicemail is not a response, and unplugging a user's PC needs their OK", () => {
    const { g, act, openHours, answered } = setup();
    const t = g.book.tickets[0] as (typeof g.book.tickets)[number];
    act({ t: "advance", minutes: 14 * 60 });
    act({ t: "call", person: "contact-1", ticket: t.id });
    expect(t.respondedAt).toBeUndefined();
    act({ t: "advance", minutes: 12 * 60 });
    openHours();
    const pc = g.world.devices.find(
      (d) => d.user && d.siteId === "hq" && !d.tags?.includes("probe"),
    ) as Device;
    let id = answered();
    for (let i = 0; i < 10 && pc.rebootUntil === undefined; i++) {
      if (g.calls?.[id]?.closed) id = answered();
      act({ t: "call-ask", call: id, ask: "power-cycle", device: pc.id });
    }
    expect(g.score.some((e) => e.reason.startsWith("Had someone unplug"))).toBe(true);
  });
});
