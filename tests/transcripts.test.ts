import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { gameData } from "../src/engine/data";
import { applyAction, newGame } from "../src/engine/save/game";

/**
 * Transcript files: "# seed: x" and "# device: kind" headers, "> line" for input,
 * everything else is the expected output of the input above it.
 * Write a new file with only "> " lines and run with UPDATE_TRANSCRIPTS=1 to fill it, then review it by hand.
 */
const data = gameData();
const root = new URL("./transcripts/", import.meta.url).pathname;

interface Step {
  input: string;
  expected: string[];
}

function parse(text: string): { headers: Record<string, string>; steps: Step[] } {
  const headers: Record<string, string> = {};
  const steps: Step[] = [];
  for (const line of text.replace(/\n$/, "").split("\n")) {
    const h = line.match(/^# (\w+): (.*)$/);
    if (h && steps.length === 0) headers[h[1] as string] = h[2] as string;
    else if (line.startsWith("> ")) steps.push({ input: line.slice(2), expected: [] });
    else steps[steps.length - 1]?.expected.push(line);
  }
  return { headers, steps };
}

function runFile(path: string): {
  steps: Step[];
  actual: string[][];
  headers: Record<string, string>;
} {
  const { headers, steps } = parse(readFileSync(path, "utf8"));
  const g = newGame(headers.seed ?? "transcript", data, headers.case);
  const dev = g.world.devices.find((d) => d.kind === (headers.device ?? "firewall"));
  const open = applyAction(g, data, { t: "cli-open", device: dev?.id as string });
  const actual = steps.map(
    (s) =>
      applyAction(g, data, { t: "cli", session: open.session as string, line: s.input }).output ??
      [],
  );
  return { steps, actual, headers };
}

for (const dialect of readdirSync(root)) {
  describe(`${dialect} transcripts`, () => {
    for (const file of readdirSync(join(root, dialect)).filter((f) => f.endsWith(".txt"))) {
      it(file, () => {
        const path = join(root, dialect, file);
        const { steps, actual, headers } = runFile(path);
        if (process.env.UPDATE_TRANSCRIPTS && existsSync(path)) {
          const head = Object.entries(headers).map(([k, v]) => `# ${k}: ${v}`);
          const body = steps.flatMap((s, i) => [`> ${s.input}`, ...(actual[i] ?? [])]);
          writeFileSync(path, `${[...head, ...body].join("\n")}\n`);
          return;
        }
        steps.forEach((s, i) => expect(actual[i], `> ${s.input}`).toEqual(s.expected));
      });
    }
  });
}
