import type { World } from "../model/types";

export interface DocDiff {
  deviceId: string;
  hostname: string;
  field: "missing" | "ip" | "firmware" | "credential";
  truth: string;
  docs: string;
}

/** Where the docs disagree with the truth. Debug only; the player never sees this. */
export function docsDiff(world: World): DocDiff[] {
  const out: DocDiff[] = [];
  for (const d of world.devices) {
    const doc = world.docs.devices.find((x) => x.deviceId === d.id);
    if (!doc) {
      out.push({
        deviceId: d.id,
        hostname: d.hostname,
        field: "missing",
        truth: d.undocumented ? "added by fault" : "exists",
        docs: "not in docs",
      });
      continue;
    }
    if (doc.ip !== d.ip)
      out.push({
        deviceId: d.id,
        hostname: d.hostname,
        field: "ip",
        truth: d.ip ?? "",
        docs: doc.ip ?? "",
      });
    if (doc.firmware !== d.firmware)
      out.push({
        deviceId: d.id,
        hostname: d.hostname,
        field: "firmware",
        truth: d.firmware,
        docs: doc.firmware,
      });
    if (d.credentials && !world.docs.credentials.some((c) => c.deviceId === d.id)) {
      out.push({
        deviceId: d.id,
        hostname: d.hostname,
        field: "credential",
        truth: "set",
        docs: "missing",
      });
    }
  }
  return out;
}
