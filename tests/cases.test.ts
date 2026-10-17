import { describe, expect, it } from "vitest";
import { gameData } from "../src/engine/data";
import type { Device } from "../src/engine/model/types";
import { netState } from "../src/engine/net/state";
import { tunnelStates } from "../src/engine/net/vpn";
import { publicIp } from "../src/engine/rmm/rmm";
import { type GameState, applyAction, newGame, totalScore } from "../src/engine/save/game";
import { caseFixed } from "../src/engine/tickets/checks";
import { handoffNotes, resolutionNotes } from "../src/engine/tickets/desk";

const data = gameData();

function setup(seed: string) {
  const g = newGame(seed, data);
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
