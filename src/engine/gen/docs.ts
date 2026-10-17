import type { GameData } from "../data";
import type { Docs, World } from "../model/types";
import type { Rng } from "../rng/rng";

type Draft = Omit<World, "docs" | "solvability">;

/** Write what the MSP knows, then degrade it by the client's staleness level. */
export function genDocs(rng: Rng, data: GameData, draft: Draft): Docs {
  const level = data.staleness.levels[draft.client.staleness];
  const devices: Docs["devices"] = [];
  const credentials: Docs["credentials"] = [];

  for (const d of draft.devices) {
    if (d.undocumented) continue;
    if (rng.chance(level.missingDevice)) continue;
    const t = data.devices.get(d.templateId);
    let ip = d.ip;
    if (ip && rng.chance(level.wrongIp)) {
      const parts = ip.split(".");
      const last = Number(parts[3]);
      parts[3] = String(((last + rng.int(1, 40)) % 250) + 2);
      ip = parts.join(".");
    }
    let firmware = d.firmware;
    if (t && t.firmware.length > 1 && rng.chance(level.wrongFirmware)) {
      firmware = rng.pick(t.firmware.filter((f) => f !== d.firmware));
    }
    const entry: Docs["devices"][number] = {
      deviceId: d.id,
      hostname: d.hostname,
      kind: d.kind,
      model: d.model,
      firmware,
      roomId: d.roomId,
    };
    if (ip) entry.ip = ip;
    devices.push(entry);
    if (d.credentials && !rng.chance(level.missingCredential)) {
      credentials.push({ deviceId: d.id, hostname: d.hostname, ...d.credentials });
    }
  }

  const server = draft.devices.find((d) => d.kind === "server");
  const fwDoc = devices.find((d) => d.kind === "firewall");
  const accessNotes: string[] = [];
  if (server) {
    accessNotes.push(
      fwDoc?.ip
        ? `Land on ${server.hostname} (${server.ip}) through Atrium RMM, then SSH to ${fwDoc.hostname} at ${fwDoc.ip}.`
        : `Land on ${server.hostname} (${server.ip}) through Atrium RMM.`,
    );
  }

  return {
    devices,
    credentials,
    vlans: structuredClone(draft.network.vlans),
    isp: { ...draft.network.isp },
    contacts: structuredClone(draft.client.contacts),
    floorPlan: rng.chance(0.15),
    accessNotes,
  };
}
