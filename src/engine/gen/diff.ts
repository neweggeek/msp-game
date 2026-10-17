import type { World } from "../model/types";

export interface DocDiff {
  deviceId: string;
  hostname: string;
  field: "missing" | "ip" | "firmware" | "credential" | "wan";
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
        truth: d.addedBy ? "added by fault" : "exists",
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
    const cred = world.docs.credentials.find((c) => c.deviceId === d.id);
    if (d.credentials && (!cred || cred.password !== d.credentials.password)) {
      out.push({
        deviceId: d.id,
        hostname: d.hostname,
        field: "credential",
        truth: "set",
        docs: cred ? "wrong" : "missing",
      });
    }
  }
  for (const s of world.sites) {
    const doc = world.docs.sites.find((x) => x.siteId === s.id);
    if (doc && doc.isp.wanIp !== s.isp.wanIp)
      out.push({
        deviceId: `site:${s.id}`,
        hostname: s.name,
        field: "wan",
        truth: s.isp.wanIp,
        docs: doc.isp.wanIp,
      });
  }
  return out;
}
