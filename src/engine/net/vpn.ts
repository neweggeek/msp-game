import type { Device, Fields, World } from "../model/types";
import { type NetState, firewallInterfaces } from "./state";

export interface TunnelState {
  firewallId: string;
  name: string;
  remoteGw: string;
  peerId?: string;
  phase1Up: boolean;
  phase2Up: boolean;
  error: "no-response" | "psk-mismatch" | "selector-mismatch" | null;
  src?: string;
  dst?: string;
}

export function wanIp(fw: Device): string | undefined {
  const wan = firewallInterfaces(fw).find(
    ([n, f]) => n === "wan1" && f.status === "up" && typeof f.ip === "string",
  );
  return wan ? String(wan[1].ip).split("/")[0] : undefined;
}

const table = (fw: Device, key: string) => (fw.running?.[key] ?? {}) as Record<string, Fields>;

/** IPsec state for every tunnel on every firewall. Up only when both ends agree. */
export function tunnelStates(world: World, ns: NetState): TunnelState[] {
  const fws = world.devices.filter((d) => d.kind === "firewall");
  const out: TunnelState[] = [];
  for (const fw of fws) {
    for (const [name, p1] of Object.entries(table(fw, "phase1"))) {
      const remoteGw = String(p1.remoteGw ?? "");
      const p2 = Object.values(table(fw, "phase2")).find((x) => x.phase1 === name);
      const st: TunnelState = {
        firewallId: fw.id,
        name,
        remoteGw,
        phase1Up: false,
        phase2Up: false,
        error: "no-response",
      };
      if (p2) {
        st.src = String(p2.src ?? "");
        st.dst = String(p2.dst ?? "");
      }
      const myWan = wanIp(fw);
      const peer = fws.find((x) => x.id !== fw.id && wanIp(x) === remoteGw);
      if (peer && myWan && ns.online.get(fw.id) && ns.online.get(peer.id)) {
        st.peerId = peer.id;
        const back = Object.entries(table(peer, "phase1")).find(([, x]) => x.remoteGw === myWan);
        if (back) {
          if (back[1].psk !== p1.psk) st.error = "psk-mismatch";
          else {
            st.phase1Up = true;
            const peerP2 = Object.values(table(peer, "phase2")).find((x) => x.phase1 === back[0]);
            const mirror = p2 && peerP2 && p2.src === peerP2.dst && p2.dst === peerP2.src;
            st.phase2Up = !!mirror;
            st.error = mirror ? null : "selector-mismatch";
          }
        }
      }
      out.push(st);
    }
  }
  return out;
}

/** Is there a working tunnel between two sites' firewalls? */
export function sitesLinked(world: World, ns: NetState, aFw: Device, bFw: Device): boolean {
  return tunnelStates(world, ns).some(
    (t) => t.firewallId === aFw.id && t.peerId === bFw.id && t.phase2Up,
  );
}
