import type { AccessToken, CaseInstance, Docs, SolvabilityReport, World } from "../model/types";
import { canManage, canReach } from "../net/reach";
import { netState } from "../net/state";

type Checkable = Omit<World, "solvability">;

/**
 * Access the player starts with for one case, given the truth and the docs.
 * Role tokens: "rmm:<role>" the agent answers, "ssh:<role>" docs creds work and
 * some RMM host can reach it at the docs IP or its own gateway.
 */
export function accessPaths(
  world: Checkable,
  c: CaseInstance | null,
  now: number,
  docs: Docs = world.docs,
): AccessToken[] {
  const w = world as World;
  const ns = netState(w, now);
  const access: AccessToken[] = ["docs"];
  const rmmHosts = w.devices.filter(
    (d) => d.rmmAgent && ns.online.get(d.id) && canReach(w, d.id, "1.1.1.1", ns),
  );
  if (rmmHosts.length > 0) access.push("rmm");
  const collector = w.devices.find((d) => d.id === w.monitoring?.collectorId);
  if (collector && ns.online.get(collector.id) && canReach(w, collector.id, "1.1.1.1", ns))
    access.push("monitoring");
  // Someone at the client can always be called and act as remote hands.
  if (w.client.contacts.length > 0) access.push("hands");
  // The ISP talks once you have the PIN: from the docs, or read off the bill by a contact.
  const pinKnown = docs.sites.every((s) => {
    const real = w.sites.find((x) => x.id === s.siteId)?.isp;
    return s.isp.pin === real?.pin && s.isp.account === real.account;
  });
  if (pinKnown || w.client.contacts.length > 0) access.push("isp");
  if (!c) return access;

  for (const [role, id] of Object.entries(c.bindings)) {
    const dev = w.devices.find((d) => d.id === id);
    if (!dev) continue;
    if (rmmHosts.some((h) => h.id === id)) access.push(`rmm:${role}`);
    if (!dev.credentials) continue;
    const cred = docs.credentials.find((x) => x.deviceId === id);
    const docsWork =
      cred?.username === dev.credentials.username &&
      cred.password === dev.credentials.password &&
      !dev.credentials.disabled;
    // Otherwise the credential ladder: docs history, factory login, a coworker, or the client.
    if (!docsWork && w.client.contacts.length === 0) continue;
    const docIp = docs.devices.find((x) => x.deviceId === id)?.ip;
    const via = rmmHosts.some((h) =>
      [docIp, h.gateway].some(
        (ip) => ip !== undefined && canManage(w, h.id, ip, "ssh", ns) && ownedBy(w, ip, id),
      ),
    );
    if (via) access.push(`ssh:${role}`);
  }
  return access;
}

/** Is this IP one of the device's own addresses? */
function ownedBy(world: World, ip: string, id: string): boolean {
  const dev = world.devices.find((d) => d.id === id);
  if (!dev) return false;
  if (dev.ip === ip) return true;
  const ifaces = (dev.running?.interfaces ?? {}) as Record<string, Record<string, unknown>>;
  return Object.values(ifaces).some((f) => typeof f.ip === "string" && f.ip.split("/")[0] === ip);
}

export function checkSolvable(
  world: Checkable,
  now: number,
  attempts: SolvabilityReport["attempts"],
): SolvabilityReport {
  const access = new Set(accessPaths(world, null, now));
  const clues: SolvabilityReport["clues"] = [];
  for (const c of world.cases) {
    const caseAccess = accessPaths(world, c, now);
    for (const a of caseAccess) access.add(a.includes(":") ? `${a}@${c.caseId}` : a);
    for (const f of c.faults) {
      for (const cl of f.clues)
        clues.push({
          caseId: c.caseId,
          id: cl.id,
          requires: cl.requires,
          reachable: caseAccess.includes(cl.requires),
        });
    }
  }
  // Every case needs at least one clue, and every clue a way in.
  return { solvable: clues.every((x) => x.reachable), access: [...access], clues, attempts };
}
