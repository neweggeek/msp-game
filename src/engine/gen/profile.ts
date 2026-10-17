import type { GameData } from "../data";
import type { ClientProfile, Contact, Staleness, Tier } from "../model/types";
import type { Rng } from "../rng/rng";

export function genProfile(rng: Rng, data: GameData): ClientProfile {
  const rules = data.clients;
  const tierWeights = Object.fromEntries(
    Object.entries(rules.tiers).map(([k, v]) => [k, v.weight]),
  ) as Record<Tier, number>;
  const tier = rng.weighted(tierWeights);
  const industry = rng.pick(rules.industries);
  const place = rng.pick(rules.places);
  const name = rng.pick(industry.names).replace("{place}", place);
  const code = name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 4);
  const staleness = rng.weighted(data.staleness.byTier[tier] as Record<Staleness, number>);
  const hours = rng.pickWeighted(rules.businessHours);
  const window = rng.pickWeighted(rules.afterHoursWindows);

  const contacts: Contact[] = [];
  const count = rng.int(2, 3);
  for (let i = 0; i < count; i++) {
    contacts.push({
      id: `contact-${i + 1}`,
      name: `${rng.pick(rules.firstNames)} ${rng.pick(rules.lastNames)}`,
      role: i === 0 ? rng.pick(rules.contactRoles) : "Staff",
      phone: `555-01${rng.digits(2)}`,
      competence: Math.round(rng.next() * 100) / 100,
      patience: Math.round(rng.next() * 100) / 100,
      availability: rng.pick(["usually", "sometimes", "rarely"] as const),
    });
  }

  return {
    id: `client-${code.toLowerCase()}`,
    name,
    code,
    industry: industry.id,
    tier,
    headcount: rng.range(rules.tiers[tier]?.headcount ?? [5, 10]),
    managed: true,
    businessHours: { start: hours.start, end: hours.end },
    afterHoursWindow: { label: window.label, start: window.start, end: window.end },
    contactPreference: rng.weighted(
      rules.contactPreference as Record<ClientProfile["contactPreference"], number>,
    ),
    staleness,
    contacts,
  };
}
