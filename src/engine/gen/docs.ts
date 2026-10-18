import type { GameData } from "../data";
import type { CaseInstance, DocHistoryEntry, Docs } from "../model/types";
import type { Rng } from "../rng/rng";
import type { Draft } from "./faults";

const DAY = 1440;

/**
 * Write what the MSP knows. Docs come from the network as it was before the
 * faults, then degrade by the client's staleness level.
 */
export function genDocs(
  rng: Rng,
  data: GameData,
  snapshot: Draft,
  cases: CaseInstance[],
  playStart: number,
): Docs {
  const level = data.staleness.levels[snapshot.client.staleness];
  const coworkers = data.calls.team.people.map((p) => `${p.name} (${p.role})`);
  const unsaved: Docs["unsaved"] = [];
  const devices: Docs["devices"] = [];
  const credentials: Docs["credentials"] = [];
  const history: DocHistoryEntry[] = [];
  const accessLog: Docs["accessLog"] = [];
  const bound = new Set(cases.flatMap((c) => Object.values(c.bindings)));

  for (const d of snapshot.devices) {
    // Devices a case is about stay in the docs, or the case has nothing to point at.
    if (!bound.has(d.id) && rng.chance(level.missingDevice)) continue;
    const t = data.devices.get(d.templateId);
    let ip = d.ip;
    if (ip && rng.chance(level.wrongIp)) {
      const parts = ip.split(".");
      parts[3] = String(((Number(parts[3]) + rng.int(1, 40)) % 250) + 2);
      const stale = parts.join(".");
      history.push({
        at: d.bootAt - rng.int(30, 200) * DAY,
        by: rng.pick(coworkers),
        entry: `device:${d.id}`,
        field: "ip",
        from: "",
        to: stale,
      });
      ip = stale;
    }
    let firmware = d.firmware;
    if (t && t.firmware.length > 1 && rng.chance(level.wrongFirmware)) {
      firmware = rng.pick(t.firmware.filter((f) => f !== d.firmware));
    }
    const entry: Docs["devices"][number] = {
      deviceId: d.id,
      siteId: d.siteId,
      hostname: d.hostname,
      kind: d.kind,
      model: d.model,
      firmware,
      roomId: d.roomId,
    };
    if (ip) entry.ip = ip;
    if (d.user) entry.notes = `Assigned to ${d.user}.`;
    if (d.tags?.includes("probe")) entry.notes = "Ovik collector. Leave on.";
    devices.push(entry);
    const factory = data.devices.get(d.templateId)?.credentials?.default;
    // Still on the factory password: nobody ever made a vault entry.
    const onFactory = factory !== undefined && d.credentials?.password === factory;
    if (d.credentials && !onFactory && !rng.chance(level.missingCredential)) {
      const { username, password } = d.credentials;
      if (rng.chance(level.wrongCredential)) {
        const wrong = `${rng.pick(["Blue", "Iron", "Delta", "Quartz", "Maple"])}-${rng.hex(6)}!`;
        const who = rng.pick(coworkers);
        const at = playStart - rng.int(3, 60) * DAY;
        credentials.push({ deviceId: d.id, hostname: d.hostname, username, password: wrong });
        if (rng.chance(0.5)) {
          // Saved over the good one with a typo. The history still has it.
          history.push({
            at,
            by: who,
            entry: `vault:${d.id}`,
            field: "password",
            from: password,
            to: wrong,
          });
        } else {
          // Changed it on the device and never saved it. Only they know.
          unsaved.push({ deviceId: d.id, who });
          accessLog.push({ at, who, entry: `vault:${d.id}` });
        }
      } else credentials.push({ deviceId: d.id, hostname: d.hostname, username, password });
    }
  }

  // Vault reads, the trail a coworker leaves behind.
  for (const c of cases) {
    for (const h of c.ticketHistory) {
      const fw = credentials.find(
        (x) =>
          Object.values(c.bindings).includes(x.deviceId) &&
          snapshot.devices.find((d) => d.id === x.deviceId)?.kind === "firewall" &&
          h.text.includes(x.hostname),
      );
      if (fw)
        accessLog.push({ at: h.at - rng.int(5, 25), who: h.by, entry: `vault:${fw.deviceId}` });
    }
  }
  for (let i = 0; i < 4; i++) {
    const cred = credentials.length > 0 ? rng.pick(credentials) : undefined;
    if (cred)
      accessLog.push({
        at: playStart - rng.int(2, 40) * DAY,
        who: rng.pick(coworkers),
        entry: `vault:${cred.deviceId}`,
      });
  }
  accessLog.sort((a, b) => a.at - b.at);
  history.sort((a, b) => a.at - b.at);

  const accessNotes: string[] = [];
  const server = snapshot.devices.find((d) => d.kind === "server");
  for (const site of snapshot.sites) {
    const fw = devices.find((d) => d.kind === "firewall" && d.siteId === site.id);
    if (!fw) continue;
    if (site.id === "hq" && server) {
      accessNotes.push(
        `${site.name}: land on ${server.hostname} (${server.ip}) through Shinobi RMM, then SSH to ${fw.hostname} at ${fw.ip ?? "its LAN IP"}.`,
      );
    } else {
      accessNotes.push(
        `${site.name}: no server. SSH to ${fw.hostname} from a PC at the site, or over the tunnel from ${server?.hostname ?? "the main office"}.`,
      );
    }
  }

  if (snapshot.client.disablesMspAccounts) {
    const main = snapshot.client.contacts[0]?.name ?? "the client";
    accessNotes.push(
      `${snapshot.client.name} turns our firewall admin account off when no ticket is open. Call ${main} to turn it back on. They are fine with a call for this.`,
    );
  }

  // The MSP's VPN profile. A stale page can have an old port.
  const vpns: Record<string, Docs["sites"][number]["vpn"]> = {};
  const vrng = rng.fork("vpn");
  for (const fw of snapshot.devices.filter((d) => d.kind === "firewall" && d.vpn)) {
    const v = fw.vpn as NonNullable<typeof fw.vpn>;
    const site = snapshot.sites.find((x) => x.id === fw.siteId);
    const app = data.vpn.apps.find((a) => a.brand === fw.brand);
    const real = Number((fw.running?.sslvpn as Record<string, unknown> | undefined)?.port ?? 443);
    const port = vrng.chance(data.vpn.wrongPort[snapshot.client.staleness])
      ? (data.vpn.ports.find((p) => p !== real) ?? real)
      : real;
    if (!site || !app) continue;
    vpns[site.id] = {
      app: app.name,
      gateway: site.isp.wanIp,
      port,
      username: v.username,
      mfa: v.mfa,
    };
    credentials.push({
      deviceId: `vpn-${site.id}`,
      hostname: `${site.name} VPN`,
      username: v.username,
      password: v.password,
    });
    accessNotes.push(
      `${site.name}: we have a VPN. Connect ${app.name} to ${site.isp.wanIp} port ${port} as ${v.username}, ${v.mfa === "push" ? "approve the push on the MSP authenticator" : "with a code from the MSP authenticator"}, then SSH from the laptop terminal.`,
    );
  }

  // Cloud-managed gear: the dashboard login is the only way in, so it must be in the docs.
  let cloud: Docs["cloud"];
  if (snapshot.cloudOrg) {
    const org = snapshot.cloudOrg;
    cloud = {
      dashboard: data.cloud.name,
      url: data.cloud.url,
      org: org.name,
      username: org.username,
    };
    credentials.push({
      deviceId: "cloud",
      hostname: data.cloud.name,
      username: org.username,
      password: org.password,
    });
    accessNotes.push(
      `The switches are cloud-managed and have no CLI. Sign in to the ${data.cloud.name} (${data.cloud.url}) as ${org.username}. The password is in the vault.`,
    );
  }

  const floorPlan = rng.chance(0.15);

  // Wi-Fi: one set of networks per site with access points. Passphrases live in the vault.
  const wifi: Docs["wifi"] = [];
  for (const site of snapshot.sites) {
    if (!snapshot.devices.some((d) => d.kind === "ap" && d.siteId === site.id)) continue;
    data.assets.wifi.networks.forEach((n, i) => {
      const vlan = site.vlans.find((v) => v.role === n.vlan);
      if (!vlan) return;
      const id = `wifi-${site.id}-${i + 1}`;
      const ssid = n.ssid.replace("{code}", snapshot.client.code);
      const entry: Docs["wifi"][number] = {
        id,
        siteId: site.id,
        ssid,
        vlan: vlan.id,
        security: n.security,
      };
      if (n.notes) entry.notes = n.notes;
      wifi.push(entry);
      credentials.push({
        deviceId: id,
        hostname: ssid,
        username: "PSK",
        password: `${rng.pick(["Harbor", "Cedar", "Copper", "Lantern", "Orchid"])}${rng.int(10, 99)}-${rng.hex(4)}`,
      });
    });
  }

  return {
    sites: snapshot.sites.map((s) => ({
      siteId: s.id,
      name: s.name,
      address: s.address,
      vlans: structuredClone(s.vlans),
      // Nobody wrote the ISP's security PIN down at some clients. It is on the bill.
      isp: { ...s.isp, pin: rng.chance(level.missingCredential * 3) ? "" : s.isp.pin },
      ...(vpns[s.id] ? { vpn: vpns[s.id] } : {}),
    })),
    devices,
    credentials,
    wifi,
    contacts: structuredClone(snapshot.client.contacts),
    floorPlan,
    accessNotes,
    ...(cloud ? { cloud } : {}),
    history,
    accessLog,
    unsaved,
  };
}
