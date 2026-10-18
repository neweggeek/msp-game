import { describe, expect, it } from "vitest";
import { dashboard } from "../src/engine/cloud/dashboard";
import { gameData } from "../src/engine/data";
import type { Device } from "../src/engine/model/types";
import { netState } from "../src/engine/net/state";
import { type Action, type GameState, applyAction, newGame } from "../src/engine/save/game";
import { caseFixed } from "../src/engine/tickets/checks";

// Cloud dashboards for cloud-managed brands (ACC-12).
const data = gameData();

function tools(g: GameState) {
  const act = (a: Action) => applyAction(g, data, a);
  const docs = g.world.docs.cloud;
  const pass = g.world.docs.credentials.find((c) => c.deviceId === "cloud")?.password ?? "";
  const login = () => act({ t: "cloud-login", username: docs?.username ?? "", password: pass });
  const sw = g.world.devices.find((d) => d.cloud && d.siteId === "hq") as Device;
  const portOf = (d: Device) =>
    g.world.links
      .map((l) =>
        l.a.device === sw.id && l.b.device === d.id
          ? l.a.port
          : l.b.device === sw.id && l.a.device === d.id
            ? l.b.port
            : undefined,
      )
      .find(Boolean) as string;
  return { act, docs, login, sw, portOf };
}

function cloudGame(caseId: string) {
  for (let i = 0; i < 100; i++) {
    const g = newGame(`cloud-${caseId}-${i}`, data, { caseId });
    if (g.world.devices.some((d) => d.cloud)) return g;
  }
  throw new Error("no cloud seed");
}

describe("cloud dashboards", () => {
  it("the docs hold the login; the dashboard has no CLI and a wrong password fails", () => {
    const g = cloudGame("crushed-cable");
    const { act, docs, login, sw } = tools(g);
    expect(sw.dialect).toBeUndefined();
    expect(docs?.username).toBe(g.world.cloudOrg?.username);
    expect(g.world.docs.accessNotes.some((n) => n.includes("cloud-managed"))).toBe(true);
    expect(act({ t: "cloud-cable-test", device: sw.id, port: "1" }).ok).toBe(false);
    expect(act({ t: "cloud-login", username: docs?.username ?? "", password: "nope" }).ok).toBe(
      false,
    );
    expect(login().ok).toBe(true);
    const view = dashboard(g.world, g.clock.now);
    expect(view.devices[0]?.online).toBe(true);
    expect(view.devices[0]?.ports.some((p) => p.status === "connected")).toBe(true);
  });

  it("Crushed Cable: flaps in the log, an open pair, and a new patch cable fixes it", () => {
    const g = cloudGame("crushed-cable");
    const { act, login, sw, portOf } = tools(g);
    const c = g.world.cases[0] as (typeof g.world.cases)[number];
    const pc = g.world.devices.find((d) => d.id === c.bindings.pc) as Device;
    login();
    const port = portOf(pc);
    const view = dashboard(g.world, g.clock.now);
    expect(
      view.events.some((e) => e.text.includes(`Port ${port}:`) && e.text.includes("CRC")),
    ).toBe(true);
    expect(view.devices[0]?.ports.find((p) => p.port === port)?.status).toBe("disconnected");
    const test = act({ t: "cloud-cable-test", device: sw.id, port });
    expect(test.output?.join(" ")).toContain("open at about");
    // A port cycle does not help a crushed cable.
    act({ t: "cloud-port-cycle", device: sw.id, port });
    expect(caseFixed(g.world, c, g.clock.now)).toBe(false);
    // Call a contact in business hours: the fact unlocks the swap.
    const h = g.world.client.businessHours;
    if (g.clock.now % 1440 < h.start)
      act({ t: "advance", minutes: h.start - (g.clock.now % 1440) + 5 });
    for (let i = 0; i < 60 && !caseFixed(g.world, c, g.clock.now); i++) {
      const id = act({ t: "call", person: "contact-1", ticket: g.book.tickets[0]?.id })
        .session as string;
      if (!g.calls?.[id]?.answered) {
        act({ t: "advance", minutes: 20 });
        continue;
      }
      act({ t: "call-ask", call: id, ask: "recent-changes" });
      act({ t: "call-ask", call: id, ask: "swap-patch-cable" });
      act({ t: "call-end", call: id });
    }
    expect(caseFixed(g.world, c, g.clock.now)).toBe(true);
    expect(netState(g.world, g.clock.now).online.get(pc.id) || pc.sleep !== undefined).toBe(true);
    expect(act({ t: "cloud-cable-test", device: sw.id, port }).output?.join(" ")).toContain(
      "all four pairs OK",
    );
  });

  it("Camera Day on a cloud switch is fixed from the dashboard", () => {
    const g = cloudGame("camera-day");
    const { act, login, sw } = tools(g);
    const c = g.world.cases[0] as (typeof g.world.cases)[number];
    login();
    expect(caseFixed(g.world, c, g.clock.now)).toBe(false);
    for (const p of sw.ports) {
      const peer = g.world.devices.find((d) =>
        d.ports.some((x) => x.link?.device === sw.id && x.link.port === p.name),
      );
      if (peer && (peer.kind === "ap" || peer.kind === "phone"))
        expect(
          act({ t: "cloud-port", device: sw.id, port: p.name, change: { poePriority: "high" } }).ok,
        ).toBe(true);
    }
    expect(caseFixed(g.world, c, g.clock.now)).toBe(true);
    expect(
      dashboard(g.world, g.clock.now).events.some((e) => e.text.includes("config change")),
    ).toBe(true);
  });

  it("an uplink cannot be disabled from the dashboard", () => {
    const g = cloudGame("crushed-cable");
    const { act, login, sw } = tools(g);
    login();
    const up = sw.ports.find((p) => p.role === "uplink" && p.link);
    const r = act({
      t: "cloud-port",
      device: sw.id,
      port: up?.name ?? "",
      change: { enabled: false },
    });
    expect(r.ok).toBe(false);
    expect(up?.shutdown).toBeFalsy();
  });
});
