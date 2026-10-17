# Case files

A case chains two to four faults from the device fault catalog (02-device-faults.md) into one mystery, so the obvious answer from remote tools is wrong or incomplete. Remote diagnostics narrow it down; the building, the people or the history supply the twist.

## How a case works

1. Ticket: what the client reports, in their words
2. First clue: what remote tools show (monitoring, switch counters, logs)
3. Red herring: evidence that points at the wrong cause
4. Twist: the fact that changes the theory, usually physical, human or historical
5. Root cause: the real fault, which may be a chain
6. Fix: what resolves it, plus any follow-up that stops a repeat

Worked example, The Phantom Short:

1. Ticket: "The Wi-Fi in Exam 3 keeps going out."
2. First clue: the AP is offline. Its switch port shows link but draws no PoE.
3. Red herring: a cable test from the switch shows odd results, so the run looks shorted.
4. Twist: onsite, the AP run lands at a desk. It goes through the desk phone's PC port into a PoE injector, then to the AP.
5. Root cause: the injector's outlet is dead because a GFCI behind the break room coffee maker tripped.
6. Fix: reset the GFCI and move the AP to a switch PoE port. Then document the run and remove the injector.

Resolving the follow-up step raises the client's network health score, which feeds the progression system.

Pick values: First slice, Later, Cut.

## Case list

35 cases across both tables; 18 are set to First slice, chosen to cover every layer and every access mode at least once.

| Case | Ticket says | Red herring | Real cause | Solved via | Pick |
| --- | --- | --- | --- | --- | --- |
| The Phantom Short | Exam room Wi-Fi keeps going out | Cable test looks shorted | AP fed by injector behind a desk phone; GFCI tripped on that circuit | Remote, then onsite | First slice |
| Lights Out | NVR goes offline every night, back by morning | Firmware crash or scheduled reboot | Outlet is on the office light switch | Monitoring history, remote hands | First slice |
| Tuesday, 7 PM | Whole site drops Tuesday evenings | ISP outage | Cleaning crew unplugs the closet power strip to vacuum | Outage pattern, remote hands | First slice |
| Camera Day | Phones reboot, Exam 3 AP down since Monday | Bad AP or phone firmware | Four new cameras exhausted the PoE budget, all ports low priority | Remote SSH | First slice |
| Same Address, Different Camera | Cameras vanish one by one during install | Bad NVR | Every camera ships on the same default IP | Remote, installer on phone | Later |
| The Helpful Installer | Random PCs can't reach the internet | Firewall DHCP broken | New NVR running its own DHCP server | Remote, find MAC on switch | First slice |
| Tidy Desk | Site-wide outage right after office cleanup | Firewall or ISP | Phone PC port patched into a second wall jack, creating a loop | Remote counters, remote hands | First slice |
| Slow Steve | One user's file copies crawl | Malware or failing disk | PC sits behind a phone with a 10/100 PC port | Remote agent, docs | First slice |
| The Barn | Barn link slow every summer | Radio failing | Trees grew into the path | Signal history, onsite | Later |
| Pause Button | Office crawls, switch barely responds | Loop or STP | One docked laptop's USB-C dock floods pause frames | Remote counters | First slice |
| Patch Night | Calls one-way after firmware night | New phone system bug | Upgrade turned SIP ALG back on | Release notes, remote | First slice |
| Midnight Backups | Offsite backups fail every night | Backup vendor outage | Firewall rule carries a business-hours schedule | Remote, policy review | First slice |
| Ten Megabit Office | ISP upgrade "did nothing" | ISP never provisioned it | Shaper still set to old circuit speed | Remote | Later |
| Nobody Home | Monitoring says whole site is down at 10 PM | Real outage | Monitoring probe PC went to sleep | RMM, docs | First slice |
| Locked Out | Can't reach client firewall after MSP office ISP change | Firewall crashed | Trusted hosts only allow the MSP's old IP | One-time session or console via remote hands | First slice |
| Overlap | One remote user can't reach anything on VPN | VPN server broken | Home LAN uses the same subnet as the office | Remote, user's PC | First slice |
| Branch Silence | Branch tunnel down after ISP work | Phase 1 mismatch | Branch WAN IP changed; a coworker then broke phase 2 "fixing" it | Remote, both firewalls | First slice |
| Hot Weekend | Closet devices reboot on weekends | Firmware | Building AC off weekends, closet door shut | Temp logs, onsite | Later |
| Double Trouble | Shop's card reader and printer flaky | Card processor | Consumer mesh in router mode behind an ISP gateway that reset | One-time session, onsite | Later |
| The Saturday Brownout | Two-second flicker took the closet down | UPS undersized | UPS battery dead and switch on surge-only outlets | Remote hands photo, onsite | First slice |
| Monday Printer | "Printer offline" every Monday | Driver issue | Printer powered off weekends, DHCP gave it a new IP | Remote | Later |
| Declined | Cards decline with communication error | Processor outage | New firewall policy blocks processor host | Remote, deny logs | Later |
| Half the Phones | Half the phones dark after a weekend | Phone system outage | PoE switch lost one PSU, budget halved | Remote, then onsite with PSU | Later |
| Two Servers | Random clients can't resolve internal names | DNS server broken | New firewall shipped with DHCP on, competing with Windows DHCP | Remote | First slice |
| Mail Goes to Spam | Outbound email bouncing since firewall swap | Mail provider issue | Outbound NAT uses a public IP not in SPF | Remote, NAT and DNS records | Later |
| The Ghost VLAN | VM dies after moving to the other host | Guest OS issue | Host B's switch port trunk is missing the VLAN | Remote | Later |
| Heartbeat | Random total outages | ISP flapping | HA heartbeat cable borrowed for a laptop, split brain | Remote logs, remote hands | Later |
| Building Blues | HVAC front end loses controllers after a re-IP | Vendor software bug | BACnet broadcasts can't cross the new subnet, no BBMD | Remote, vendor call | Later |

