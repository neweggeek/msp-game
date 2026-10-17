import { describe, expect, it } from "vitest";
import { gameData } from "../src/engine/data";
import type { Device } from "../src/engine/model/types";
import { ovikView } from "../src/engine/monitor/ovik";
import {
  type Action,
  applyAction,
  collateralDown,
  newGame,
  totalScore,
} from "../src/engine/save/game";
import * as desk from "../src/engine/tickets/desk";
import { webPage } from "../src/engine/web/web";

// Bugs found in the first playtest. Each one is pinned here so it stays fixed.
const data = gameData();

function setup(seed = "playtest-1") {
  const g = newGame(seed, data);
  const act = (a: Action) => applyAction(g, data, a);
  const server = g.world.devices.find((d) => d.kind === "server") as Device;
  const shell = act({ t: "rmm-open", device: server.id }).session as string;
  const rmm = (line: string) => (act({ t: "rmm", session: shell, line }).output ?? []).join("\n");
  return { g, act, server, shell, rmm };
}

describe("playtest fixes", () => {
  it("the agent browser does not crash on a name or junk", () => {
    const { g, server } = setup();
    for (const address of ["hello world", "fg-lfc01", "10.1", "", "https://"]) {
      const page = webPage(g.world, g.clock.now, server.id, address);
      expect(page.ok).toBe(false);
      expect(page.error).toContain("can't be reached");
    }
  });

  it("the branch's old WAN IP no longer answers ping", () => {
    const { g, rmm } = setup();
    const branch = g.world.docs.sites.find((s) => s.siteId === "branch");
    const out = rmm(`ping ${branch?.isp.wanIp}`);
    expect(out).toContain("Request timed out.");
  });

  it("the background shell handles common Windows habits", () => {
    const { g, server, rmm } = setup();
    expect(rmm("ipconfig /flushdns")).toContain("Successfully flushed");
    expect(rmm("ping 999.1.1.1")).toContain("could not find host");
    expect(rmm("ping 10.27.99")).toContain("could not find host");
    expect(rmm(`ping -n 2 ${server.ip}`)).toContain(`Reply from ${server.ip}`);
    expect(rmm(`nslookup ${server.ip}`)).toContain(`Name:    ${server.hostname}.`);
    expect(rmm(`nslookup ${server.ip} 8.8.8.8`)).toContain(`Name:    ${server.hostname}.`);
    expect(rmm(`ping ${server.ip} -n 2`)).toContain(`Reply from ${server.ip}`);
    const fw = g.world.devices.find((d) => d.kind === "firewall" && d.siteId === "hq") as Device;
    expect(rmm(`ssh admin@${fw.hostname}`)).not.toContain("usage");
    expect(rmm("ssh admin@nowhere-01")).toContain("Could not resolve hostname");
  });

  it("cls clears the shell", () => {
    const { g, shell, rmm } = setup();
    rmm("ipconfig");
    rmm("cls");
    expect(g.sessions[shell]?.transcript.length).toBe(1);
  });

  it("a ticket note counts as a response", () => {
    const { g, act } = setup();
    const t = g.book.tickets[0];
    act({ t: "ticket-note", ticket: t?.id as string, text: "Looking at FG-01 (10.1.99.1)." });
    expect(t?.respondedAt).toBeDefined();
  });

  it("closing an unfixed ticket pays nothing for its note", () => {
    const { g, act } = setup();
    const t = g.book.tickets.find((x) => x.caseId === "nobody-home");
    const before = totalScore(g);
    for (let i = 0; i < 3; i++) {
      act({ t: "resolve", ticket: t?.id as string, note: 0 });
      act({ t: "advance", minutes: 120 });
    }
    expect(totalScore(g)).toBeLessThan(before);
    expect(g.score.some((e) => e.reason.startsWith("Resolution note"))).toBe(false);
  });

  it("breaking a right doc entry and fixing it pays nothing", () => {
    const { g, act } = setup();
    const doc = g.world.docs.devices.find(
      (d) => d.ip === g.world.devices.find((x) => x.id === d.deviceId)?.ip,
    );
    const target = `device:${doc?.deviceId}`;
    const right = doc?.ip as string;
    act({ t: "doc-edit", target, field: "ip", value: "10.9.9.9" });
    act({ t: "doc-edit", target, field: "ip", value: right });
    expect(g.score.some((e) => e.reason.startsWith("Fixed the docs"))).toBe(false);
  });

  it("Ovik history does not name the fault", () => {
    const { g } = setup();
    const notes = ovikView(g.world, g.clock.now).history.map((h) => h.note);
    for (const f of data.faults.values()) expect(notes).not.toContain(f.name);
  });

  it("a cut-short switch command says incomplete", () => {
    const { g, act } = setup();
    const sw = g.world.devices.find((d) => d.kind === "switch" && d.dialect === "aurora-cx");
    if (!sw) return;
    const s = act({ t: "cli-open", device: sw.id }).session as string;
    for (const line of ["show", "write"])
      expect(act({ t: "cli", session: s, line }).output).toEqual(["Incomplete command."]);
  });
});

