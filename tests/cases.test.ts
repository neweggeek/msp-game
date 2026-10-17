import { describe, expect, it } from "vitest";
import { formatTime } from "../src/engine/clock/clock";
import { gameData } from "../src/engine/data";
import type { Device } from "../src/engine/model/types";
import { ovikView } from "../src/engine/monitor/ovik";
import { netState } from "../src/engine/net/state";
import { tunnelStates } from "../src/engine/net/vpn";
import { publicIp } from "../src/engine/rmm/rmm";
import { type GameState, applyAction, newGame, totalScore } from "../src/engine/save/game";
import { caseFixed } from "../src/engine/tickets/checks";
import { handoffNotes, resolutionNotes } from "../src/engine/tickets/desk";
import type { Ticket } from "../src/engine/tickets/tickets";

const data = gameData();
const fmt = (m: number) => formatTime(data.calendar, m);

function setup(seed: string, caseId?: string) {
  const g = newGame(seed, data, caseId ? { caseId } : {});
  const caseOf = (id: string) =>
    g.world.cases.find((c) => c.caseId === id) as (typeof g.world.cases)[number];
  const dev = (caseId: string, role: string) =>
    g.world.devices.find((d) => d.id === caseOf(caseId).bindings[role]) as Device;
  const act = (a: Parameters<typeof applyAction>[2]) => applyAction(g, data, a);
  const server = g.world.devices.find((d) => d.kind === "server") as Device;
  /** SSH from an RMM host to an address with the docs credentials. Returns the session id. */
  const ssh = (from: Device, target: Device, address: string) => {
    const r = act({ t: "rmm-open", device: from.id });
    expect(r.ok, r.error).toBe(true);
    const cred = g.world.docs.credentials.find((c) => c.deviceId === target.id);
    const s = act({
      t: "rmm",
      session: r.session as string,
      line: `ssh ${cred?.username}@${address}`,
    });
    expect(s.session, s.output?.join("\n")).toBeTruthy();
    act({ t: "cli", session: s.session as string, line: cred?.password ?? "" });
    return s.session as string;
  };
  const cli = (session: string, lines: string[]) =>
    lines.map((line) => act({ t: "cli", session, line }).output ?? []);
  return { g, caseOf, dev, act, ssh, cli, server };
}

function waitForClient(g: GameState, act: (a: Parameters<typeof applyAction>[2]) => unknown) {
  // Client hours are hidden; step forward until someone answers.
  const h = g.world.client.businessHours;
  const m = g.clock.now % 1440;
  if (m < h.start) act({ t: "advance", minutes: h.start - m + 5 });
}

/** Ring the client's contacts until one picks up. Returns the call id. */
function dialUntilAnswered(
  g: GameState,
  act: (a: Parameters<typeof applyAction>[2]) => { session?: string },
  ticket: string,
): string {
  for (let i = 0; i < 60; i++) {
    for (const c of g.world.client.contacts) {
      const id = act({ t: "call", person: c.id, ticket }).session as string;
      if (g.calls?.[id]?.answered) return id;
    }
    act({ t: "advance", minutes: 20 });
  }
  throw new Error("nobody answered");
}

function close(
  g: GameState,
  act: (a: Parameters<typeof applyAction>[2]) => { output?: string[] },
  ticketTitle: string,
  proofSession: string,
) {
  const t = g.book.tickets.find((x) => x.title === ticketTitle);
  expect(t).toBeTruthy();
  const id = t?.id as string;
  act({ t: "ticket-open", ticket: id });
  act({ t: "attach-proof", ticket: id, source: proofSession });
  if (t?.origin === "client") {
    const notes = handoffNotes(data, g.world, t, "customer-question");
    act({
      t: "handoff",
      ticket: id,
      handoff: "customer-question",
      note: notes.findIndex((n) => n.quality === "good"),
      detail: "Can you test it?",
      askClose: true,
    });
    act({ t: "advance", minutes: 240 });
    expect(t.clientConfirmed).toBe(true);
  }
  const c = g.world.cases.find((x) => x.caseId === t?.caseId);
  if (!c || !t) throw new Error("no case");
  const best = resolutionNotes(g.world, t, c).findIndex((n) => n.parts.length === 6);
  const r = act({ t: "resolve", ticket: id, note: best });
  expect(r.output).toEqual([]);
  expect(g.score.some((e) => e.ticketId === id && e.reason.includes("closed with proof"))).toBe(
    true,
  );
}

