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

Phase 1 (vertical slice) is built: one managed client with a main office and a branch, four cases, one misroute and one duplicate. Phase 2 (access and people) is in progress: calls, remote hands, the ISP line, the credential ladder, ScreenLink, the VPN and the desk rules are in. The slice now has six cases (Tuesday 7 PM and Lights Out added). Tidy Desk is quick-play only, since it takes the whole site down. Plan and order: /mnt/project-files/msp-game-reviews/phase-2-proposal.md (project files, not the repo).

Phase 2 notes:

- Calls (data/rules/calls.yaml, src/engine/calls): call a docs contact or the user on a ticket. Answered only in hidden business hours, by availability. Patience sets how many asks a call takes. Asks: a test (sets the client OK on the spot, so no 2 hour Customer question wait), lights, power source, power-cycle, and fact questions. Low competence gives wrong answers and can cycle the wrong box in the same room.
- Cases add a `call` block: fact answers only docs contacts know, test answers for weekly problems, and remote hands fixes that show up once their fact has been heard.
- Power-cycle: dark for `rebootMinutes` after the ask, then boots from startup config, so unsaved changes are lost. Scheduled power cuts (effect `power-cut`, a list of weekdays and a window that may run past midnight) end when a fix sets `until`. Uptime comes from `bootTime()`. Gear dark from a cut or a power-cycle does not count as collateral.
- A client with contactPreference scheduled-only costs `callUnwanted` once per contact per day. The docs say so on the contacts list.
- Access token `hands` (a call) is always available when the client has contacts.
- Loops (effect `loop-cable`): a cable with both ends on one switch. While both ports are up, `netState` marks the switch as in a storm and everything on it is offline. A power-cycle does not help. The `unplug-loop` hands fix removes the cable.
- Rooms can place fixed gear (`gear` in data/rooms), like the clinic NVR.
- ISP calls: every docs site has an ISP support line in the phone dialog. It answers all hours after a hold (minutes from `isp.holdMinutes`), then wants the account number and PIN from the docs. Some docs have no PIN; a contact can read it off the bill (`isp-bill` ask, and low competence misreads a digit), and the player fixes the docs PIN by hand. Verified, the agent reports the line (outage, nothing answering behind the modem, or clean) and can reboot the modem. Access token `isp`.
- ISP outages (effect `isp-outage`, check `isp-up`): the site loses internet and tunnels while the firewall stays up. Ovik needs internet to report, so its collector reads offline. Overnight Update is the quick-play case for it.
- Credential ladder: a vault password can be wrong (`wrongCredential`). Half the time the docs history still has the good one; otherwise a coworker changed it on the device and never saved it (hidden `docs.unsaved`), and only they know it. They show up in the access log. Devices still on the factory login (`defaultPassword`, defaults in device templates and the vendor KB) have no vault entry. The client's main contact can read device passwords. Coworkers are in the phone dialog under "Your team" and pick up during MSP hours.
- Disabled MSP accounts: a client with `disablesMspAccounts` has the firewall admin account switched off. Login fails like a wrong password. The docs access notes say so, and only the main contact can turn it back on (`enable-account` ask).
- ScreenLink (src/ui/screenlink, actions `sl-new` and `sl-open`): make a join code, then call someone and use the `screenlink-join` ask. A contact joins from their desk PC (`personPc`), a ticket user from their own PC. Low competence mistypes the code. The shell needs no agent and no consent, and closes when they leave (patience sets how long). Access token `screen`; it also grants `rmm:<role>` and `ssh:<role>` from that PC.
- Shells (RMM or ScreenLink) can now fix two things by hand: `Set-DnsClientServerAddress -InterfaceAlias Ethernet -ResetServerAddresses` and `powercfg /change standby-timeout-ac 0`.
- VPN (data/rules/vpn.yaml, src/engine/vpn, src/ui/vpn): some managed clients give the MSP an SSL VPN account on the main office firewall (`device.vpn`, port in running `sslvpn`). Docs hold the profile and the vault entry `vpn-<site>`; a stale page can have the wrong port. Your laptop has one app per firewall brand; firmware lines need a minimum app version (`minVersion`, also in the Vendor KB), and Update costs `upgradeMinutes`. Sign-in is a code from the MSP authenticator (one game minute per code, the firewall also takes the one before) or a push to approve. Bad codes lock the account. Connected, the laptop terminal can ping and SSH to what the firewall reaches inside; those SSH sessions close when the VPN drops and follow the lockout rule. Access token `vpn`.
- Firewall clocks: `system ntp` in the Fortress dialect. With ntpsync off the clock drifts by `clockDrift` minutes (`clockOffset()`), shown in get system status and the SSL VPN log, and codes stop matching. Codes Rejected (quick play, needs a code-based VPN) is that fault; check `clock-synced`.
- Desk rules (`desk` in data/rules/tickets.yaml, `deskTimer` in game.ts): dispatch checks in on every open P1 each hour of MSP time and charges `p1CheckInMissed` when the tech wrote nothing that hour. Flag P1 goes to dispatch, which grants it only for cases marked `p1Worthy` (a stopped business; Tidy Desk starts at P2 for this). Only dispatch changes a P1. Check-ins count MSP minutes since the last tech entry and skip Awaiting Client and Scheduled. Escalate (with a note) before `escalateAfterMinutes` on the ticket gets a push back and `escalatedEarly`; after that the senior answers on the ticket with the case's root cause, once, for `seniorHelp`. A case ticket an hour in with no fix and no tech note, handoff or escalation charges `noCheckIn` once.
- Scenario "breakfix": a one-site client with `managed: false`. No RMM agents and no Ovik, so ScreenLink, calls and docs are the only ways in.
- The status bar picks what a new shift plants: a scenario, or one case on the one-site quick client. Saves keep the pick.