const CAMERA_SEEDS = ["case-a", "case-b", "case-c", "first-shift", "edge-1"];

/** Camera Day "fixed" by raising only the AP and phones, with the client saying other gear died. */
function cameraDayCollateral(seed: string) {
  const g = newGame(seed, data);
  const act = (a: Action) => applyAction(g, data, a);
  const c = g.world.cases.find((x) => x.caseId === "camera-day");
  const t = g.book.tickets.find((x) => x.caseId === "camera-day");
  if (!c || !t) return undefined;
  const sw = g.world.devices.find((d) => d.id === c.bindings.switch) as Device;
  const ap = c.bindings.ap;
  const s = act({ t: "cli-open", device: sw.id }).session as string;
  const ports = sw.ports
    .filter((p) => {
      const d = g.world.devices.find((x) => x.id === p.link?.device);
      return d?.id === ap || d?.kind === "phone";
    })
    .map((p) => p.name);
  for (const line of [
    "configure terminal",
    ...ports.flatMap((p) => [`interface ${p}`, "power-over-ethernet priority high"]),
    "end",
  ])
    act({ t: "cli", session: s, line });
  act({ t: "attach-proof", ticket: t.id, source: s });
  act({ t: "advance", minutes: 120 });
  act({
    t: "handoff",
    ticket: t.id,
    handoff: "customer-question",
    note: 0,
    detail: "",
    askClose: true,
  });
  act({ t: "advance", minutes: 240 });
  if (!t.history.some((h) => h.text.includes("stopped working"))) return undefined;
  return { g, act, t };
}

