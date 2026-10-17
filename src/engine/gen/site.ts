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

export function genSite(
  rng: Rng,
  data: GameData,
  profile: ClientProfile,
): { site: Site; plan: RoomPlan[] } {
  const industry = data.clients.industries.find((i) => i.id === profile.industry);
  const template = industry ? data.rooms.get(industry.rooms) : undefined;
  if (!template) throw new Error(`no room template for ${profile.industry}`);

  const rooms: Room[] = [];
  const plan: RoomPlan[] = [];
  for (const spec of template.rooms) {
    const count = rng.range(spec.count);
    for (let n = 1; n <= count; n++) {
      const name = spec.name.replace("{n}", String(n));
      const id = `room-${slug(name)}`;
      rooms.push({
        id,
        name,
        type: spec.type,
        building: "bldg-1",
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
  // Every site gets at least one AP.
  if (!plan.some((p) => p.ap)) {
    const first = plan.find((p) => !rooms.find((r) => r.id === p.roomId)?.networkCloset);
    if (first) first.ap = true;
  }

  return {
    site: {
      id: "site-1",
      name: `${profile.name} Main Office`,
      address: `${rng.int(100, 9899)} ${rng.pick(data.clients.places)} Road`,
      buildings: [{ id: "bldg-1", name: "Main Building", floors: 1 }],
      rooms,
    },
    plan,
  };
}