describe("first slice cases play end to end", () => {
  for (const seed of ["case-a", "case-b", "case-c"]) {
    it(`${seed}: Camera Day, fixed over SSH on the Aurora switch`, () => {
      const { g, caseOf, dev, ssh, cli, server, act } = setup(seed);
      const c = caseOf("camera-day");
      const sw = dev("camera-day", "switch");
      const ap = dev("camera-day", "ap");
      expect(caseFixed(g.world, c, g.clock.now)).toBe(false);
      const s = ssh(
        server,
        sw,
        g.world.docs.devices.find((d) => d.deviceId === sw.id)?.ip as string,
      );
      const [poe] = cli(s, ["show power-over-ethernet"]);
      expect(poe?.join("\n")).toContain("Denied");
      const apPort = sw.ports.find((p) => p.link?.device === ap.id)?.name as string;
      // Every AP and phone port, or raising one AP knocks the next one off the budget.
      const phonePorts = sw.ports
        .filter((p) =>
          ["phone", "ap"].includes(
            g.world.devices.find((d) => d.id === p.link?.device)?.kind as string,
          ),
        )
        .map((p) => p.name);
      cli(s, [
        "configure terminal",
        `interface ${apPort}`,
        "power-over-ethernet priority high",
        ...phonePorts.flatMap((p) => [`interface ${p}`, "power-over-ethernet priority high"]),
        "end",
        "write memory",
      ]);
      expect(caseFixed(g.world, c, g.clock.now)).toBe(true);
      cli(s, ["show power-over-ethernet"]);
      close(g, act, c.ticketTitle, s);
    });

    it(`${seed}: Wrong Phonebook, DNS reset by script with consent`, () => {
      const { g, caseOf, dev, act } = setup(seed);
      const c = caseOf("wrong-phonebook");
      const pc = dev("wrong-phonebook", "user-pc");
      waitForClient(g, act);
      const shell = act({ t: "rmm-open", device: pc.id });
      expect(g.score.some((e) => e.reason.includes("without"))).toBe(true);
      const out = act({
        t: "rmm",
        session: shell.session as string,
        line: "ipconfig /all",
      }).output?.join("\n");
      expect(out).toContain("8.8.8.8");
      const consent = act({ t: "consent-request", device: pc.id });
      expect(consent.output?.[0]).toContain("go ahead");
      act({ t: "rmm-script", device: pc.id, script: "reset-dns" });
      expect(caseFixed(g.world, c, g.clock.now)).toBe(true);
      const server = g.world.devices.find((d) => d.kind === "server") as Device;
      const ns = act({
        t: "rmm",
        session: shell.session as string,
        line: `nslookup ${server.hostname}`,
      }).output?.join("\n");
      expect(ns).toContain(server.ip);
      close(g, act, c.ticketTitle, shell.session as string);
    });

    it(`${seed}: Nobody Home, probe set to never sleep`, () => {
      const { g, caseOf, dev, act } = setup(seed);
      const c = caseOf("nobody-home");
      const probe = dev("nobody-home", "probe");
      const shell = act({ t: "rmm-open", device: probe.id });
      const pc = act({
        t: "rmm",
        session: shell.session as string,
        line: "powercfg /query",
      }).output?.join("\n");
      expect(pc).toContain("30 minutes");
      act({ t: "rmm-script", device: probe.id, script: "power-never-sleep" });
      act({ t: "rmm", session: shell.session as string, line: "powercfg /query" });
      expect(caseFixed(g.world, c, g.clock.now)).toBe(true);
      close(g, act, c.ticketTitle, shell.session as string);
    });

    it(`${seed}: Branch Silence, both firewalls fixed`, () => {
      const { g, caseOf, dev, act, ssh, cli, server } = setup(seed);
      const c = caseOf("branch-silence");
      const hq = dev("branch-silence", "fw-hq");
      const br = dev("branch-silence", "fw-branch");
      const pc = dev("branch-silence", "branch-pc");
      const hqSite = g.world.sites.find((s) => s.id === "hq");
      const s1 = ssh(
        server,
        hq,
        g.world.docs.devices.find((d) => d.deviceId === hq.id)?.ip as string,
      );
      const [sum, log] = cli(s1, ["get vpn ipsec tunnel summary", "diagnose vpn ike log"]);
      expect(sum?.join("\n")).toContain("selectors(total,up): 1/0");
      expect(log?.join("\n")).toContain("no response");
      const newIp = publicIp(g.world, pc);
      expect(log?.join("\n")).toContain(newIp);
      cli(s1, [
        "config vpn ipsec phase1-interface",
        "edit to-branch",
        `set remote-gw ${newIp}`,
        "next",
        "end",
      ]);
      expect(
        tunnelStates(g.world, netState(g.world, g.clock.now)).find((t) => t.firewallId === hq.id)
          ?.error,
      ).toBe("selector-mismatch");
      waitForClient(g, act);
      act({ t: "consent-request", device: pc.id });
      const s2 = ssh(pc, br, pc.gateway as string);
      const [blog] = cli(s2, ["diagnose vpn ike log"]);
      expect(blog?.join("\n")).toContain("no matching phase2 selectors");
      cli(s2, [
        "config vpn ipsec phase2-interface",
        "edit to-hq",
        `set dst-subnet 10.${hqSite?.octet}.0.0 255.255.0.0`,
        "next",
        "end",
      ]);
      expect(caseFixed(g.world, c, g.clock.now)).toBe(true);
      cli(s1, ["get vpn ipsec tunnel summary"]);
      act({ t: "doc-edit", target: "site:branch", field: "wanIp", value: newIp });
      expect(g.score.some((e) => e.reason.includes("Fixed the docs"))).toBe(true);
      close(g, act, c.ticketTitle, s1);
      expect(totalScore(g)).toBeGreaterThan(0);
    });
  }

  for (const seed of ["case-a", "case-b", "case-c"]) {
    it(`${seed}: Tuesday 7 PM, fixed by remote hands on a call`, () => {
      const { g, caseOf, dev, act, ssh, cli, server } = setup(seed);
      const c = caseOf("tuesday-seven");
      const fw = dev("tuesday-seven", "firewall");
      const t = g.book.tickets.find((x) => x.caseId === "tuesday-seven") as Ticket;
      const downs = ovikView(g.world, g.clock.now).history.filter((h) => h.state === "down");
      expect(downs.some((h) => fmt(h.at).startsWith("Tue") && fmt(h.at).endsWith("19:02"))).toBe(
        true,
      );
      const s1 = ssh(
        server,
        fw,
        g.world.docs.devices.find((d) => d.deviceId === fw.id)?.ip as string,
      );
      const [status] = cli(s1, ["get system performance status"]);
      expect(status?.join("\n")).toContain("Uptime: 6 days");
      waitForClient(g, act);
      const call = () => dialUntilAnswered(g, act, t.id);
      let id = call();
      const ask = (a: string, device?: string) => {
        if (g.calls?.[id]?.closed) id = call();
        return act({ t: "call-ask", call: id, ask: a, ...(device ? { device } : {}) });
      };
      expect(ask("closet-power").output?.join("\n")).toContain("power strip");
      for (let i = 0; i < 20 && !caseFixed(g.world, c, g.clock.now); i++) {
        ask("closet-wall-outlet");
        ask("power-source", fw.id);
      }
      expect(caseFixed(g.world, c, g.clock.now)).toBe(true);
      expect(ask("test").output?.join("\n")).toContain("wall outlet");
      expect(t.clientConfirmed).toBe(true);
      cli(s1, ["get system status"]);
      act({ t: "attach-proof", ticket: t.id, source: s1 });
      const best = resolutionNotes(g.world, t, c).findIndex((n) => n.parts.length === 6);
      expect(act({ t: "resolve", ticket: t.id, note: best }).output).toEqual([]);
      expect(
        g.score.some((e) => e.ticketId === t.id && e.reason.includes("closed with proof")),
      ).toBe(true);
    });
  }

  for (const seed of ["case-a", "case-b", "case-c"]) {
    it(`${seed}: Lights Out, recorder moved off the switched outlet`, () => {
      const { g, caseOf, dev, act, server } = setup(seed);
      const c = caseOf("lights-out");
      const nvr = dev("lights-out", "nvr");
      const t = g.book.tickets.find((x) => x.caseId === "lights-out") as Ticket;
      const hist = ovikView(g.world, g.clock.now).history.filter(
        (h) => h.hostname === nvr.hostname,
      );
      expect(hist.some((h) => h.state === "down" && fmt(h.at).endsWith("18:30"))).toBe(true);
      waitForClient(g, act);
      let id = dialUntilAnswered(g, act, t.id);
      const ask = (a: string, device?: string) => {
        if (g.calls?.[id]?.closed) id = dialUntilAnswered(g, act, t.id);
        return act({ t: "call-ask", call: id, ask: a, ...(device ? { device } : {}) });
      };
      // The fix only shows up once someone says what the recorder plugs into.
      expect(ask("nvr-always-on").ok).toBe(false);
      for (let i = 0; i < 10 && !g.heard?.includes(`power:${nvr.id}`); i++)
        ask("power-source", nvr.id);
      for (let i = 0; i < 20 && !caseFixed(g.world, c, g.clock.now); i++) {
        ask("nvr-always-on");
        ask("power-source", nvr.id);
      }
      expect(caseFixed(g.world, c, g.clock.now)).toBe(true);
      expect(ask("test").output?.join("\n")).toContain("always-on");
      const shell = act({ t: "rmm-open", device: server.id }).session as string;
      act({ t: "rmm", session: shell, line: `ping ${nvr.ip}` });
      act({ t: "attach-proof", ticket: t.id, source: shell });
      const best = resolutionNotes(g.world, t, c).findIndex((n) => n.parts.length === 6);
      expect(act({ t: "resolve", ticket: t.id, note: best }).output).toEqual([]);
      act({ t: "advance", minutes: 14 * 60 });
      expect(t.closedAt).toBeDefined();
    });
  }

  for (const seed of ["tidy-1", "tidy-2", "tidy-3"]) {
    it(`${seed}: Tidy Desk, a loop under a desk takes the office down`, () => {
      const { g, caseOf, dev, act, server } = setup(seed, "tidy-desk");
      const c = caseOf("tidy-desk");
      const sw = dev("tidy-desk", "switch");
      const fw = g.world.devices.find((d) => d.kind === "firewall") as Device;
      const t = g.book.tickets.find((x) => x.caseId === "tidy-desk") as Ticket;
      let ns = netState(g.world, g.clock.now);
      expect(ns.storm.get(sw.id)).toBe(true);
      expect(ns.online.get(server.id)).toBe(false);
      expect(ns.online.get(fw.id)).toBe(true);
      expect(act({ t: "rmm-open", device: server.id }).ok).toBe(false);
      waitForClient(g, act);
      let id = dialUntilAnswered(g, act, t.id);
      const ask = (a: string, device?: string) => {
        if (g.calls?.[id]?.closed) id = dialUntilAnswered(g, act, t.id);
        return act({ t: "call-ask", call: id, ask: a, ...(device ? { device } : {}) });
      };
      // Power-cycling the switch only buys a few quiet minutes.
      ask("power-cycle", sw.id);
      act({ t: "advance", minutes: 15 });
      expect(netState(g.world, g.clock.now).storm.get(sw.id)).toBe(true);
      expect(ask("unplug-desk-loop").ok).toBe(false);
      for (let i = 0; i < 10 && !g.heard?.includes("recent-changes"); i++) ask("recent-changes");
      for (let i = 0; i < 10 && !caseFixed(g.world, c, g.clock.now); i++) ask("unplug-desk-loop");
      expect(caseFixed(g.world, c, g.clock.now)).toBe(true);
      ns = netState(g.world, g.clock.now);
      expect(ns.online.get(server.id)).toBe(true);
      const shell = act({ t: "rmm-open", device: server.id }).session as string;
      act({ t: "rmm", session: shell, line: `ping ${sw.ip}` });
      act({ t: "attach-proof", ticket: t.id, source: shell });
      ask("test");
      const best = resolutionNotes(g.world, t, c).findIndex((n) => n.parts.length === 6);
      expect(act({ t: "resolve", ticket: t.id, note: best }).output).toEqual([]);
      act({ t: "advance", minutes: 120 });
      expect(t.closedAt).toBeDefined();
    });
  }

  it("misroute and duplicate go back to dispatch", () => {
    const { g, act } = setup("case-a");
    const edr = g.book.tickets.find((t) => t.extraId === "edr-misroute");
    const dup = g.book.tickets.find((t) => t.extraId === "ap-alert-duplicate");
    act({ t: "ticket-open", ticket: edr?.id as string });
    act({ t: "send-back", ticket: edr?.id as string, reason: "misrouted" });
    act({ t: "send-back", ticket: dup?.id as string, reason: "nothing" });
    expect(g.score.map((e) => e.points)).toEqual([15, -15]);
  });

  it("closing an unfixed ticket reopens it", () => {
    const { g, act, caseOf } = setup("case-a");
    const c = caseOf("nobody-home");
    const t = g.book.tickets.find((x) => x.caseId === "nobody-home");
    act({ t: "resolve", ticket: t?.id as string, note: 0 });
    act({ t: "advance", minutes: 120 });
    expect(t?.closedAt).toBeUndefined();
    expect(g.score.some((e) => e.reason.includes("reopened"))).toBe(true);
    expect(caseFixed(g.world, c, g.clock.now)).toBe(false);
  });
});

