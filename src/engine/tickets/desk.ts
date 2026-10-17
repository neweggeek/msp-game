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

/**
 * Four resolution notes with the same six lines, so length gives nothing away. One is right on
 * every line; the others blame the wrong thing, name a change that did not fix it, or say nothing.
 */
export function resolutionNotes(world: World, t: Ticket, c: CaseInstance): ResolutionOption[] {
  const n = c.note;
  const rng = new Rng(`${world.seed}:${t.id}:resolve`);
  const note = (
    findings: string,
    changes: string,
    rootCause: string,
    nextSteps: string,
  ): string[] => [
    `Issue: ${n.issue}`,
    `Findings: ${findings}`,
    `Changes: ${changes}`,
    `Root cause: ${rootCause}`,
    `Next steps: ${nextSteps}`,
    "Status: Resolved.",
  ];
  return rng.shuffle<ResolutionOption>([
    {
      lines: note(n.findings, n.changes, n.rootCause, n.nextSteps),
      parts: [...NOTE_PARTS],
      wrongCause: false,
    },
    {
      lines: note(n.findings, n.wrongChange, n.wrongCause, "Watch it for a day."),
      parts: ["issue", "findings", "status"],
      wrongCause: true,
    },
    {
      lines: note(n.findings, n.wrongChange, n.rootCause, "None."),
      parts: ["issue", "findings", "rootCause", "status"],
      wrongCause: false,
    },
    {
      lines: note(
        "Checked the devices involved. See ticket.",
        "Made the needed changes.",
        "Config issue.",
        "None.",
      ),
      parts: ["issue", "status"],
      wrongCause: false,
    },
  ]);
}

/** Notes for a ticket with nothing to fix. Every one closes it; none of them is right. */
export function plainResolutionNotes(t: Ticket): string[][] {
  return [
    [`Issue: ${t.title}`, "Findings: Checked it over, nothing wrong found.", "Status: Resolved."],
    [`Issue: ${t.title}`, "Changes: Fixed it.", "Status: Resolved."],
  ];
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
