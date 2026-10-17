import type { GameData } from "../data";
import type { CaseInstance, DocHistoryEntry, Docs } from "../model/types";
import type { Rng } from "../rng/rng";
import type { Draft } from "./faults";

const DAY = 1440;
const coworkers = ["Kyle (tier 2)", "Maria (tier 1)", "Dev (senior)"];

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
    if (d.credentials && !rng.chance(level.missingCredential)) {
      credentials.push({ deviceId: d.id, hostname: d.hostname, ...d.credentials });
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

  return {
    sites: snapshot.sites.map((s) => ({
      siteId: s.id,
      name: s.name,
      address: s.address,
      vlans: structuredClone(s.vlans),
      isp: { ...s.isp },
    })),
    devices,
    credentials,
    contacts: structuredClone(snapshot.client.contacts),
    floorPlan: rng.chance(0.15),
    accessNotes,
    history,
    accessLog,
  };
}
