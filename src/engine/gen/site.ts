import type { GameData } from "../data";
import type { ClientProfile, Room, Site } from "../model/types";
import type { Rng } from "../rng/rng";

export interface RoomPlan {
  roomId: string;
  pcs: number;
  phones: number;
  ap: boolean;
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/** Rooms for one site. A branch is a small cut of the same room set. */
export function genSite(
  rng: Rng,
  data: GameData,
  profile: ClientProfile,
  role: "hq" | "branch",
): { site: Omit<Site, "vlans" | "isp" | "octet">; plan: RoomPlan[] } {
  const industry = data.clients.industries.find((i) => i.id === profile.industry);
  const template = industry ? data.rooms.get(industry.rooms) : undefined;
  if (!template) throw new Error(`no room template for ${profile.industry}`);

  const rooms: Room[] = [];
  const plan: RoomPlan[] = [];
  let workRooms = 0;
  for (const spec of template.rooms) {
    let count = rng.range(spec.count);
    if (role === "branch") {
      const isWork = spec.pcs[1] > 0 && spec.type !== "reception";
      if (spec.type === "bathroom" || spec.type === "conference") count = 0;
      else if (isWork) count = workRooms++ === 0 ? rng.int(1, 2) : 0;
      else count = Math.min(count, 1);
    }
    for (let n = 1; n <= count; n++) {
      const name = spec.name.replace("{n}", String(n));
      const id = `${role}-room-${slug(name)}`;
      rooms.push({
        id,
        name,
        type: spec.type,
        building: `${role}-bldg-1`,
        floor: 1,
        locked: spec.networkCloset ? true : rng.chance(0.1),
        networkCloset: spec.networkCloset === true,
      });
      plan.push({
        roomId: id,
        pcs: rng.range(spec.pcs),
        phones: rng.range(spec.phones),
        ap: rng.chance(spec.ap),
      });
    }
  }
  if (!plan.some((p) => p.ap)) {
    const first = plan.find((p) => !rooms.find((r) => r.id === p.roomId)?.networkCloset);
    if (first) first.ap = true;
  }

  const place = rng.pick(data.clients.places);
  return {
    site: {
      id: role,
      name: role === "hq" ? `${profile.name} Main Office` : `${profile.name} ${place} Branch`,
      address: `${rng.int(100, 9899)} ${place} Road`,
      buildings: [{ id: `${role}-bldg-1`, name: "Main Building", floors: 1 }],
      rooms,
    },
    plan,
  };
}