## Unmanaged gear cases

These cases end in a scheduled after-hours window with an onsite tech or the client on the phone, played as multiple-choice steps.

| Case | Ticket says | Red herring | Real cause | Solved via | Pick |
| --- | --- | --- | --- | --- | --- |
| The Ceiling Switch | Exams 3 and 4 lose network at random | Bad switch port | Unlabeled 8-port switch above a ceiling tile with a dying power brick | After-hours window, onsite, toner | First slice |
| Whose Router Is It? | Random PCs get 192.168.1.x addresses | Firewall DHCP broken | Copier vendor's router plugged into the LAN | After-hours window, client on phone unplugs while you watch leases | First slice |
| Locked Box | Warehouse switch needs a VLAN change, nobody has the password | Wrong vault entry | Old switch never documented; console password recovery reboots it | After-hours window, onsite with console cable | Later |
| Powerline Ghost | Back office PC drops at lunch | Bad NIC | Powerline adapters, noise when the microwave runs | Client on phone confirms adapters, onsite replaces with a cable run quote | Later |
| The Extender | Reception laptop slow, odd IP | Laptop Wi-Fi driver | Consumer Wi-Fi extender in router mode | Client on phone, after hours | Later |
| Wall Plate Mystery | Three devices behind one jack | Port security bug | In-wall 4-port switch nobody documented | After-hours onsite | Later |
| The ISP's Box | Port forward change won't stick | Firewall bug | ISP gateway in front still filters; only the carrier can change it | Carrier ticket, ISP tech window | Later |

## More case ideas from the main spec

| Case | Ticket says | Real cause | Solved via | Pick |
| --- | --- | --- | --- | --- |
| Amnesia Switch | Core switch dead before the morning rush | No config backup; VLANs must be rebuilt from neighbor trunks, packet captures and phone behavior on the default VLAN | Onsite, replacement job | Later |
| Mozzarella Firebox | Break-fix client needs help, can't reach the support site | Low-competence contact; the one-time session dialogue is the puzzle | One-time session dialogue | Later |
