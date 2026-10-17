import { describe, expect, it } from "vitest";
import { gameData } from "../src/engine/data";
import type { Device } from "../src/engine/model/types";
import { ovikView } from "../src/engine/monitor/ovik";
import { type Action, applyAction, newGame, totalScore } from "../src/engine/save/game";
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
