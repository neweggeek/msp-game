# MSP Network Admin Game

A single-player, web-based detective game. The player is an MSP engineer recently promoted to network admin, working escalated network tickets across procedurally generated client networks built from parody vendors.

## Spec

The full spec lives in `spec/`, one Markdown file per tab of the design doc:

| File | What it holds |
| --- | --- |
| `spec/00-main.md` | Concept, decisions, mechanics, playbooks, rules, industry practices, CLI dialect system |
| `spec/01-feature-inventory.md` | 91 features with IDs, dependencies and the 8 build phases |
| `spec/02-device-faults.md` | 217 faults by device type, firewall split by subsystem |
| `spec/03-case-files.md` | 35 chained detective cases with first-slice picks |
| `spec/04-workflow-interview.md` | 50 answers from a working MSP network admin; ground truth for how the job works |

UI mockups for reference are in `mockups/` (layout and look only; they were built for a design canvas runtime and will not render standalone).

When the spec and the interview disagree, the interview wins. When a feature ID is mentioned (for example `DESK-08`), look it up in `spec/01-feature-inventory.md`.

## How we build

- Build phase by phase, in the order in `spec/01-feature-inventory.md`. Each phase ends playable before the next one starts.
- Everything is data-driven: device templates, room templates, faults, cases and CLI dialects are data files, not code branches. Adding a brand, room type or case should mean adding data.
- Clients are generated from a seed. The same seed must rebuild the same client; saves store the seed plus changes.
- One base CLI parser for every device. Brands differ only through dialect files (keywords, mode entry, interface names, save or commit behavior, error style).
- Every generated case must pass a solvability check: at least one access path reaches every clue.
- Use parody brand names only (FortressGate, Aurora, Cypress, Meridian, OmniWave and the rest of the roster in the spec). Never show real vendor names or logos in the game UI.

## Writing style for any player-facing text and docs

- Plain language, short sentences.
- Never use em dashes.
- Ticket notes and examples include concrete identifiers: device name plus IP.

## Current phase

Phase 1 (vertical slice) is built: one managed client with a main office and a branch, four cases, one misroute and one duplicate. Next is Phase 2, after review.

Phase 1 notes:

- Scenario "slice" (data/scenarios) plants Camera Day, Wrong Phonebook, Nobody Home and Branch Silence on one client. "quick" plants one random case on a one-site client.
- Docs are written from the network before the faults, then degraded by staleness. Devices a case is about are never dropped from docs.
- Closing rule: client tickets need attached output plus a client OK (Customer question with "ask to close"). Alert and tech tickets need output only. Closing anyway is allowed; it costs points, and an unfixed close reopens 90 minutes later.
- Consent: opening a shell or running a script on a PC with a signed-in user, without asking first, costs points. Users answer only during the client's hidden business hours.
- Every action costs game minutes (data/rules/actions.yaml). Scoring values live in data/rules/handoffs.yaml.
- Camera Day needs a switch with its own CLI, so it only lands on Aurora CX switches. FortressSwitch is still read-only from the gate.
- Out of scope for now: ScreenLink sessions, VPN clients, console, truck rolls, editing in the device web GUI.
- Generator rerolls: a case that does not fit rerolls the client, fault placement rerolls up to 8 times, unsolvable docs reroll up to 8 times.
- Terminal pacing (src/ui/terminal/pace.ts) is UI only: ping replies 1s apart, Windows timeouts 4s each, Unix ping fail 5s, Ctrl+C or Esc skips. The engine still answers at once, so game time and tests do not change.
- Diagnostics (src/ui/diag.ts): errors, warnings, crashes and every action go to a log kept in localStorage. The Diagnostics button in the status bar copies or saves the report, which includes the seed and action log for a replay.
- If a change alters what an old seed builds, the golden-seed test fails. Bump `GENERATOR_VERSION` in `src/engine/gen/index.ts` on purpose, then run `UPDATE_GOLDEN=1 npm test`.

## Commands

```
npm install
npm run dev          # game at http://localhost:5173
npm test             # all tests, including the 300-seed solvability sweep and every case played end to end
npm run typecheck
npm run lint
npm run build        # static site in dist/
UPDATE_TRANSCRIPTS=1 npx vitest run tests/transcripts.test.ts   # refill CLI transcripts, then review the diff
```

## Code layout

- `data/` holds content: brands, device templates, room sets, faults, cases, dialects, rules. New content goes here.
- `src/engine/` holds rules and never imports React. `src/engine/index.ts` is the only API the UI calls.
- `src/ui/` draws what the engine says: the Atrium desk (queue, ticket, terminal), Shinobi RMM, Ovik, Hoodoo Docs, Vendor KB, and a Debug tab that shows the truth.
- `tests/transcripts/<dialect>/*.txt` are CLI transcripts: `> ` lines are input, the rest is expected output.
