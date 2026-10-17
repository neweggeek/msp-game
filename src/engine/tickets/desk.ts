import type { GameData } from "../data";
import type { CaseInstance, World } from "../model/types";
import { Rng } from "../rng/rng";
import { fill } from "../util/template";
import type { Ticket } from "./tickets";

export interface NoteOption {
  text: string;
  quality: "good" | "vague" | "jargon";
}

/** The main device a ticket is about, for "device name plus IP" notes. */
export function ticketDevice(world: World, t: Ticket): { hostname: string; ip: string } {
  const c = world.cases.find((x) => x.caseId === t.caseId);
  const dev = c ? world.devices.find((d) => d.id === c.bindings[c.primary]) : undefined;
  return { hostname: dev?.hostname ?? world.client.name, ip: dev?.ip ?? "no IP" };
}

/** Three ticket notes to pick from for a handoff. Order is fixed per ticket and handoff count. */
export function handoffNotes(
  data: GameData,
  world: World,
  t: Ticket,
  handoffId: string,
): NoteOption[] {
  const rules = data.handoffs;
  const dev = ticketDevice(world, t);
  const rng = new Rng(`${world.seed}:${t.id}:${handoffId}:${t.handoffs}`);
  const summary = rules.summaries[handoffId] ?? "update.";
  const good = fill(rules.notes.good, (k) =>
    k === "device" ? dev.hostname : k === "ip" ? dev.ip : k === "summary" ? summary : "",
  );
  return rng.shuffle<NoteOption>([
    { text: good.charAt(0).toUpperCase() + good.slice(1), quality: "good" },
    { text: rng.pick(rules.notes.vague), quality: "vague" },
    { text: rng.pick(rules.notes.jargon), quality: "jargon" },
  ]);
}

export const NOTE_PARTS = [
  "issue",
  "findings",
  "changes",
  "rootCause",
  "nextSteps",
  "status",
] as const;
export type NotePart = (typeof NOTE_PARTS)[number];

export interface ResolutionOption {
  lines: string[];
  parts: NotePart[];
  wrongCause: boolean;
}

/** Four resolution notes: one covers all six parts, the rest miss parts or blame the wrong thing. */
export function resolutionNotes(world: World, t: Ticket, c: CaseInstance): ResolutionOption[] {
  const n = c.note;
  const rng = new Rng(`${world.seed}:${t.id}:resolve`);
  return rng.shuffle<ResolutionOption>([
    {
      lines: [
        `Issue: ${n.issue}`,
        `Findings: ${n.findings}`,
        `Changes: ${n.changes}`,
        `Root cause: ${n.rootCause}`,
        `Next steps: ${n.nextSteps}`,
        "Status: Resolved.",
      ],
      parts: [...NOTE_PARTS],
      wrongCause: false,
    },
    {
      lines: [
        `Issue: ${n.issue}`,
        `Changes: ${n.wrongChange}`,
        `Root cause: ${n.wrongCause}`,
        "Status: Resolved.",
      ],
      parts: ["issue", "status"],
      wrongCause: true,
    },
    {
      lines: [`Issue: ${n.issue}`, `Findings: ${n.findings}`, "Status: Resolved."],
      parts: ["issue", "findings", "status"],
      wrongCause: false,
    },
    { lines: ["Fixed the issue. Closing."], parts: ["status"], wrongCause: false },
  ]);
}

/** What the closing rule still wants before this ticket can close cleanly. */
export function closeBlockers(t: Ticket): string[] {
  const out: string[] = [];
  if (!t.proofs.some((p) => p.kind === "output"))
    out.push("Attach proof: output of a passing test.");
  if (t.origin === "client" && !t.clientConfirmed)
    out.push("Ask the client if it is good to close (Customer question).");
  return out;
}
