import { describe, expect, it } from "vitest";
import { gameData } from "../src/engine/data";
import type { Device } from "../src/engine/model/types";
import { type GameState, applyAction, newGame } from "../src/engine/save/game";

const data = gameData();

/** First slice seed where the test finds what it needs. */
function find(pred: (g: GameState) => Device | undefined): { g: GameState; dev: Device } {
  for (let i = 0; i < 400; i++) {
    const g = newGame(`ladder-${i}`, data);
    const dev = pred(g);
    if (dev) return { g, dev };
  }
  throw new Error("no seed");
}

/** SSH from the HQ server with this password. True when it logs in. */
function login(g: GameState, dev: Device, password: string): boolean {
  const act = (a: Parameters<typeof applyAction>[2]) => applyAction(g, data, a);
  const server = g.world.devices.find((d) => d.kind === "server") as Device;
  const r = act({ t: "rmm-open", device: server.id });
  const s = act({ t: "rmm", session: r.session as string, line: `ssh admin@${dev.ip}` });
  if (!s.session) return false;
  const out = act({ t: "cli", session: s.session, line: password }).output ?? [];
  return !out.join("\n").includes("Permission denied");
}

function call(g: GameState, person: string, ask: string, device: string): string {
  const act = (a: Parameters<typeof applyAction>[2]) => applyAction(g, data, a);
  for (let i = 0; i < 40; i++) {
    const id = act({ t: "call", person }).session as string;
    if (g.calls?.[id]?.answered)
      return act({ t: "call-ask", call: id, ask, device }).output?.join("\n") ?? "";
    act({ t: "advance", minutes: 30 });
  }
  throw new Error("nobody answered");
}

const hqGear = (g: GameState) =>
  g.world.devices.filter((d) => d.credentials && d.siteId === "hq" && !d.credentials.disabled);

describe("credential ladder", () => {
  it("a vault typo: the docs history still has the working password", () => {
    const { g, dev } = find((g) =>
      hqGear(g).find((d) =>
        g.world.docs.history.some((h) => h.entry === `vault:${d.id}` && h.field === "password"),
      ),
    );
    const vault = g.world.docs.credentials.find((c) => c.deviceId === dev.id)?.password ?? "";
    const old = g.world.docs.history.find((h) => h.entry === `vault:${dev.id}`)?.from ?? "";
    expect(login(g, dev, vault)).toBe(false);
    expect(login(g, dev, old)).toBe(true);
  });

  it("an unsaved change: the coworker in the access log knows it and fixes the vault", () => {
    const { g, dev } = find((g) =>
      hqGear(g).find((d) => g.world.docs.unsaved.some((u) => u.deviceId === d.id)),
    );
    const who = g.world.docs.unsaved.find((u) => u.deviceId === dev.id)?.who;
    expect(g.world.docs.accessLog.some((a) => a.who === who && a.entry === `vault:${dev.id}`)).toBe(
      true,
    );
    const team = data.calls.team.people.find((p) => `${p.name} (${p.role})` === who);
    const other = data.calls.team.people.find((p) => p !== team);
    expect(call(g, `team:${other?.id}`, "vault-password", dev.id)).toContain("haven't touched");
    expect(call(g, `team:${team?.id}`, "vault-password", dev.id)).toContain(
      dev.credentials?.password,
    );
    const vault = g.world.docs.credentials.find((c) => c.deviceId === dev.id)?.password ?? "";
    expect(login(g, dev, vault)).toBe(true);
  });

  it("a factory password: the vendor KB login works and the vault has no entry", () => {
    const { g, dev } = find((g) =>
      hqGear(g).find(
        (d) => d.credentials?.password === data.devices.get(d.templateId)?.credentials?.default,
      ),
    );
    expect(g.world.docs.credentials.some((c) => c.deviceId === dev.id)).toBe(false);
    expect(login(g, dev, dev.credentials?.password ?? "")).toBe(true);
  });

  it("a disabled account fails with the right password until the main contact turns it on", () => {
    const { g, dev } = find((g) =>
      g.world.devices.find(
        (d) => d.kind === "firewall" && d.siteId === "hq" && d.credentials?.disabled,
      ),
    );
    expect(g.world.docs.accessNotes.join(" ")).toContain("turns our firewall admin account off");
    const pw = dev.credentials?.password ?? "";
    expect(login(g, dev, pw)).toBe(false);
    const main = g.world.client.contacts[0]?.id as string;
    const other = g.world.client.contacts[1]?.id;
    if (other) expect(call(g, other, "enable-account", dev.id)).toContain("can't do that");
    for (let i = 0; i < 6 && dev.credentials?.disabled; i++)
      call(g, main, "enable-account", dev.id);
    expect(login(g, dev, pw)).toBe(true);
  });
});
