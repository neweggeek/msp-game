# Feature inventory

Every feature in the spec, in one list, with a proposed build phase. Phases are a draft to argue with; each one ends in something playable.

## Proposed build phases

| Phase | Goal | Playable at the end |
| --- | --- | --- |
| 0. Foundation | Data model, seeded generator core, save system, base CLI parser with one dialect, ticket and clock engines | A generated client you can inspect in a debug view |
| 1. Vertical slice | Remote desk: ticketing, docs, RMM access, terminal, handoffs, resolution notes, 4 cases on one managed client | Work a full ticket from queue to close |
| 2. Access and people | VPN clients and authenticator, one-time sessions, remote hands, credential ladder, direct calls, dispatch statuses, P1 check-ins | Tickets that hinge on getting in and talking to people |
| 3. Onsite | Fog-of-war buildings, search, rack view, field kit, cable tools, mapping into docs | Drive out, find the closet, fix it physically |
| 4. Shift and progression | Calendar-first shift, multiple clients, ratings, CrewHoo points, churn, contract types, budget tiers, quick play | A full day, and a reason to come back tomorrow |
| 5. Jobs | After-hours windows, firmware upgrades, replacements, switch rebuild, RMA, sales, hardening, projects, CVE sweeps, unmanaged gear | Planned work, not just break-fix |
| 6. Breadth | All dialect families, full parody roster, full fault catalog and case files, multi-building generation | Variety for long play |
| 7. Practice systems | Problem tickets, lifecycle tracker, quarterly review, offboarding, expiry calendar, seasonal freezes, post-incident summaries | The MSP feels like a real business |

## Feature list

91 features. Every item marked proposed in the spec was reviewed on Oct 17, 2026 and kept. "Spec section" names where the detail lives in the main spec (00-main.md) or another spec file.