describe("a full slice playthrough saves and replays", () => {
  it("replays to the same state, with and without the snapshot", async () => {
    const { makeSave, loadSave } = await import("../src/engine/save/save");
    const { digest } = await import("../src/engine/util/hash");
    const { g, dev, act, ssh, cli, server } = setup("replay-1");
    const sw = dev("camera-day", "switch");
    const s = ssh(server, sw, g.world.docs.devices.find((d) => d.deviceId === sw.id)?.ip as string);
    for (let i = 0; i < 50; i++) cli(s, ["show power-over-ethernet"]);
    cli(s, [
      "configure terminal",
      "interface 1/1/1",
      "power-over-ethernet priority high",
      "end",
      "write memory",
    ]);
    const pc = dev("wrong-phonebook", "user-pc");
    waitForClient(g, act);
    act({ t: "consent-request", device: pc.id });
    act({ t: "rmm-script", device: pc.id, script: "reset-dns" });
    const t = g.book.tickets[0];
    act({
      t: "handoff",
      ticket: t?.id as string,
      handoff: "teams-call",
      note: 1,
      detail: "walk through it",
    });
    act({ t: "advance", minutes: 600 });
    const strip = (x: typeof g) => digest({ ...x, log: [], snapshot: undefined });
    const save = JSON.parse(JSON.stringify(makeSave(g)));
    expect(save.snapshot).toBeTruthy();
    expect(strip(loadSave(save, data))).toBe(strip(g));
    expect(strip(loadSave(save, data, { useSnapshot: false }))).toBe(strip(g));
  });
});
