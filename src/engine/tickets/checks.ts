import type { CaseInstance, World } from "../model/types";
import { resolveName } from "../net/reach";
import { loopLinks, netState } from "../net/state";
import { tunnelStates } from "../net/vpn";

/** Is the real problem gone? Every "fixed" check of the case must pass. */
export function caseFixed(world: World, c: CaseInstance, now: number): boolean {
  const ns = netState(world, now);
  return c.fixed.every((chk) => {
    const dev = world.devices.find((d) => d.id === c.bindings[chk.role]);
    if (!dev) return false;
    switch (chk.type) {
      case "device-online":
        return ns.online.get(dev.id) === true;
      case "tunnel-up":
        return tunnelStates(world, ns).some((t) => t.firewallId === dev.id && t.phase2Up);
      case "dns-internal": {
        const server = world.devices.find((d) => d.kind === "server");
        return !!server && resolveName(world, dev, server.hostname, ns).ok;
      }
      case "no-sleep":
        return dev.sleep === undefined;
      case "no-power-cut":
        return !dev.powerCut || (dev.powerCut.until !== undefined && dev.powerCut.until <= now);
      case "no-loop":
        return !loopLinks(world, dev.id).length;
      default:
        return false;
    }
  });
}
