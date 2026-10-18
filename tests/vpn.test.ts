import { describe, expect, it } from "vitest";
import { gameData } from "../src/engine/data";
import type { Device } from "../src/engine/model/types";
import { type GameState, applyAction, newGame } from "../src/engine/save/game";
import { caseFixed } from "../src/engine/tickets/checks";
import { authenticator } from "../src/engine/vpn/client";

const data = gameData();

/** First seed whose main office firewall gives the MSP a VPN with this sign-in. */
function vpnGame(mfa: "totp" | "push", opts: { caseId?: string } = {}) {
  for (let i = 0; i < 200; i++) {
    const g = newGame(`vpn-${mfa}-${i}`, data, opts);
    const fw = g.world.devices.find((d) => d.kind === "firewall" && d.siteId === "hq");
    if (fw?.vpn?.mfa === mfa) return { g, fw };
  }
  throw new Error(`no ${mfa} VPN seed`);
}

function tools(g: GameState, fw: Device) {
  const act = (a: Parameters<typeof applyAction>[2]) => applyAction(g, data, a);
  const doc = g.world.docs.sites.find((s) => s.siteId === "hq")?.vpn;
  const pass = g.world.docs.credentials.find((c) => c.deviceId === "vpn-hq")?.password as string;
  const port = (fw.running?.sslvpn as { port: number }).port;
  const code = () => authenticator(g.world, data, g.clock.now)[0]?.code;
  const connect = (extra: { code?: string; port?: number } = {}) =>
    act({
      t: "vpn-connect",
      app: doc?.app as string,
      gateway: doc?.gateway as string,
      port: extra.port ?? port,
      username: doc?.username as string,
      password: pass,
      code: extra.code ?? code(),
    });
  // An old app fails on 7.4 firmware until it is upgraded.
  const ready = () => {
    const r = connect();
    if (r.output?.join(" ").includes("-7200")) {
      expect(fw.firmware.startsWith("7.4")).toBe(true);
      expect(act({ t: "vpn-upgrade", app: doc?.app as string }).ok).toBe(true);
      return connect();
    }
    return r;
  };
  return { act, doc, pass, port, code, connect, ready };
}

describe("VPN client and authenticator", () => {
  it("docs hold the profile, the vault the password, and a fresh code connects", () => {
    const { g, fw } = vpnGame("totp");
    const { act, doc, ready } = tools(g, fw);
    expect(doc?.username).toBe(fw.vpn?.username);
    expect(g.world.docs.accessNotes.some((n) => n.includes("VPN"))).toBe(true);
    const r = ready();
    expect(r.ok, r.output?.join(" ")).toBe(true);
    expect(g.vpn?.conn?.fwId).toBe(fw.id);
    // The laptop terminal reaches the firewall over the tunnel.
    const sh = act({ t: "local-open" }).session as string;
    const docIp = g.world.docs.devices.find((d) => d.deviceId === fw.id)?.ip as string;
    const mgmt = (fw.running?.interfaces as Record<string, { ip?: string; allowaccess?: string[] }>)
      .mgmt;
    const target = mgmt?.ip?.split("/")[0] ?? docIp;
    const s = act({ t: "local", session: sh, line: `ssh admin@${target}` });
    expect(s.output?.join(" ")).toContain("Opened SSH");
    // Disconnect and the SSH session closes with the tunnel.
    act({ t: "vpn-disconnect" });
    expect(act({ t: "cli", session: s.session as string, line: "x" }).output?.join(" ")).toContain(
      "VPN is no longer connected",
    );
    // Without the VPN, the laptop reaches nothing.
    expect(act({ t: "local", session: sh, line: `ping ${target}` }).output).toContain(
      "Request timed out.",
    );
  });

  it("three bad codes lock the account; the wrong port never answers", () => {
    const { g, fw } = vpnGame("totp");
    const { act, doc, connect, port } = tools(g, fw);
    act({ t: "vpn-upgrade", app: doc?.app as string });
    const other = data.vpn.ports.find((p) => p !== port) as number;
    expect(connect({ port: other }).output?.join(" ")).toContain("(-5)");
    expect(connect({ code: "000000" }).output?.join(" ")).toContain("(-456)");
    connect({ code: "000001" });
    expect(connect({ code: "000002" }).output?.join(" ")).toContain("locked");
    expect(connect().output?.join(" ")).toContain("locked");
    expect(fw.vpn?.log.some((e) => e.text.includes("locked"))).toBe(true);
    act({ t: "advance", minutes: 31 });
    expect(connect().ok).toBe(true);
  });

  it("push sign-in waits for the phone and times out", () => {
    const { g, fw } = vpnGame("push");
    const { act, doc, connect } = tools(g, fw);
    act({ t: "vpn-upgrade", app: doc?.app as string });
    expect(connect().output?.join(" ")).toContain("Approve it on your phone");
    expect(act({ t: "vpn-push", approve: true }).ok).toBe(true);
    expect(g.vpn?.conn).toBeTruthy();
    connect();
    act({ t: "advance", minutes: 10 });
    expect(act({ t: "vpn-push", approve: true }).output?.join(" ")).toContain("timed out");
  });

  it("Codes Rejected: the firewall clock drifted; NTP back on and codes work", () => {
    const { g, fw } = vpnGame("totp", { caseId: "codes-rejected" });
    const { act, doc, connect } = tools(g, fw);
    const c = g.world.cases[0] as (typeof g.world.cases)[number];
    expect(c.caseId).toBe("codes-rejected");
    act({ t: "vpn-upgrade", app: doc?.app as string });
    expect(connect().output?.join(" ")).toContain("(-456)");
    // In from RMM instead, and fix NTP on the gate.
    const server = g.world.devices.find((d) => d.kind === "server") as Device;
    const r = act({ t: "rmm-open", device: server.id }).session as string;
    const cred = g.world.docs.credentials.find((x) => x.deviceId === fw.id);
    const factory = data.devices.get(fw.templateId)?.credentials;
    const mgmt = (fw.running?.interfaces as Record<string, { ip?: string }>).mgmt?.ip?.split(
      "/",
    )[0];
    const s = act({
      t: "rmm",
      session: r,
      line: `ssh ${cred?.username ?? factory?.username}@${mgmt}`,
    }).session as string;
    expect(s).toBeTruthy();
    act({ t: "cli", session: s, line: cred?.password ?? factory?.default ?? "" });
    const status = act({ t: "cli", session: s, line: "get system status" }).output?.join("\n");
    expect(status).toContain("System time");
    expect(
      act({ t: "cli", session: s, line: "diagnose vpn ssl log" }).output?.join("\n"),
    ).toContain("token code rejected");
    for (const line of ["config system ntp", "set ntpsync enable", "end"])
      act({ t: "cli", session: s, line });
    expect(caseFixed(g.world, c, g.clock.now)).toBe(true);
    expect(connect().ok).toBe(true);
  });
});
