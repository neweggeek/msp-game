import type { AccessToken, Docs, SolvabilityReport, World } from "../model/types";
import { canManage, canReach } from "../net/reach";
import { netState } from "../net/state";

/** Access the player starts with, given the truth and what the docs say. */
export function accessPaths(
  world: Omit<World, "solvability">,
  docs: Docs = world.docs,
): AccessToken[] {
  const w = world as World;
  const ns = netState(w);
  const access: AccessToken[] = ["docs"];
  const isp = w.network.isp.gateway;
  const rmmHosts = w.devices.filter(
    (d) => d.rmmAgent && ns.online.get(d.id) && canReach(w, d.id, isp, ns),
  );
  if (rmmHosts.length > 0) access.push("rmm");
  if (rmmHosts.some((d) => d.kind === "server")) access.push("monitoring");

  const fw = w.devices.find((d) => d.kind === "firewall");
  if (fw?.credentials) {
    const cred = docs.credentials.find((c) => c.deviceId === fw.id);
    const credOk =
      cred?.username === fw.credentials.username && cred.password === fw.credentials.password;
    const docIp = docs.devices.find((d) => d.deviceId === fw.id)?.ip;
    const viaHost = rmmHosts.some((h) =>
      [docIp, h.gateway].some((ip) => ip !== undefined && canManage(w, h.id, ip, "ssh", ns)),
    );
    if (credOk && viaHost) access.push("ssh:firewall");
  }
  return access;
}

export function checkSolvable(
  world: Omit<World, "solvability">,
  attempts: SolvabilityReport["attempts"],
): SolvabilityReport {
  const access = accessPaths(world);
  const clues = world.case.faults.flatMap((f) =>
    f.clues.map((c) => ({
      id: c.id,
      requires: c.requires,
      reachable: access.includes(c.requires),
    })),
  );
  return { solvable: clues.every((c) => c.reachable), access, clues, attempts };
}