| ID | Feature | Spec section | Depends on | Phase |
| --- | --- | --- | --- | --- |
| CORE-01 | Seeded generator: client, site, network, faults, docs, validate | Procedural generation | | 0 |
| CORE-02 | Data-driven templates: devices, rooms, faults, cases, dialects | Procedural generation | | 0 |
| CORE-03 | Save system: seed plus changes | Procedural generation | CORE-01 | 0 |
| CORE-04 | Game clock and calendar time | Day structure | | 0 |
| CORE-05 | Ticket engine: create, status, priority, aging | Ticket statuses | CORE-04 | 0 |
| CORE-06 | Base CLI parser with dialect layer | CLI dialect system | CORE-02 | 0 |
| CORE-07 | Network simulation: devices, ports, VLANs, PoE budget, links, counters | Fault catalog | CORE-01 | 0 |
| CORE-08 | Fault injection and solvability check | Procedural generation | CORE-07 | 0 |
| DESK-01 | Atrium all-in-one platform shell: queue, calendar, ticket detail, notes | Core interaction surfaces | CORE-05 | 1 |
| DESK-02 | Docs tool: client records, devices, IP plan, VLANs, vault, history tab, access log | Core interaction surfaces; Credential recovery | CORE-01 | 1 |
| DESK-03 | Atrium RMM module: agents, background shell, scripts, remote sessions, filter by public IP, find user's machine | Playbook: site down | CORE-07 | 1 |
| DESK-04 | Terminal: SSH to devices, Fortress and Aurora CX dialects first | CLI dialect system | CORE-06 | 1 |
| DESK-05 | Device web GUI pages, basic | Core interaction surfaces | CORE-07 | 1 |
| DESK-06 | Atrium monitoring module: alerts, inventory, history, planted bad data | Evidence reliability | CORE-07 | 1 |
| DESK-07 | Vendor KB: CLI reference, release notes, compatibility tables | Documentation lookup mechanic | CORE-02 | 1 |
| DESK-08 | Handoff picker, 7 types, with dispatch NPC | Status update dialogue | DESK-01 | 1 |
| DESK-09 | Resolution note pick, scored on 6 parts | Resolution note | DESK-01 | 1 |
| DESK-10 | Closing rule with proof items | Closing rule | DESK-01 | 1 |
| DESK-11 | Workstation consent rule | Ways onto a firewall | DESK-03 | 1 |
| DESK-12 | First cases from playbooks: site down, one user, Wi-Fi, tunnel | Playbooks | CORE-08 | 1 |
| DESK-13 | Misrouted and duplicate tickets | Sending a ticket back | DESK-08 | 1 |
| ACC-01 | VPN client per brand, version compatibility | Core interaction surfaces | DESK-02 | 2 |
| ACC-02 | Authenticator phone: codes, push, lockout, clock drift | Core interaction surfaces | ACC-01 | 2 |
| ACC-03 | One-time session dialogue | Core interaction surfaces | | 2 |
| ACC-04 | Remote hands dialogue with competence trait | Onsite exploration | | 2 |
| ACC-05 | Credential recovery ladder, disabled MSP accounts | Credential recovery | DESK-02 | 2 |
| ACC-06 | Direct calls and contact-preference trait | Status update dialogue | ACC-04 | 2 |
| ACC-07 | Client dialogue traps | Client dialogue traps | ACC-06 | 2 |
| ACC-08 | ISP call dialogue: account and PIN gate, hold, power cycle | Playbook: site down | ACC-04 | 2 |
| ACC-09 | Real ticket statuses, Follow-up Needed aging | Ticket statuses | CORE-05 | 2 |
| ACC-10 | Priority rules, P1 hourly check-ins | Priority and SLA | ACC-09 | 2 |
| ACC-11 | Senior tech escalation, timing rule | Escalation | DESK-08 | 2 |
| ACC-12 | Cloud dashboards for cloud-managed brands | Vendor landscape | CORE-07 | 2 |
| ONS-01 | Building generation: buildings, floors, rooms, locks, stairwells | Procedural generation | CORE-01 | 3 |
| ONS-02 | Arrival, check-in, escort | Onsite exploration | ONS-01 | 3 |
| ONS-03 | Fog of war and timed search | Onsite exploration | ONS-01 | 3 |
| ONS-04 | 2D rack view: ports, LEDs, cables | Decisions | CORE-07 | 3 |
| ONS-05 | Field kit inventory, limited bag space and restocking | Field kit | | 3 |
| ONS-06 | Cable tester, toner, PoE tester, console cable per brand | Field kit | ONS-05 | 3 |
| ONS-07 | Onsite actions: re-terminate, re-patch, label, photo | Onsite exploration; Close-out | ONS-04 | 3 |
| ONS-08 | Mapping discoveries into docs and asset inventory | Onsite exploration | DESK-02 | 3 |
| ONS-09 | Travel time logged against the ticket | Wrap-up and time entry | CORE-04 | 3 |
| ONS-10 | Power and building faults: GFCI, light-switch outlets, UPS | Device faults (02-device-faults.md) | ONS-04 | 3 |
| SHF-01 | Calendar-first shift view, about 6 blocks | Day structure | CORE-04 | 4 |
| SHF-02 | Start-of-shift review: travel padding, time budgets | Start of shift | SHF-01 | 4 |
| SHF-03 | P1 interrupts and calendar reshuffles | Day structure | ACC-10 | 4 |
| SHF-04 | Multiple clients and switching between them | Concept | CORE-01 | 4 |
| SHF-05 | Client traits: budget, change control, contact preference, competence, after-hours window | Several | CORE-01 | 4 |
| SHF-06 | Managed vs break-fix contracts, conversion | Contract types | SHF-05 | 4 |
| SHF-07 | Review ratings and MSP reputation | Progression | DESK-09 | 4 |
| SHF-08 | Network health per client | Progression | CORE-07 | 4 |
| SHF-09 | Client churn and new sign-ups | Progression | SHF-07 | 4 |
| SHF-10 | CrewHoo points and store | Progression | SHF-07 | 4 |
| SHF-11 | Consequences for unapproved actions | Consequences | SHF-05 | 4 |
| SHF-12 | Quick play mode | Decisions | DESK-01 | 4 |
| SHF-13 | Time entry in blocks, wrap-up review | Wrap-up and time entry | DESK-01 | 4 |
| JOB-01 | After-hours window booking, change approval rule | Change approval rule | SHF-01 | 5 |
| JOB-02 | Maintenance window multiple-choice steps | Unmanaged and unreachable equipment | JOB-01 | 5 |
| JOB-03 | Keeping a foothold: leave PCs on, power settings script | Keeping a foothold | DESK-03 | 5 |
| JOB-04 | Firmware upgrade: prep, upgrade path, the wait, fallout | Firmware upgrade job | DESK-07 | 5 |
| JOB-05 | Unmanaged and unreachable gear identification | Unmanaged and unreachable equipment | JOB-02 | 5 |
| JOB-06 | Supported vs unsupported, sales note picks, client pushback | Supported vs unsupported equipment | DESK-08 | 5 |
| JOB-07 | Quote acceptance by budget tier | Client budgets | JOB-06 | 5 |
| JOB-08 | Replacement job: same-brand restore, cross-brand translation | Replacement job | CORE-06 | 5 |
| JOB-09 | Cutover-night gotchas | Cutover-night gotchas | JOB-08 | 5 |
| JOB-10 | Switch swap port-map rebuild, Amnesia Switch case | Switch swap | JOB-08 | 5 |
| JOB-11 | RMA flow with shipping and expenses | Dead hardware: RMA flow | ACC-11 | 5 |
| JOB-12 | Firewall hardening, website-blocked tickets | Client budgets and security posture | DESK-04 | 5 |
| JOB-13 | Project tasks with spec check, KB articles | Project tasks | DESK-04 | 5 |
| JOB-14 | CVE advisory sweep across clients | Alert triage | JOB-04 | 5 |
| JOB-15 | New-employee VPN tickets | Routine tickets | ACC-01 | 5 |
| BRD-01 | All 10 dialect families | CLI dialect system | CORE-06 | 6 |
| BRD-02 | Full parody brand roster | Vendor landscape | CORE-02 | 6 |
| BRD-03 | Full device fault catalog | Device faults (02-device-faults.md) | CORE-08 | 6 |
| BRD-04 | All case files | Case files (03-case-files.md) | CORE-08 | 6 |
| BRD-05 | Wireless depth: controllers, bridges, mesh, guest portals | Device faults (02-device-faults.md) | CORE-07 | 6 |
| BRD-06 | Hypervisor networking | Device faults (02-device-faults.md) | CORE-07 | 6 |
| BRD-07 | Endpoints: phones, cameras, printers, POS, building systems | Device faults (02-device-faults.md) | CORE-07 | 6 |
| BRD-08 | ISP and LTE failover gear | Device faults (02-device-faults.md) | CORE-07 | 6 |
| BRD-09 | IT Gloo docs skin | Decisions | DESK-02 | 6 |
| BRD-10 | Hard-mode clients: flat multi-subnet networks, mixed vendors | Escalation; Client budgets | CORE-01 | 6 |
| PRC-01 | Problem tickets from repeat incidents | Industry practices | CORE-05 | 7 |
| PRC-02 | Post-incident summary after P1 | Industry practices | ACC-10 | 7 |
| PRC-03 | Lifecycle tracker | Industry practices | JOB-06 | 7 |
| PRC-04 | Quarterly network review job | Industry practices | DESK-06 | 7 |
| PRC-05 | Offboarding tickets | Industry practices | JOB-15 | 7 |
| PRC-06 | Expiry calendar: certs, subscriptions, contracts | Industry practices | CORE-04 | 7 |
| PRC-07 | Seasonal freezes | Industry practices | SHF-05 | 7 |
| PRC-08 | Maintenance notices | Industry practices | JOB-01 | 7 |
| PRC-09 | Scheduled config backups | Industry practices | DESK-06 | 7 |
| DOC-01 | Documentation as enablement: KB articles hand ticket types to tier 1 and 2 | Documentation as enablement | DESK-02 | 4 |

## Claude Code handoff

1. The spec lives in `spec/`, one file per tab of the original design doc
2. `CLAUDE.md` at the repo root points Claude Code at the spec and names the current phase
3. First request: propose the tech stack and a Phase 0 plan from this feature list, then build Phase 0
4. Build phase by phase; each phase ends playable before the next starts

Status: gap questions answered and every proposed item reviewed on Oct 17, 2026. The spec is ready.
