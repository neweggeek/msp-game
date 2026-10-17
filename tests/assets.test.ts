import { describe, expect, it } from "vitest";
import { gameData } from "../src/engine/data";
import { assetTypeOf, connectCommand } from "../src/engine/docs/assets";
import type { Device } from "../src/engine/model/types";
import { applyAction, newGame } from "../src/engine/save/game";

const data = gameData();

describe("asset types and connect commands", () => {
  it("every device kind maps to one asset type", () => {
    const g = newGame("assets-1", data);
    expect(assetTypeOf(data, "pc")).toBe("workstation");
    expect(assetTypeOf(data, "firewall")).toBe("firewall");
  });

  it("the copied firewall command opens SSH from an RMM shell", () => {
    const g = newGame("assets-1", data);
    const act = (a: Parameters<typeof applyAction>[2]) => applyAction(g, data, a);
    const fw = g.world.devices.find((d) => d.kind === "firewall" && d.siteId === "hq") as Device;
    const doc = g.world.docs.devices.find((d) => d.deviceId === fw.id);
    const cmd = connectCommand(g.world, data, fw.id);
    expect(cmd).toBe(`ssh admin@${doc?.ip}`);
    const server = g.world.devices.find((d) => d.kind === "server") as Device;
    const r = act({ t: "rmm-open", device: server.id });
    const s = act({ t: "rmm", session: r.session as string, line: cmd as string });
    expect(doc?.ip).toBe(fw.ip);
    expect(s.session, s.output?.join("\n")).toBeTruthy();
  });

  it("devices with no CLI get no connect command", () => {
    const g = newGame("assets-1", data);
    for (const d of g.world.devices.filter((x) => !data.devices.get(x.templateId)?.dialect))
      expect(connectCommand(g.world, data, d.id)).toBeUndefined();
  });

  it("sites with access points document Wi-Fi with a vault passphrase", () => {
    for (let i = 0; i < 20; i++) {
      const g = newGame(`assets-wifi-${i}`, data);
      for (const site of g.world.sites) {
        const hasAp = g.world.devices.some((d) => d.kind === "ap" && d.siteId === site.id);
        const wifi = g.world.docs.wifi.filter((w) => w.siteId === site.id);
        expect(wifi.length > 0, `${site.id} seed ${i}`).toBe(hasAp);
        for (const w of wifi) {
          expect(w.ssid).toContain(g.world.client.code);
          expect(site.vlans.some((v) => v.id === w.vlan)).toBe(true);
          const psk = g.world.docs.credentials.find((c) => c.deviceId === w.id);
          expect(psk?.password.length).toBeGreaterThan(6);
          expect(applyAction(g, data, { t: "vault-view", device: w.id }).ok).toBe(true);
        }
      }
    }
  });
});