Phase 1 notes:

- Scenario "slice" (data/scenarios) plants Camera Day, Wrong Phonebook, Nobody Home and Branch Silence on one client. "quick" plants one random case on a one-site client.
- Docs are written from the network before the faults, then degraded by staleness. Devices a case is about are never dropped from docs.
- Closing rule: client tickets need attached output plus a client OK (Customer question with "ask to close"). Alert and tech tickets need output only. Closing anyway is allowed; it costs points, and an unfixed close reopens 90 minutes later.
- Response target: a ticket note, a handoff or a close is the first response. Until then the queue shows "Respond by". A close that reopens earns nothing for its resolution note.
- Lockout: a remote change that cuts your own SSH path drops the session, costs points, and a console rollback undoes it one business hour later.
- Collateral: a device that was up at shift start and is down now (not asleep, not added by a fault) blocks the client OK and costs points on close.
- Resolution notes all have the same six lines. Resolving a misroute or duplicate is allowed but costs points.
- Consent: opening a shell or running a script on a PC with a signed-in user, without asking first, costs points. Users answer only during the client's hidden business hours.
- Every action costs game minutes (data/rules/actions.yaml). Scoring values live in data/rules/handoffs.yaml.
- Camera Day needs a switch with its own CLI, so it only lands on Aurora CX switches. FortressSwitch is still read-only from the gate.
- Out of scope for now: console, truck rolls, editing in the device web GUI.
- Generator rerolls: a case that does not fit rerolls the client, fault placement rerolls up to 8 times, unsolvable docs reroll up to 8 times.
- Asset types (data/rules/assets.yaml) group gear in Hoodoo Docs, Ovik and Shinobi RMM, IT Glue and Hudu style. Passwords sit as child rows under their asset. Devices with a CLI dialect get a copy button for `ssh {user}@{ip}` built from the docs, so stale docs give a stale command. Wi-Fi networks are docs only for now (no AP config behind them); their passphrases are vault entries keyed `wifi-<site>-<n>`.
- Terminal pacing (src/ui/terminal/pace.ts) is UI only: ping replies 1s apart, Windows timeouts 4s each, Unix ping fail 5s, Ctrl+C or Esc skips. The engine still answers at once, so game time and tests do not change.
- Diagnostics (src/ui/diag.ts): errors, warnings, crashes and every action go to a log kept in localStorage. "Report bug" saves the player's note plus a snapshot (tab, ticket, terminal tail, last actions) in a separate list that is never trimmed by the rolling log. The Diagnostics button in the status bar copies or saves the report, which includes the seed and action log for a replay.
- Score: the SCORE button opens the ledger (every change with its reason, totals by ticket). Each change also pops a short toast. When the queue empties, the ledger opens as the shift summary.
- Fixing data: Docs device IP and firmware, site WAN IP, WAN block and WAN gateway, and Ovik IP and hostname are editable (pencil or double-click). A fix that lands on the truth pays `docFix` once per field; Ovik edits do not go in the docs history. "Add a device" under the asset list writes a new docs row; it pays `docAdd` only when a real undocumented device sits at that IP on that site.
- Close scoring: an outage already charged on an earlier close still rules out the clean bonus, and the no-proof penalty applies whenever the proof rule is not met, outage or not.
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