describe("playtest design calls", () => {
  it("cutting your own access drops the session, costs points and rolls back later", () => {
    const { g, act, rmm } = setup();
    const fw = g.world.devices.find((d) => d.kind === "firewall" && d.siteId === "hq") as Device;
    const cred = g.world.docs.credentials.find((c) => c.deviceId === fw.id);
    const s = act({
      t: "rmm",
      session: Object.keys(g.sessions)[0] as string,
      line: `ssh ${cred?.username}@${fw.ip}`,
    }).session as string;
    act({ t: "cli", session: s, line: cred?.password ?? "" });
    const out = ["config system interface", "edit wan1", "set status down", "next", "end"]
      .map((line) => (act({ t: "cli", session: s, line }).output ?? []).join("\n"))
      .join("\n");
    expect(out).toContain("closed by remote host");
    expect(g.sessions[s]?.closed).toBe(true);
    expect(g.score.some((e) => e.reason.startsWith("Locked yourself out"))).toBe(true);
    expect(rmm("hostname")).toContain("Agent went offline");
    act({ t: "advance", minutes: 24 * 60 });
    const server = g.world.devices.find((d) => d.kind === "server") as Device;
    expect(act({ t: "rmm-open", device: server.id }).ok).toBe(true);
  });

  it("Camera Day with only the AP and phones raised knocks other APs off and is not a clean close", () => {
    let seen = 0;
    for (const seed of CAMERA_SEEDS) {
      const run = cameraDayCollateral(seed);
      if (!run) continue;
      const { g, act, t } = run;
      seen++;
      expect(t.clientConfirmed).toBe(false);
      act({ t: "resolve", ticket: t.id, note: 0 });
      expect(g.score.some((e) => e.reason.includes("because of a change"))).toBe(true);
      expect(g.score.some((e) => e.reason.includes("closed with proof"))).toBe(false);
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("an outage already paid for still blocks the clean bonus and still costs the proof penalty", () => {
    let seen = 0;
    for (const seed of CAMERA_SEEDS) {
      const run = cameraDayCollateral(seed);
      if (!run) continue;
      const { g, act, t } = run;
      seen++;
      // As if an earlier close at this site already paid for these outages.
      g.collateral = collateralDown(g);
      act({ t: "resolve", ticket: t.id, note: 0 });
      const mine = g.score.filter((e) => e.ticketId === t.id).map((e) => e.reason);
      expect(mine.some((r) => r.includes("because of a change"))).toBe(false);
      expect(mine.some((r) => r.includes("closed with proof"))).toBe(false);
      expect(mine.some((r) => r.includes("without the proof"))).toBe(true);
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("every resolution note has the same six lines", () => {
    const { g } = setup();
    const { resolutionNotes } = desk;
    for (const t of g.book.tickets) {
      const c = g.world.cases.find((x) => x.caseId === t.caseId);
      if (!c) continue;
      for (const n of resolutionNotes(g.world, t, c)) expect(n.lines).toHaveLength(6);
    }
  });

  it("resolving a misroute closes it but costs points", () => {
    const { g, act } = setup();
    const t = g.book.tickets.find((x) => x.extraId === "edr-misroute");
    const r = act({ t: "resolve", ticket: t?.id as string, note: 0 });
    expect(r.ok).toBe(true);
    expect(t?.closedAt).toBeDefined();
    expect(g.score.some((e) => e.reason.includes("not a network problem"))).toBe(true);
  });
});

describe("playtest leftovers", () => {
  it("a stale Ovik address can be pointed at the device, which clears the alert and pays once", () => {
    const { g, act } = setup();
    const row = g.world.monitoring.inventory.find(
      (o) => o.ip !== g.world.devices.find((d) => d.id === o.deviceId)?.ip,
    );
    expect(row).toBeTruthy();
    const dev = g.world.devices.find((d) => d.id === row?.deviceId) as Device;
    const target = `ovik:${dev.id}`;
    expect(act({ t: "doc-edit", target, field: "ip", value: "not an ip" }).ok).toBe(false);
    act({ t: "doc-edit", target, field: "ip", value: dev.ip as string });
    const v = ovikView(g.world, g.clock.now);
    expect(v.inventory.find((r) => r.deviceId === dev.id)?.ip).toBe(dev.ip);
    expect(v.alerts.some((a) => a.deviceId === dev.id)).toBe(false);
    act({ t: "doc-edit", target, field: "ip", value: "10.9.9.9" });
    act({ t: "doc-edit", target, field: "ip", value: dev.ip as string });
    expect(g.score.filter((e) => e.reason.startsWith("Fixed Ovik"))).toHaveLength(1);
    // Ovik edits are Ovik's, not a Hoodoo docs change.
    expect(g.world.docs.history.some((h) => h.entry === target)).toBe(false);
  });

  it("a device missing from the docs can be added, and only a real one pays", () => {
    const { g, act } = setup();
    const missing = g.world.devices.find(
      (d) => d.ip && !g.world.docs.devices.some((x) => x.deviceId === d.id),
    ) as Device;
    expect(missing).toBeTruthy();
    const add = (ip: string) =>
      act({ t: "doc-add", site: missing.siteId, hostname: "CAM-NEW", ip, kind: missing.kind });
    expect(add("10.300.1.1").ok).toBe(false);
    expect(add("10.250.250.250").ok).toBe(true);
    expect(g.score.some((e) => e.reason.startsWith("Added"))).toBe(false);
    expect(add(missing.ip as string).ok).toBe(true);
    expect(add(missing.ip as string).ok).toBe(true);
    expect(g.score.filter((e) => e.reason.startsWith("Added"))).toHaveLength(1);
    expect(g.world.docs.devices.filter((d) => d.ip === missing.ip)).toHaveLength(2);
    expect(g.world.docs.devices.some((d) => d.deviceId === missing.id)).toBe(true);
  });

  it("the WAN block and gateway can be fixed after a WAN IP change", () => {
    const { g, act } = setup("first-shift");
    const site = g.world.sites.find((s) => s.id === "branch");
    const doc = g.world.docs.sites.find((s) => s.siteId === "branch");
    if (!site || !doc) throw new Error("no branch");
    expect(doc.isp.wanCidr).not.toBe(site.isp.wanCidr);
    act({ t: "doc-edit", target: "site:branch", field: "wanCidr", value: site.isp.wanCidr });
    act({ t: "doc-edit", target: "site:branch", field: "gateway", value: site.isp.gateway });
    expect(doc.isp.wanCidr).toBe(site.isp.wanCidr);
    expect(g.score.filter((e) => e.reason.startsWith("Fixed the docs"))).toHaveLength(2);
  });
});

describe("playtest small leftovers", () => {
  it("an earlier command's output can be attached, not just the last one", () => {
    const { g, act, shell, rmm, server } = setup();
    rmm("ipconfig");
    rmm(`ping ${server.ip}`);
    const t = g.book.tickets[0];
    if (!t) throw new Error("no ticket");
    expect(g.sessions[shell]?.outputs?.map((o) => o.line)).toEqual([
      "ipconfig",
      `ping ${server.ip}`,
    ]);
    expect(act({ t: "attach-proof", ticket: t.id, source: `${shell}#0` }).ok).toBe(true);
    expect(t.proofs.at(-1)?.source).toContain(": ipconfig");
    expect(act({ t: "attach-proof", ticket: t.id, source: `${shell}#9` }).ok).toBe(false);
  });

  it("staff first names do not repeat at one client", () => {
    const g = newGame("playtest-1", data);
    const firsts = g.world.client.staff.slice(0, 40).map((n) => n.split(" ")[0]);
    expect(new Set(firsts).size).toBe(firsts.length);
  });
});
