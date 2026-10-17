# MSP Network Admin Game: Research & Design Notes

Oct 16, 2026 · @David Goettler

## Contents

- Part 1: Concept and world
- Part 2: Faults
- Part 3: Daily work
- Part 4: Jobs
- Part 5: Clients and progression
- Part 6: Onsite and generation
- Part 7: Industry practices
- Reference

# Part 1: Concept and world

## Concept and game modes

The player is an MSP network admin working escalations from a ticket queue. Each ticket lands on a procedurally generated client network built from parody vendors, with one to three real faults plus red herrings. The player wins by finding root cause, fixing it without collateral damage, and closing the ticket with notes that name the device and IP.

The core loop is: dispatch hands off ticket, triage, pick an access path, gather evidence, fix, document, close. Access is a puzzle in itself: the right path depends on what is managed, what is still online, and what the docs say.

| Access mode | How the player gets in | Friction | What it unlocks |
| --- | --- | --- | --- |
| Unattended agent | RMM agent on a server or PC at the site | Agent goes offline when the site WAN or that VLAN is down | Shell on that host, ping, tracert, nslookup, browser to device GUIs on the LAN |
| Site VPN to jump box | VPN client that matches the client's firewall brand, then SSH or RDP to a jump host | Wrong client app or version fails, MFA prompt, creds pulled from docs vault | SSH, browser, SNMP from inside the network |
| Cloud controller | Vendor cloud dashboard login | Org access must already exist in docs | Dashboard, event log, live tools, packet capture where the vendor offers it |
| One-time session | Schedule a window with a non-managed or break-fix client; they run a one-time support app | Contact must be present and click Allow; session dies when they leave | Their PC only, plus whatever it can reach |
| Remote hands | Phone or chat with a client employee | Unreliable narrator: wrong port, wrong LED color, unplugs the wrong thing | Their eyes, photos of the rack |
| Console | Console cable via remote hands or onsite, or an OOB console server | Baud rate, rollover vs USB-C console, driver | CLI when the management plane is unreachable |
| Onsite | Truck roll to the site | Drive time burns SLA clock | Physical view: racks, labels, LEDs, cable tester, toner, PoE tester, spare SFPs and patch cables |

Difficulty scales by client tier. Mom-and-pop shops run one site on consumer-grade gear with no docs. Managed SMBs have docs that are partly stale. Multi-site clients bring SD-WAN, site-to-site VPN, HA pairs and dynamic routing.

## Decisions

| Area | Decision |
| --- | --- |
| Players | Single player. The story opens as an MSP engineer recently promoted to network admin; other tiers may come later, but the focus is networking |
| Build | Framework web app with saved progress |
| Core surfaces | One integrated MSP platform, Atrium (an Atera look-alike): ticketing, RMM, remote sessions and help desk in one app. Separate: VPN clients with authenticator codes, SSH and terminal tools on client servers and the tech's workstation, and console cables onsite |
| Docs tool | Hudu look-alike (Hoodoo Docs); IT Glue look-alike (IT Gloo) as an optional skin |
| CLI | All major commands, one base parser for every brand, with a per-brand dialect layer on top |
| Brands | Parody names covering major vendors and small SMB brands |
| Onsite view | 2D rack front view plus floor plan, click devices, ports and cables |
| Unmanaged gear | Identified only through scheduled after-hours maintenance with an onsite tech or the client on the phone; played as multiple-choice steps that update the ticket |
| Supported gear | The MSP supports a standard list; anything else is flagged, raised to sales through dispatch, and replaced |
| Replacement | Its own job type: swap the device, reconnect it, configure it to fit the existing network |
| Communication | The tech never schedules or sells directly; every status change is a multiple-choice update that routes to the dispatcher, who handles client contact, scheduling and sales. Quick direct calls for a fast answer or test are allowed unless the client prefers scheduled contact only |
| Run length | Both: full shift with a ticket queue, and single-ticket quick play |
| Fault design | Detective cases that chain device faults, built from spec/02-device-faults.md and spec/03-case-files.md |
| Progression | Client networks improve over time, review ratings rise or fall, clients leave and new ones sign |

## MSP tech tool stack

Most MSPs run five layers: PSA, RMM, security, backup and documentation ([Flamingo](https://flamingo.run/blog/msp-stack-audit)). For a network game, the player's desktop needs PSA, RMM, docs, remote access, network monitoring and VPN clients. The default in-game stack mirrors a typical setup: a Hudu-style docs tool, a ScreenConnect-style access tool and an Auvik-style network monitor.

| Category | Real-world examples | Game parody | Role in gameplay |
| --- | --- | --- | --- |
| PSA (tickets, time, SLA) | ConnectWise PSA, Autotask, HaloPSA ([Expert Insights](https://expertinsights.com/it-management/best-msp-platforms-for-business)) | LinkWise Desk | Ticket queue, SLA clock, time entries, dispatch handoff, client contacts |
| RMM (agents, scripts) | NinjaOne, Datto RMM, ConnectWise RMM, N-able, Kaseya VSA, Atera ([Domotz](https://blog.domotz.com/all/best-rmm-for-msp/)) | Shinobi RMM | Agent online status, run script on host, background shell, alert feed |
| Documentation and vault | IT Glue, Hudu | Hoodoo Docs | Site diagrams, IP plan, credentials, VPN profile notes, ISP circuit IDs; may be stale |
| Remote access, unattended | ScreenConnect access agents, Splashtop, TeamViewer | ScreenLink Access | Persistent agent on client servers and PCs |
| Remote access, one-time | ScreenConnect support session, Splashtop SOS, TeamViewer QuickSupport | ScreenLink Support | Join code, client must accept, session ends when they leave |
| Network monitoring | Auvik, Domotz, PRTG, LibreNMS | Ovik | Topology map, interface graphs, config backups, syslog, alerts that may be false |
| VPN clients | FortiClient, GlobalProtect, Cisco Secure Client, NetExtender, WatchGuard SSL client, Sophos Connect, WireGuard | One per parody firewall brand | Only the matching client connects to that brand's firewall |
| Terminal and diag tools | PuTTY, SecureCRT, Wireshark, iperf3, nmap, WinMTR, TFTP server | In-game terminal and capture viewer | SSH, serial console, packet capture, throughput test |
| Internal comms | Teams or Slack, softphone | Team chat and phone | Dispatch, escalation to senior, calling client contacts |
| Field kit (onsite) | Cable certifier, toner and probe, PoE tester, console cables, spare SFPs, label maker | Tool belt inventory | Physical tests that remote tools cannot do |

Two access tiers matter for scenario design. Managed clients have unattended agents and doc entries. Non-managed or break-fix clients only allow one-time sessions scheduled with a contact, which adds a calendar and availability mechanic.

Update, Oct 17: in-game, ticketing, RMM, remote sessions, help desk and monitoring merge into one platform, Atrium. The separate names above remain as real-world references. See Core interaction surfaces.

## Core interaction surfaces

Most play happens in four tools. Terminals and device web pages open only once one of these gets the player in.

| Surface | Look-alike of | What the player does |
| --- | --- | --- |
| Atrium, the all-in-one MSP platform | Atera-style RMM, PSA and help desk in one | Ticket queue and calendar, ticket notes and handoffs, RMM agents and background shell, scripts, unattended and one-time remote sessions, help desk portal, network monitoring module |
| Hoodoo Docs | Hudu, with IT Gloo as an optional skin | IPs, credentials, VPN profiles, contacts, circuit IDs, KB articles; update after fixes |
| VPN client per firewall brand | FortiClient, GlobalProtect, Secure Client and others | Connect with the profile named in docs; wrong client or version fails |
| Authenticator on the in-game phone | TOTP authenticator apps, push approvals | Type the 6-digit code before it rotates; too many bad codes locks the account; clock drift breaks codes |
| SSH and terminal tools | PuTTY-style clients on client servers and the tech's workstation | Device CLI over the network, or over a console cable onsite |

Everything inside Atrium is seamless: a ticket links straight to the client's agents, sessions and monitoring, with no separate logins. The friction lives where it does in real life, at the VPN, the authenticator, the terminal and the console cable.

Inside Atrium, each module keeps its own name and landing page, so the player always knows which tool they're in: LinkWise Desk (tickets and calendar), Shinobi RMM (agents and scripts), ScreenLink (remote sessions), and Ovik (monitoring). Hoodoo Docs, VPN clients, the authenticator and the terminal stay outside Atrium.

Picking an access path always starts in the docs tool. The client record answers it: a server to land on, cloud-managed network devices, a VPN profile, or a one-time-session-only client. Skipping the docs and guessing wastes time on paths that don't exist.

Getting a low-competence contact into a one-time session is its own dialogue puzzle. They can't find the support site, can't tell which browser they have ("Mozzarella Firebox"), and read the join code back wrong. The player picks phrasing step by step: describe the icon, spell the address, have them read what's on screen. Patience choices protect the rating; rushing makes the contact give up.

Ways onto a firewall, set per client in docs:

- RMM onto a server or box at the site, then the firewall's local address
- Client VPN, then the firewall's local interface address
- A central firewall manager the MSP runs
- Directly through a cloud dashboard, for cloud-managed brands

Consent rule: servers and site boxes are fair game through RMM, but a user's workstation needs that user's consent first. Remoting into someone's machine without asking is a penalty, even when the agent makes it possible.

## Vendor landscape and parody brand map

The firewall market is led by Palo Alto, Fortinet, Cisco and Check Point, with SonicWall, WatchGuard, Sophos, Barracuda and Juniper common in SMB and MSP fleets ([MRFR](https://www.marketresearchfuture.com/de/reports/network-security-firewall-market-32748), [QKS](https://qksgroup.com/market-research/market-forecast-network-firewalls-2026-2030-worldwide-2754)). Each parody brand copies its real model's management style and CLI grammar, so real-world skill transfers but every brand still needs its in-game docs.

### Firewalls

| Real-world model | Game brand | Management style | Matching VPN client | CLI flavor |
| --- | --- | --- | --- | --- |
| Fortinet FortiGate | Fortress Networks FortressGate | GUI plus full CLI, FortiLink-style switch and AP control | FortressClient | `config` / `edit` / `set` / `next` / `end` blocks, `diagnose` and `get` |
| Palo Alto NGFW | Palisade PA series | GUI, commit model | GlobalShield | Operational vs configure mode, `commit` |
| Cisco ASA / FTD | Cypress Guard | ASDM-style GUI or manager, CLI | Cypress Secure Connect | IOS-like, `show`, `conf t` |
| Cisco Meraki MX | Meridian Cloud MX | Cloud dashboard only, no CLI | Meridian client VPN | None, dashboard tools only |
| SonicWall | SonarWall | GUI first, limited CLI | NetVoyager | Terse CLI |
| WatchGuard Firebox | WatchTower Box | Desktop policy manager plus web UI | WatchTower SSL client | Limited CLI |
| Sophos Firewall | Sapient XG | Web UI, central cloud | Sapient Connect | Menu-driven console |
| Check Point | Checkmate | Management server plus gateway | Checkmate Endpoint | Expert mode shell, `clish` |
| pfSense / OPNsense | OpenWall | Web UI, FreeBSD shell | WireGuard or OpenVPN | Menu console plus shell |
| UniFi gateways | OmniWave Gateway | Controller app, cloud or self-hosted | WireGuard / Teleport-style | Limited shell |

### Switches

| Real-world model | Game brand | Quirk worth simulating |
| --- | --- | --- |
| Cisco Catalyst | Cypress Catalyst | trunk / access, PVST+, err-disable recovery |
| Aruba CX and ProCurve | Aurora CX / Aurora 2500 | tagged / untagged per VLAN instead of trunk / access; MSTP default |
| Juniper EX | Jasper EX | candidate config, `commit confirmed` rollback |
| Meraki MS | Meridian MS | Dashboard only, cable test and port cycle tools |
| UniFi | OmniWave Switch | Port profiles from controller, adoption issues |
| TP-Link Omada / Netgear | TriLink Omega / NetGrange | Mixed CLI and web, consumer defaults |
| FortiSwitch | FortressSwitch | Managed from the firewall over FortiLink-style link |
| Ruckus ICX / Dell | Rumpus ICX / Dellmar | Stacking quirks, Cisco-ish CLI |

### Full parody roster: majors and small brands

Mom-and-pop and SMB sites lean on the smaller brands, so the generator weights them by client tier. Dialect family is the CLI dialect each brand uses (see CLI dialect system).

| Real-world brand | Game brand | Gear in game | VPN client | Dialect family |
| --- | --- | --- | --- | --- |
| Ubiquiti UniFi | OmniWave | Gateways, switches, APs, controller | WireGuard / Teleport-style | Controller only, device shell for adoption |
| Ubiquiti EdgeRouter | OmniWave EdgeRunner | Routers | OpenVPN / WireGuard | Commit family |
| Ubiquiti airMAX | OmniWave AirLink | Point-to-point bridges | None | Web UI only |
| SonicWall | SonarWall | Firewalls, switches, APs | NetVoyager | Commit family |
| WatchGuard | WatchTower | Fireboxes, APs | WatchTower SSL client | Limited CLI |
| Sophos | Sapient | Firewalls, switches, APs | Sapient Connect | Menu console |
| Barracuda CloudGen | Barricade | Firewalls | Barricade VPN client | Limited CLI |
| Zyxel USG Flex, Nebula | Zylo Flex, Zylo Nebulon | Firewalls, switches, APs, cloud | Zylo Extender | IOS-like |
| Netgear | NetGrange | Switches, APs, Insight cloud, consumer routers | None | IOS-like or web only |
| TP-Link Omada | TriLink Omega | Gateways, switches, APs, controller | WireGuard / OpenVPN | IOS-like |
| D-Link | DeLynk | Switches, consumer routers | None | IOS-like |
| MikroTik | MicroTick | Routers, switches | WireGuard / L2TP | Path family |
| DrayTek Vigor | DrayTrek Vigil | Routers with VPN | DrayTrek Dialer | Web only |
| Peplink | Peplynx | Multi-WAN routers, bonding | Peplynx client | Web only |
| Cradlepoint | CrestPoint | LTE / 5G routers, cloud | None | Cloud only |
| Untangle / Edge Threat Mgmt | Tangle Edge | Firewalls | OpenVPN | Linux shell |
| Cisco Business (CBS / RV) | Cypress Business | Small switches and routers | Cypress Secure Connect | IOS family |
| HPE Aruba Instant On | Aurora Instant | Small switches, APs, cloud app | None | Cloud only |
| Extreme Networks | Extremis | Switches, APs | None | IOS-like |
| Arista | Aristo | Data center and campus switches | None | IOS family |
| Allied Telesis | Allied Telecore | Switches | None | IOS family |
| Cambium | Cambrian | PtP / PtMP radios, cnMatrix switches, APs | None | Web and cloud |
| Netonix | Netronix | WISP PoE switches | None | Web only |
| EnGenius | EnGenie | APs, switches, cloud | None | Cloud only |
| Grandstream | Grandstand | APs, routers, VoIP phones | None | Web only |
| Juniper Mist | Jasper Fog | Cloud-managed APs and switches | None | Commit family |
| Hillstone | Hillcrest | Firewalls | Hillcrest client | IOS-like |
| eero, Linksys, ISP gateways | Arro, Lynxsys, XFinite Gateway | Consumer mesh and ISP combo boxes | None | App only, no CLI |

Endpoints that cause network faults get parody brands too: VoIP phones (LLDP-MED, voice VLAN, PoE class), IP cameras and NVRs (PoE budget, multicast), printers and copiers (SMTP, mDNS) and card readers (outbound ports, DNS).

### Wireless

Aruba, Meraki MR, UniFi, Ruckus, Cisco, FortiAP, Juniper Mist and Omada cover most MSP fleets. Game brands reuse the switch names above. Key mechanics: controller adoption (DHCP option 43, DNS, inform URL), SSID to VLAN mapping, PoE class, channel plan, DFS events and RADIUS.

### Hypervisor networking only

| Real-world platform | Game brand | Networking objects to simulate |
| --- | --- | --- |
| VMware vSphere vSS / vDS | vWeave | Port groups, VLAN ID 4095 trunk, NIC teaming policy, promiscuous mode and forged transmits |
| Hyper-V | HyperVane | External / internal / private vSwitch, Switch Embedded Teaming, per-vNIC VLAN set by PowerShell |
| Proxmox VE | Proxbox | Linux bridge vmbr0, VLAN-aware checkbox, bonds, optional Open vSwitch ([virtualizationhowto](https://virtualizationhowto.com/2023/12/proxmox-networking-for-vmware-vsphere-admins)) |
| XCP-ng / Nutanix AHV | Xenon / Nimbus | OVS-based bridges, bond modes |

Proxmox bridges are not VLAN-aware out of the box, and VMware port groups act as the equivalent of Linux VLANs on a bridge ([virtualizationhowto](https://virtualizationhowto.com/2023/12/proxmox-networking-for-vmware-vsphere-admins)). Both make good silent-failure scenarios.

### ISP and edge gear

Cable modems (bridge mode vs router mode), fiber ONTs, fixed wireless, LTE or 5G failover, and satellite with CGNAT. ISP docs carry circuit ID, static IP block, gateway and support phone, which the player must look up to open a carrier ticket.

## CLI dialect system

Every device runs the same base parser. A brand's dialect only swaps keywords, mode entry rules, interface names and save behavior, so the same skill works everywhere but trips the player until they check that brand's command guide.

Base verbs: enter shell, enter privileged mode, enter config mode, show, set, negate (no / delete / unset), select interface, VLAN assign, save or commit, exit, ping, traceroute, counters, help (`?`).

A dialect file defines: token map, prompt strings per mode, entry rules (press Enter at banner, `enable`, `cli`), interface naming, save semantics, error message style.

| Dialect family | Brands | Get to config | Save | Interface name | Trip-up |
| --- | --- | --- | --- | --- | --- |
| IOS family | Cypress, Cypress Business, Rumpus, Dellmar, Aristo, Allied Telecore | `enable` then `configure terminal` | `write memory` | `Gi1/0/24` | Forget to save and a reboot loses it |
| IOS-like | Zylo, NetGrange, TriLink, DeLynk, Extremis, Hillcrest | Press Enter at banner, `enable`, `configure` | `copy running-config startup-config` | `1/0/24` or `24` | Short forms differ, `conf t` rejected on some |
| Aurora CX | Aurora CX switches | `configure terminal`, no `enable` | `write memory` | `1/1/24` | `vlan access 10` instead of `switchport access vlan 10` |
| Aurora classic | Aurora 2500 | `configure` | `write memory` | `24` | VLAN-centric: `vlan 10 untagged 24` |
| Fortress | FortressGate, FortressSwitch | `config <section>`, `edit <item>`, `set`, `next`, `end` | Saves on `end` | `port1`, `internal1` | Exit without `end` and nothing applies |
| Commit family | Jasper, Jasper Fog, Palisade, SonarWall, OmniWave EdgeRunner | `cli` then `configure` | `commit` (Jasper: `commit confirmed 5` auto-rolls back) | `ge-0/0/24`, `ethernet1/24`, `X0` | Nothing applies until commit |
| Path family | MicroTick | Path commands like `/interface print`, `/ip address add` | Live, safe mode undoes on disconnect | `ether24` | Totally different grammar, still same verbs underneath |
| Linux shell | OpenWall, Tangle Edge, Proxbox, jump hosts | Root shell | Config files or tool | `eth0`, `vmbr0` | `ip`, `bridge` and `ethtool` commands |
| Limited or menu | Sapient, WatchTower, Checkmate | Menu number or `clish` / expert mode | Varies | Varies | Most config is GUI only |
| No CLI | Meridian, Aurora Instant, CrestPoint, EnGenie, consumer gear | Dashboard or app only | Auto | Port numbers | Player must use GUI tools: cable test, port cycle, packet capture |

# Part 2: Faults

## Fault catalog, layer 1 to layer 7

The catalog holds about 100 faults the scenario generator can inject. Each row lists what the player or client sees, the evidence that proves it, and the fix. Layer 8 (people and process) faults ride on top of any of them.

### Layer 1: physical

| Fault | What the player sees | Evidence | Fix |
| --- | --- | --- | --- |
| Damaged patch cable or bad termination | Intermittent drops, slow transfers | Climbing CRC / FCS and input errors, cable test shows open or short pair | Replace cable |
| Broken pair on gigabit run | Gig port links at 100 Mb | Port speed 100 full on a 1G port, TDR shows pair 3 or 4 open | Re-terminate or replace |
| Run over 100 m or split pairs | Errors under load, link flaps | Cable certifier length and crosstalk fail | Shorten run or add switch |
| Duplex mismatch | Slow under load, VoIP choppy | Late collisions on half-duplex side, CRC and runts on full side | Set both sides auto, or both hard-set |
| Autoneg disabled one side | No link or link at 10 Mb | Interface down or wrong speed | Match settings |
| Wrong port (remote hands) | Device "plugged in" but offline | MAC learned on unexpected port, LLDP neighbor mismatch | Correct patching, update port map |
| Wrong SFP type | Fiber uplink down | SR optic on single-mode run, DOM shows no Rx | Swap optic |
| Dirty fiber or Tx/Rx swapped | Fiber link down or erroring | DOM Rx power low or absent | Clean, roll strands |
| Unsupported third-party SFP | Port err-disabled at boot | Log shows unsupported transceiver | Vendor optic or allow command per docs |
| PoE over budget | APs, phones or cameras reboot or never power | Power budget used near max, last ports denied | Port priority, second PSU, injector |
| PoE class too low | AP up but radios off or 1x1 | AP log reports low-power mode, port gives 802.3af to an at/bt AP | PoE+ or PoE++ port, injector |
| Failed PSU or UPS | Whole closet down after outage | UPS self-test fail, PSU LED amber | Replace, open RMA |
| Overheating closet | Random reboots in afternoon | Temp sensor logs, fan fail alarm | Ventilation, clean filters |
| EMI near unshielded run | Errors on one run only | Run passes near motor or lighting ballast | Reroute or shielded cable |
| ISP fiber cut or ONT down | Total site outage | ONT LOS light red, modem no sync | Carrier ticket with circuit ID |
| Wireless co-channel interference | Slow Wi-Fi, high retries | High channel utilization, APs on same channel | Fix channel plan, lower power |
| Non-Wi-Fi interference | 2.4 GHz unusable at lunch | Spectrum shows microwave pattern | Move clients to 5 GHz |
| DFS radar event | APs hop channel, brief drops | DFS event log | Exclude DFS channels near radar |
| Coverage hole or sticky clients | Weak signal in one area, roaming fails | Low RSSI, clients stay on far AP | Add AP, tune power, minimum RSSI |

### Layer 2: data link

| Fault | What the player sees | Evidence | Fix |
| --- | --- | --- | --- |
| Switching loop | Whole site down or crawling | Broadcast storm counters, MAC flapping logs, high CPU, topology change count rising | Pull loop, enable STP, BPDU guard, loop protect, storm control |
| Unmanaged desk switch becomes STP root | Uplinks blocking, odd paths | Root bridge ID is not the core | Set core priority, root guard |
| Mixed STP modes | Slow convergence, blocked uplink | PVST+ vs MSTP boundary in logs | Align mode per docs |
| BPDU guard err-disable | User port dead after they plug in a switch | Port err-disabled, reason BPDU guard | Remove switch, recover port |
| Pause frame flood | Network crawls, switch unresponsive | Rx pause counters climbing on one port | Disable flow control, isolate device ([HPE](https://hpe.com/psnow/resources/ebooks/a00115977en_us_v4/s_logical-switches-pauseflood-about.html)) |
| Access port in wrong VLAN | One device gets wrong subnet or none | Port VLAN vs IP plan in docs | Correct VLAN |
| VLAN missing from trunk allowed list | New VLAN works on one switch only | Trunk allowed list, VLAN not on downstream switch | Add VLAN |
| Native VLAN mismatch | Odd leaking between VLANs | CDP or LLDP mismatch warning | Match native VLAN |
| Tagged / untagged confusion across brands | Trunk to Aurora switch passes only one VLAN | Port tagged list vs Cypress trunk config | Translate config correctly |
| LACP vs static LAG mismatch | Loop or half the links suspended | LAG member state suspended or individual | Match LACP mode both sides |
| Port security violation | Hot-desk user dead | Sticky MAC violation, err-disabled | Clear sticky, raise max |
| Voice VLAN or LLDP-MED missing | Phones on data VLAN, no dial tone | Phone IP from data scope | Set voice VLAN |
| DHCP snooping blocks real server | Nobody gets addresses after change | Snooping drops on untrusted uplink | Trust uplink |
| Rogue DHCP server | Clients get 192.168.0.x | DHCP offer from unknown MAC | Find port by MAC, remove device |
| Unidirectional fiber | Loop or blackhole on fiber uplink | One strand dead, UDLD err-disable | Fix strand, enable UDLD |
| Stack split or member firmware mismatch | Half the ports offline | Stack member not joined, version mismatch | Upgrade member, re-stack |
| Jumbo MTU mismatch | iSCSI or vMotion fails, small pings work | Large DF pings fail | Match MTU end to end |
| Multicast flooding | Cameras or IPTV flood all ports | No IGMP snooping or querier | Enable snooping and querier |
| Duplicate IP or IP conflict | Intermittent reachability | ARP shows two MACs for one IP | Fix static or reservation |
| Stale ARP at ISP after firewall swap | New firewall has no internet | ISP gateway still holds old MAC | Carrier clears ARP or spoof MAC |
| SSID on wrong VLAN | Wi-Fi users get guest subnet | SSID VLAN tag vs docs | Remap SSID |
| Client isolation on staff SSID | Can't reach Wi-Fi printer | Isolation enabled | Disable on staff SSID |
| WPA3-only or 802.11r breaks old devices | Scanners and old laptops can't join | Association failures by device type | Transition mode or separate SSID |
| Hypervisor port group wrong VLAN | One VM offline after migration | Port group VLAN vs docs | Correct port group |
| Host uplink trunk missing VLAN | All VMs on one VLAN offline on one host | Switch port trunk list on that host only | Add VLAN to host trunk |
| IP-hash teaming without switch LAG | VM MAC flapping, intermittent | MAC flap between host uplinks | Match teaming to switch config |
| Nested firewall VM drops traffic | Virtual firewall passes nothing | Promiscuous on, forged transmits off ([Proxmox forum](https://forum.proxmox.com/threads/nested-hypervisor-networking-issues-no-traffic-passing.144035/)) | Allow both on that port group |
| Bridge not VLAN-aware | Tagged VMs on Proxbox host get nothing | Bridge config lacks VLAN aware | Enable VLAN aware |

### Layer 3: network

| Fault | What the player sees | Evidence | Fix |
| --- | --- | --- | --- |
| Wrong gateway or mask on static device | Device reaches LAN only | ipconfig vs IP plan | Correct static |
| DHCP scope exhausted | New clients get 169.254 | Scope 100 percent, long lease on guest | Shorten lease, widen scope |
| DHCP relay missing on new VLAN | New VLAN gets no addresses | No helper or relay on SVI | Add relay |
| Overlapping subnets | VPN user can't reach office | Home LAN equals office LAN | Re-IP or NAT the tunnel |
| Missing or wrong static route | One remote subnet unreachable | Route table, traceroute dies at hop | Add or fix route |
| Asymmetric routing | TCP fails, ping works | Firewall drops for no session | Fix routing or policy |
| OSPF neighbor stuck | Branch routes missing | Stuck in ExStart (MTU) or no adjacency (area, timers, auth) | Match settings |
| BGP neighbor down | Failover or MPLS routes missing | Idle or Active, wrong AS or multihop | Fix peer config |
| Dual-WAN failover not working | Site down when primary ISP fails | Health check targets the modem, not the internet | Check a public target |
| Policy route sends traffic out wrong WAN | One app slow or geo-blocked | Policy route order | Fix policy order |
| Missing outbound NAT for new subnet | New VLAN has no internet | No NAT on policy | Enable NAT |
| Port forward to wrong host | External service unreachable | VIP maps to old IP | Fix mapping |
| Hairpin NAT unsupported | Inside users can't reach public name | Works outside only | Split DNS or loopback NAT |
| Double NAT | VPN and VoIP flaky | ISP router not in bridge mode | Bridge the ISP device |
| CGNAT on backup link | Site-to-site fails on failover | WAN IP in 100.64.0.0/10 | Static IP or dial-out tunnel |
| MTU black hole | Some sites half-load, VPN large transfers stall | Large DF pings fail, ICMP blocked | Clamp MSS, lower tunnel MTU |
| Inter-VLAN policy missing | VLANs can't talk | No policy or ACL between them | Add rule |
| Rogue IPv6 router advertisement | Clients prefer broken IPv6 path | Unknown RA source | RA guard, remove device |
| Wrong WAN IP block from ISP docs | Firewall has no internet after install | Gateway not in configured subnet | Correct from carrier docs |

### Layer 4: transport

| Fault | What the player sees | Evidence | Fix |
| --- | --- | --- | --- |
| Rule order, deny above allow | New rule "doesn't work" | Policy hit counts, deny matched first | Reorder |
| Wrong service object | One app blocked | Port in object differs from vendor docs | Fix object |
| Session timeout too short | RDP or SQL drops when idle | Session ages out at default TTL | Raise timeout for that service |
| Session table or NAT port exhaustion | Random new connections fail | Session count at limit | Find top talker, tune |
| SIP ALG breaks VoIP | One-way audio, phones unregister | SIP ALG on, NAT rewrite in capture | Disable ALG per phone vendor docs |
| Shaper set to wrong unit | Site capped at 10 Mb | Shaper at 10000 kbps not Mbps | Fix shaper |
| QoS missing for voice | Choppy calls at busy times | DSCP not honored or remarked | Mark and queue voice |
| Admin port clash | SSL VPN or forwarded web server dead | Admin GUI on 443 same as VPN | Move admin port |

### Layers 5 and 6: session and presentation

| Fault | What the player sees | Evidence | Fix |
| --- | --- | --- | --- |
| IPsec phase 1 mismatch | Tunnel never comes up | IKE log: no proposal chosen, PSK or peer ID mismatch | Match proposal, DH group, IKE version |
| IPsec phase 2 selector mismatch | Tunnel up, no traffic | Phase 2 subnets differ each side | Match selectors |
| Tunnel drops at rekey | Hourly outage | Lifetime mismatch, DPD settings | Match lifetimes |
| SSL VPN client version too old | Users can't connect after firmware upgrade | Client and firmware compatibility table | Push newer client |
| Split tunnel DNS missing | VPN connects, names fail | Client gets public DNS | Push internal DNS and suffix |
| Expired certificate | VPN or admin page warns or fails | Cert expiry date | Renew and bind |
| SSL inspection breaks app | Cloud app fails at office only | Pinned cert, untrusted CA | Exempt app or deploy CA |
| NTP drift | Certs invalid, MFA codes fail, AD auth fails | Device clock off by minutes | Fix NTP source |
| RADIUS shared secret or cert issue | Enterprise Wi-Fi or VPN auth fails | RADIUS reject, NPS log, expired server cert | Fix secret or renew cert |
| LDAP bind account expired | All VPN users fail at once | Bind failure in auth log | Reset service account |

### Layer 7: application

| Fault | What the player sees | Evidence | Fix |
| --- | --- | --- | --- |
| Wrong DNS servers handed out | Internal names fail | DHCP DNS option is ISP not AD | Fix DHCP option |
| DNS forwarders dead | Slow or failed lookups | Forwarder timeouts | Replace forwarders |
| Stale DNS record | Name points at old server | Lookup vs current IP plan | Fix record |
| Missing conditional forwarder | Site A can't resolve site B | No forwarder for partner zone | Add forwarder |
| Web filter miscategorized site | One vendor portal blocked | Filter log shows category block | Override per docs |
| IPS false positive | App breaks after signature update | IPS log drops matching app | Exempt signature |
| Captive portal loop | Guests stuck on portal | Portal host not in walled garden | Add exception |
| DHCP option 66/150 wrong | Phones boot without config | Phones request wrong TFTP | Fix option |
| DHCP option 43 or DNS missing | New APs never adopt | AP can't find controller | Set option or DNS record |
| mDNS / Bonjour across VLANs | Users can't find printer or display | Discovery works same VLAN only | mDNS gateway or reflector |
| Outbound SMTP blocked | Scanner email fails | Port 25 blocked by ISP or policy | Use submission port or relay |
| Expired license | UTM features stop, cloud device read-only | License status page | Renew |
| Known firmware bug | Symptom matches release notes | Vendor known issues list for that build | Upgrade or workaround |
| SNMP community mismatch | Monitor shows device down, users fine | SNMP timeout only | Fix community or v3 creds |
| Red herring: slow app server | Users blame network | Network clean, server CPU pegged | Hand to server team |

### Layer 8: people and process

Stale docs, wrong credentials in the vault, a client who changed ISPs without telling anyone, a previous tech's undocumented change, remote hands who describe the wrong rack, and change freezes that block a fix until after hours.

## Documentation lookup mechanic and scoring

Every parody vendor ships an in-game knowledge base, and most faults cannot be fixed from memory alone. The player must look up the brand's command for a counter, its default behavior, or a known bug for that firmware build.

Vendor KB contents per brand:

- CLI reference: the show, diagnose and debug commands for interfaces, counters, PoE, STP, LACP, VPN and routing
- Release notes with a known-issues list per firmware build
- Compatibility tables: SFP support, PoE class per AP model, VPN client version vs firmware
- Default settings: flow control, STP mode, SIP ALG, session timeouts, admin ports
- Feature naming map, so "trunk" on one brand equals "tagged" on another

Client docs (the MSP docs tool) hold site diagrams, IP plan, VLAN table, credentials, VPN profile notes, ISP circuit IDs and contacts. Some entries are wrong on purpose, scaled by client tier.

Scenario generator inputs:

1. Client tier and site template (single shop, office, warehouse, multi-site)
2. Vendor mix drawn from the brand map, weighted by tier
3. One to three faults from the catalog, plus zero to two red herrings
4. Doc staleness level
5. Access constraints: which agents are online, who is reachable, travel time

Scoring:

| Measure | Rewards | Penalizes |
| --- | --- | --- |
| Time to resolve | Beating the SLA clock | Breaching it |
| Access choice | Remote fix when possible | Unneeded truck rolls |
| Collateral damage | Safe changes, maintenance windows | Causing a new outage, locking yourself out |
| Root cause accuracy | Correct fault named | Fixing the symptom only |
| Ticket notes | Device name plus IP, plain language | Vague notes, missing identifiers |
| Doc hygiene | Updating stale docs after the fix | Leaving known-wrong docs |
| Escalation | Escalating when truly blocked | Escalating solvable tickets |

# Part 3: Daily work

## Day structure

A network admin's day is driven by the calendar, not the queue. A busy shift holds about 6 in-depth tickets in booked blocks. The queue is a watch list so SLAs don't sneak up. When a P1 lands, dispatch interrupts, reshuffles the calendar, and emails clients whose work moved. In-game, shift mode should show a calendar as the main view, with the queue and P1 interrupts on the side.

### Start of shift

1. Clock in, review email
2. Review tickets; tier 1 and tier 2 have already triaged, so the admin's tickets are escalations
3. Walk the calendar: is each block remote, client-facing or onsite?
4. Onsite blocks: is there enough travel padding?
5. Time budgets: is any ticket (like a network review) booked too short or too long? Ask dispatch to adjust

Catching a bad block at shift start is cheap. Missing it means arriving late or running out of time mid-job.

### After-hours windows

Most businesses: ideally after 8 PM, possible any time after 5 PM. Critical clients, like a police department, may only allow downtime around 3 AM, when they're least busy. Each client's allowed window is a generated trait.

### On-call

A NOC team exists but mostly covers servers. Network calls and alerts after hours go to an on-call rotation.

Mechanic: some weeks the player is on call. Alerts and calls land on the in-game phone at night. For each, the player picks: handle it now remotely, judge that it can wait for morning, or escalate. Server alerts that reach the phone are a misroute to bounce to the NOC.

### Priority and SLA

Tiers follow industry norms. A common MSP baseline is a 15-minute response and 4-hour resolution target for critical issues, 2 hours and next business day for high, and 8 hours and 3 to 5 business days for standard ([NinjaOne](https://www.ninjaone.com/blog/set-msp-response-times/)).

A ticket jumps to P1 when:

- Enough people are out of business or can't work
- A site is down in a major way
- It's aged with no action and no client communication

The last rule matters for gameplay: a forgotten low-priority ticket can turn into a P1 on its own, which is why the queue is still worth watching on a calendar-driven day.

Who sets priority: techs can set P2 through P4. Only dispatch sets P1, after a tech flags it, and dispatch picks which tech gets it based on workload.

P1 check-ins: dispatch checks in every hour until the ticket is de-escalated. In-game, a check-in prompt appears each in-game hour on an active P1 and the player picks a status update. Missing or vague check-ins cost rating even when the fix is on track.

## Status update dialogue

Every time the tech finishes a step, they pick a handoff and add a short detail. Dispatch handles the client from there. Real list from the interview:

| Handoff | What the tech adds | Dispatch then |
| --- | --- | --- |
| Resolved | What fixed it | Ticket closes |
| Reschedule | Whether the client must be present | Books the next available block on the tech's calendar |
| Teams call with client | What needs discussing | Sets up the call with the client |
| After-hours maintenance | General days and times the tech is available | Books the window with the client |
| Sales | Device and reason (unsupported, end of life, capacity) | Opens a quote |
| Customer question | The question | Gets the answer from the client |
| New ticket | The separate issue found | Creates the ticket; it lands back in the tech's queue |

After the status, the tech picks the best of three ticket notes, scored on plain language and concrete identifiers.

### Ticket statuses

| Status | Meaning |
| --- | --- |
| Dispatch Review | Handed to dispatch to act on |
| Awaiting Client Response | Waiting on the client |
| Feedback Received | The client answered; back to the tech |
| Scheduled | A block or window is booked |
| Follow-up Needed | Set automatically after 3 days with no status update |
| Closed | Done |

Follow-up Needed is the aging trap: a ticket left 3 days without an update gets flagged, and left longer it can be pushed to P1.

Shortcut: the player can call the ticket contact directly when a quick answer or a quick test will finish the job, skipping the dispatch loop. Each client has a contact-preference trait. Most welcome a quick call; some only want to be scheduled at their convenience, and calling them directly costs rating.

### Client dialogue traps

When talking to clients directly, some answers feel helpful and backfire later:

| Client asks | Trap answer | Right answer |
| --- | --- | --- |
| "When will it be fixed?" | A specific time | What's being done and that they'll get an update |
| "Will the other tech handle X?" | "Yes, they will" | Only repeat it if that tech explicitly said you can |
| "Can you show me how to do this?" | An hour of training | Decline unless it directly affects their daily operations |

A broken promise surfaces later as a rating hit on a different ticket.

### Sending a ticket back

Three reasons to hand a ticket back to dispatch instead of working it:

- Misrouted: it belongs to security or general engineering. Example: an endpoint security console that looks firewall-related but has nothing to do with the firewall; the clue is that the network tech has no access to that system.
- Nothing to go on: no usable detail at all.
- Duplicate: several tickets or alerts for the same outage. The tech confirms they match and dispatch merges them.

In-game, some tickets are planted as misroutes. Spotting one and bouncing it early scores; burning an hour on it before noticing the missing access doesn't.

## Playbook: site down

From the interview, this is how a real "internet down" P1 runs. It becomes the template for the first case.

1. Look up the firewall in docs. If the WAN is static, ping it.
2. In RMM, filter workstations by the firewall's public IP. See which are offline and when they dropped. Remote workers show home IPs and are a red herring.
3. No response: call the ISP. This needs the account number and security PIN. If they aren't in docs, the client has to pull them off a bill.
4. ISP says their gear is online: the client power cycles the modem or reads its status lights.
5. Outcomes the generator can pick: ISP outage, failed provisioning update (ISP reboots it), or a cable unplugged at the firewall.
6. ISP outage with no failover: tell the client to wait. The MSP watches firewall status, and the client should report when internet returns so the tech can verify. A missing failover becomes a sales handoff for an LTE backup.

In-game, the ISP call is its own dialogue with hold time, a script-reading agent, and the account and PIN check as a gate.

## Playbook: "the Wi-Fi is bad"

1. Listen and correlate what the user says with what the tools show
2. Ask the user: which network are they on, how much signal, do they have line of sight to the AP, when did they last reboot?
3. Dashboard: ISP latency, client latency, clients per AP, signal strength

Answers the generator can plant: the user is on the guest network, a neighbor's network or their phone hotspot; the laptop hasn't rebooted in weeks; the AP is behind a wall or cabinet; one AP is overloaded; or the ISP latency is the real problem and Wi-Fi is fine.

## Playbook: site-to-site tunnel down

1. Check both sides, not just the one in the ticket
2. Did the WAN IP change at either location?
3. Bounce the tunnel and see if it returns
4. Still down: read the logs for the exact error
5. Usual causes: pre-shared key changed, remote selector changed, a local subnet changed

In-game, the player needs access to both firewalls. When the other end belongs to a different client or vendor, it becomes a coordination job through dispatch.

## Playbook: one user can't connect

After finding the user's machine in RMM by username:

1. Online or offline?
2. Ping a local device, then the gateway
3. Is DNS resolving?
4. Static IP set by mistake? VPN still connected? Duplicate IP or a second gateway?
5. User error: wrong website name or wrong file share path

Mix plenty of step-5 endings into single-user tickets, so spotting user error quickly frees calendar time.

## Alert triage

Alerts that demand action right away:

- Firewall offline
- A vendor CVE scored 9.0 or higher
- A whole group of devices offline at once, like an entire classroom

A critical CVE becomes its own job: an advisory lands, and the player must find every affected device across all clients, check versions, and schedule emergency upgrades through dispatch. It reuses the firmware upgrade job and its suspense.

Common false alarms the generator should mix in: symptom-only reports with nothing behind them, a monitoring probe going offline so the whole site looks down, and a user reporting "no internet" who is simply disconnected from Wi-Fi or Ethernet. Spotting these fast and closing them cleanly saves calendar time for the real cases.

## Evidence reliability

Each tool tells the truth to a different degree. The generator can plant wrong data only in the less reliable sources.

| Source | Reliability | What can be wrong |
| --- | --- | --- |
| Direct SSH or web GUI on the device | Absolute | Nothing, it's the device itself |
| Cloud firewall and switch dashboards | Very high | Accurate, but configs are hard to read; downloading and reading the config file is often faster |
| RMM data on connected machines | Very high | Only covers machines with an agent |
| Network monitoring (Ovik) | Medium | SNMP gaps, stale IPs, inconsistent port maps; good for inventory and alert history |
| Alerts from tickets, email or clients | Unverified | Must be cross-checked before treated as fact |

Players who act on monitoring data without checking the device sometimes chase the wrong port or IP. Players who verify on the device first lose a little time and never get fooled.

## Credential recovery

When the vault entry fails, the player works down a ladder. Each rung costs more time:

1. Docs history tab: an older version of the entry may still work
2. Vendor default credentials, from the vendor KB
3. Docs access log: call the coworker who last viewed the entry
4. Call the client for credentials

Twist: some clients disable the MSP's accounts whenever there's no open ticket or project. The login fails even with the right password until the client re-enables it.

## Escalation

The player can pull in a senior tech, an NPC with limited availability. Escalating the right ticket is rewarded; escalating something solvable costs a little standing.

| Trigger | Escalate to |
| --- | --- |
| Too complex for the tech's level, e.g. BGP problems | Senior tech |
| Flat networks: several subnets on one switch with no VLANs | Senior tech |
| Failed hardware while the site is down | Escalation for replacement |

A flat multi-subnet network is also a good hard-mode client environment for the generator.

When to escalate depends on progress: is there a diagnosis, a recommended fix, or a roadblock?

| Situation | What to do |
| --- | --- |
| No roadblock, just a lot of work | Tell the team what you're working on, in case they have input |
| Roadblocked | Escalate as soon as you know you can't proceed; around 30 minutes at the earliest, but the block should be obvious well before |
| An hour in without good progress | Check in |

In-game, escalating a roadblocked ticket at the right time scores well. Grinding past the hour with no progress and no check-in costs rating.

## Change approval rule

If it's already down, fix it now. If the change could take down something that works, coordinate a window through dispatch.

| Change | Approval |
| --- | --- |
| Reboot, firmware update, or config change on working gear | Window through dispatch, so the client can warn their team |
| Anything on a device that's already down (P1 or critical) | None, approval is implied |
| Replacing something already broken, like an expired VPN certificate | None |

The client's real business hours and late workers are hidden from the tech. Making a disruptive change on working gear without a window risks knocking out someone working late, which costs rating.

## Close-out

Every fix ends in the same order:

1. Labels: add missing labels on what was touched, like both ends of an AP's run and the AP itself
2. Docs: update what relates to the device worked on, like the port map
3. Ticket: the resolution note
4. Client: tell them it's done

Scope matters. Document what you touched, not the whole site. Photos and network diagrams belong to new installs and network refreshes. In-game, labeling everything wastes window time, and skipping labels on touched gear makes the next ticket at that site harder.

### Closing rule

| Ticket origin | Can close when |
| --- | --- |
| Client reported it | Tested with the client (phone, email, any way) and concrete proof is attached: a screenshot or documented result |
| Client reported it, no proof yet | Only after asking the client whether it's good to close |
| Tech opened it after finding something | Proof it's resolved is attached; no client contact needed |

In-game, proof is an item: a screenshot of a passing test, a client confirmation, a log line. Closing without it risks a reopen and a rating hit.

### Wrap-up and time entry

- Time is logged in blocks, not minute by minute
- Before logging: review docs and configs and make sure the setup is understood
- The client email is drafted alongside the notes; sending it logs the time
- After a change that touches VLANs across the firewall and switches, back up every connected device's config while you're there
- Travel is logged against the ticket, marked to or from the office

A rushed close skips the review and the backups. The game rewards the wrap-up with fewer follow-up tickets and a clean rollback point next time.

### Resolution note

Every resolution note covers six parts, in plain language with device names and IPs:

1. Issue: what the problem was, showing it was understood
2. Findings: what the review turned up
3. Changes: what was changed, where
4. Root cause
5. Next steps, if any
6. Status: resolved or not

The pick-the-best-note step scores notes against these six parts. A note missing the root cause or the changes made always loses to one that has them.

## Routine tickets

Short, frequent tickets fill gaps in the calendar:

- New employee needs VPN: create the account, add it to the VPN users group, deploy the client by RMM script or by installer
- Website blocked by filtering, often right after hardening

# Part 4: Jobs

## Unmanaged and unreachable equipment

Some gear can't be logged into or even seen remotely. The player infers it from evidence, then schedules after-hours maintenance with an onsite tech or the client on the phone to find it. Play here is mostly multiple-choice steps and ticket updates.

| Equipment | Why there's no remote access | Remote evidence that hints at it |
| --- | --- | --- |
| Unmanaged desk switch | No management interface | Several MACs learned on one access port |
| Switch hidden above a ceiling tile or in a cabinet | Unlabeled, missing from docs | A whole room's MACs behind one port, no LLDP neighbor |
| In-wall or wall-plate switch | Looks like a jack | Two or three MACs on one wall jack |
| Old managed switch, password lost | Managed but locked out | Pings fine, login fails, nothing in the vault; console recovery needs a reboot |
| End-of-life gear | Web UI needs old browser or TLS, SSH ciphers too old | Page won't load, SSH negotiation fails |
| Consumer router, mesh or Wi-Fi extender | Client bought it, no MSP access | Rogue DHCP, double NAT, consumer MAC vendor |
| Powerline adapters | Consumer gear on electrical wiring | Drops that match appliance use, odd MAC vendor |
| ISP-owned gateway | Carrier controls it | Changes need a carrier ticket and ISP tech visit |
| Vendor-owned box (camera NVR, HVAC modem, copier router) | Vendor contract | Unknown device with its own WAN or DHCP |
| PoE injectors, splitters, couplers, media converters | Nothing to query | Link up with no power, flapping link, odd cable test |
| Unlabeled patch panel | Passive | No jack-to-port map in docs |

### Maintenance window flow

1. Notice: evidence points to gear that isn't in the docs.
2. Propose a window: the client approves or counters; disruptive work isn't allowed in business hours.
3. Assign: onsite tech (truck roll cost) or client contact on the phone (free, unreliable narrator).
4. Work the window as multiple-choice steps; each choice spends minutes from the window.
5. Close out: ticket note, docs update, optional upgrade quote. Network health goes up.

### Example: unknown switch in the exam wing

1. Port 1/1/22 on MSD-SW01 (10.20.1.2) shows 6 MACs. What next?
   - A. Shut the port now (business-hours outage, rating hit)
   - B. Schedule an after-hours window with an onsite tech (best)
   - C. Ask the client to check the ceiling now (they won't find it)
   - D. Close the ticket (it comes back worse)
2. 7 PM, tech at the closet. How do you find the device?
   - A. Tone the run from port 22 (best)
   - B. Unplug port 22 and wait for complaints (nobody is there after hours)
   - C. Swap the switch port blind
3. Found an 8-port unmanaged switch above the Exam 3 ceiling tile, feeding Exams 3 and 4. What now?
   - A. Label it, photograph it, add it to docs, quote a managed replacement (best)
   - B. Remove it (both exam rooms lose network)
   - C. Leave it as is
4. Pick the ticket note:
   - A. "Found a switch, fixed."
   - B. "Unmanaged 8-port switch above Exam 3 tile, uplinked to MSD-SW01 (10.20.1.2) port 1/1/22. Labeled, photographed, added to docs. Quote sent for managed replacement." (best)
   - C. A paragraph of jargon the client can't follow

Good choices save window minutes and protect the rating. Bad ones cost time, cause outages, or create a repeat ticket.

## Supported vs unsupported equipment

Each MSP has a supported list. Gear off the list still shows up at clients, and the tech's job is to identify it, keep things running where possible, and raise it to sales through dispatch.

| Class | Examples | What the tech does |
| --- | --- | --- |
| Supported | Brands and models on the MSP standard list, current firmware line | Full troubleshooting and changes |
| Supported, end of life soon | Standard brand, model past end-of-sale | Fix the issue, note the lifecycle date, flag for a quote |
| Unsupported | Consumer routers, mesh, extenders, unmanaged switches, end-of-life gear, unknown vendor boxes | Identify, document, best-effort workaround if allowed, raise to sales for replacement |

The sales note is built from three picks: the problem (for example, "unmanaged device, can't be configured for the network's needs"), the replacement (a managed device from the brand the client already runs, or one sized to the client), and the support term (3 or 5 years, covering RMA and vendor support). A mismatched recommendation, like a new brand for no reason or gear far too big for a small office, lowers the chance the quote is accepted.

Clients push back two ways: they want a reason, and they ask whether there's a workaround. The player answers through dispatch with a reason and, where policy allows, a workaround. Policy: unmanaged gear can stay at the edge, but never as a core or access switch. Offering a workaround that breaks that rule fixes today's ticket and seeds a worse one later.

## Replacement job

A replacement is a separate job that follows an accepted quote. Real steps from the interview:

1. Document the old config: what each port does, VLANs, PoE, ISP settings, DHCP, static addresses
2. Power up the new device and update it to matching firmware
3. Same make and model: restore the config; if the ports match, done
4. Different make or model: enter every setting by hand in the new brand's dialect, on the latest stable firmware per release notes
5. Swap and re-patch to the port map
6. Verify every connected device is back online: switches, APs, printers, phones

Scoring rewards a clean port map and verification. Missed rules, wrong VLANs and forgotten static routes surface as follow-up tickets.

Traps: picking beta or bleeding-edge firmware gives an unstable device and follow-up tickets. A cross-brand swap is a translation puzzle between two CLI dialects.

### Cutover-night gotchas

What the generator can leave behind after a swap, from the interview plus common field lessons:

| Gotcha | How it surfaces | Fix |
| --- | --- | --- |
| Wrong subnet mask | Some devices unreachable, odd routing | Correct the mask |
| DNS points at a retired domain server | Names fail after an AD to Entra migration | Update DHCP and static DNS entries |
| ISP gear holds the old firewall MAC | New firewall, no internet | Power cycle the modem or clone the old WAN MAC ([m0n0wall handbook](https://doc.m0n0.ch/handbook/troubleshooting-immediate-replacement.html)) |
| Site-to-site tunnel not rebuilt | One location can't print, the print server is across the tunnel | Rebuild the tunnel at both ends |
| Tunnel, split-tunnel and port forward rules missed | Someone finds out Monday | Rebuild from the documented config |
| Users not told about the new VPN client | Calls asking where the old client went | Dispatch notice before cutover |

Good habits the game should reward: keep the old firewall racked until the new one is proven, so rollback is moving a cable, and treat config nobody misses after cutover as dead weight ([PDQ](https://www.pdq.com/blog/inside-look-how-pdq-switched-firewalls/)).

### Keeping a foothold

Without a VPN or jump box, after-hours work needs a PC left on at the site. Prep: dispatch asks the client to leave machines on, and an RMM script backs up the power settings and sets always-on until the job ends. Restoring them afterward counts toward scoring. Forgetting the prep means no way in at 11 PM.

### Switch swap: rebuilding the port map

How hard a switch swap is depends on what survived:

| Situation | How the player rebuilds it |
| --- | --- |
| Old switch still works | Read its config: VLANs, PoE settings, edge vs infrastructure ports, spanning tree |
| Dead switch, no backup | Inspect neighbors' trunk configs and what crosses them; packet capture on a trunk |
| Long after the fact, or the only switch | Put everything on the default VLAN and watch what devices call out to |

Clues the default-VLAN method turns up: a downstream unmanaged-but-configured switch still sending a tagged VLAN over its uplink, or phones calling a PBX that lives on a different VLAN. Port placement matters too: some switches only have PoE on part of their ports, so powered devices must land on the PoE side, which should be labeled.

Case idea, "Amnesia Switch": the core switch dies with no backup, and the player reconstructs VLANs from neighbors, captures and phone behavior before the morning rush.

## Dead hardware: RMA flow

1. Confirm the device is dead (console, power, remote hands check)
2. Open a vendor case and report the failure; vendor issues an RMA
3. Replacement ships overnight: confirm the delivery contact and address, give shipping details to the client
4. Next day: run the replacement job
5. Return the old unit
6. File expenses: return shipping and onsite mileage

The site is down for about a day. Clients who can't wait must ask for an accommodation; those clients belong on an HA pair, which is a sales conversation, not an on-the-fly fix. Low-budget clients are the exception: no HA, can't wait, and push for a stopgap.

Game hooks: a wrong delivery address delays the RMA a day, and forgetting the return or the expense report shows up as an admin penalty.

## Firmware upgrade job

Upgrades are rarely a disaster. The real drama is the wait after reboot, when the tech can't tell slow from broken. The game should make that wait tense.

### Prep

- Config backup taken
- Firmware pre-downloaded to the jump box or local machine
- Upgrade path checked: several versions behind means stepping through approved versions first
- Release notes read for known issues on this model
- Rollback plan written
- Window booked through dispatch

Skipped prep shows up later. A real example: Fortinet's own GUI auto-upgrade could skip required intermediate versions, risking config loss or boot failure ([Fortinet community](https://community.fortinet.com/fortigate-3/technical-tip-gui-firmware-upgrade-tool-not-following-upgrade-path-on-the-fortigate-known-issue-182299)).

### The wait

1. Reboot starts. A ping timer runs; nothing answers.
2. Each model has a hidden real boot time. Normal, slow and "probably broken" bands overlap on purpose.
3. The player can wait, or act: request console through remote hands, or call it a failure.
4. Acting too early (power cycling mid-upgrade) can corrupt the image. Waiting too long burns the window.
5. If it fails: the backup image may boot on its own. If not, console. Worst case, onsite the next morning, ticket and rating hit.

### Fallout after the upgrade

Known-issue fallout the generator can inject, found by reading release notes:

| Fallout | Clue | Example |
| --- | --- | --- |
| Deprecated feature removed | Remote users can't connect after upgrade | Newer firmware dropped SSL VPN on 2 GB models ([BOLL](https://blog.boll.ch/fortigate-2gb-memory-models-are-slowly-reaching-their-performance-limits/)) |
| Inspection mode changed | Policies behave differently, web filter gaps | Proxy inspection unsupported on 2 GB models, policies must move to flow ([BOLL](https://blog.boll.ch/fortigate-2gb-memory-models-are-slowly-reaching-their-performance-limits/)) |
| Memory conserve mode | New sessions dropped at peak hours | Low-RAM model overloaded by new feature set |
| Session helper change | VoIP one-way audio or registration loss | SIP helper or ALG default changed |
| DNS behavior change | Name lookups fail | DNS over TLS or DNS proxy defaults changed |
| VPN differences | Tunnel up, traffic odd | Proposal or route behavior changed |

## Project tasks

Projects aren't the network admin's main work. Pieces of a project get delegated and arrive as tickets marked as project work. They run like any ticket but build something new instead of fixing something broken:

- Set up an IPsec VPN for remote users
- Enable SSO login with the client's Microsoft 365 tenant on the firewall

These are configuration puzzles with a spec to meet, using the brand's CLI dialect or GUI. Scoring checks the result against the spec and whether anything that already worked broke.

Install and project tasks arrive with a checklist from whoever delegated them. The ticket must show the task, the expected output, what actually happened, and each step taken. Anything permanent, like a new switch, goes into the docs tool as a device record.

### Documentation as enablement

Every doc and KB article the player writes raises support quality for that client and lets tier 1 and 2 handle more on their own. A short guide on allowing a website through a client's web filter means those tickets stop escalating. Documenting the VPN user onboarding steps hands that whole ticket type to tier 1 and 2. Knowing what equipment exists at all is half of it.

In-game, each KB article targets a ticket type. Once written, most tickets of that type stop reaching the player's queue, freeing calendar time for harder work. Thin docs mean a steady flood of easy escalations.

# Part 5: Clients and progression

## Client budgets and security posture

Budget is a core client trait. It sets gear quality, how often quotes get accepted, and difficulty. Clients with deeper pockets fund projects and run better gear. Nonprofits and scrappy clients are the hardest: mixed AP and switch vendors, legacy gear without management access, and fixes done by resetting things with the client onsite.

| Budget tier | Typical gear | Quote acceptance | Difficulty |
| --- | --- | --- | --- |
| Well funded | Standard supported stack, current firmware, documented | High | Low to medium |
| Average SMB | Mostly supported, some aging or unmanaged pieces | Medium | Medium |
| Nonprofit or scrappy | Mixed vendors, consumer and legacy gear, thin docs | Low | High |

Some clients run a firewall with no security turned on. Hardening is a job type: enable UTM, web filtering and DNS filtering. The most common firewall complaint from users is a website blocked by filtering, so that ticket should be frequent in-game, especially right after hardening.

## Contract types

| Trait | Managed client | Break-fix (time and materials) client |
| --- | --- | --- |
| Docs at start | Basic docs from onboarding | Nothing unless the tech adds it |
| Access | RMM agents, VPN, stored credentials | Client grants access per issue, for as long as the issue needs |
| Scope | Fix it properly, follow-ups welcome | Show stoppers only, everything else declined |
| Problems | Fewer | More |
| Grace on slowness and mistakes | More | Less |

Conversion is a progression path: each break-fix success raises the chance that client signs a managed contract, which unlocks docs, agents and easier tickets.

## Progression

Progression is the MSP's book of business, not a skill tree. Each client carries a network health score and a review rating, and both move with how the player handles tickets.

| System | What drives it | What it changes |
| --- | --- | --- |
| Network health per client | Root causes fixed, follow-ups done (remove the injector, label the run, update docs), stale gear replaced | Fewer and harder tickets from that client over time |
| Review rating per ticket | Time to fix vs SLA, repeat issues, outages caused, clear ticket notes | Feeds overall MSP reputation |
| Client churn | Low ratings, repeat outages, missed SLAs | Client cancels; their tickets leave the queue |
| New clients | MSP reputation | New sign-ups, from mom-and-pop shops up to multi-site clients |
| Tech feedback points (CrewHoo, a Crewhu look-alike) | Good client feedback on closed tickets | Points spent in a store on field kit (cable certifier, spectrum analyzer, out-of-band console) and perks |
| Upgrade quotes | Player recommends replacing consumer gear or adding a UPS | Client accepts or refuses based on budget; accepted upgrades raise health |

## Consequences

Each client has a change control trait: formal policy, informal (work freely as long as nothing breaks), or none. Penalties scale with it.

| Mistake | Penalty | Scales with |
| --- | --- | --- |
| Reboot without permission | Heavy | Change control trait; worse if it took down working gear |
| Config change without permission | Heavy | Change control trait |
| Breaking something that worked | Heavy | Outage length, who was affected |
| Ticket sitting untouched | Light | Lower if a status update was sent recently |
| Job taking too long | Light | Lower if the client knows you're working on it |

Network techs get some grace: slowness is forgiven when communication is good, so regular handoff updates protect the rating. Unapproved disruptive actions are what really hurt.

# Part 6: Onsite and generation

## Onsite exploration

Buildings start under fog of war. Floor plans are rare, and even when a client has one, network gear isn't on it.

- Arrival: buzz in, check in at reception or meet the ticket contact, who may escort you
- Explore: rooms reveal as you walk them; closets, ceiling tiles, desks and cabinets need a timed search, where contents reveal one item at a time
- Hazards: locked stairwells and doors, multiple buildings and floors, getting locked out after hours
- Mapping: every discovered room, closet and device location saves to the docs tool and asset inventory
- Payoff: a mapped site lets the player direct remote hands, vendors and clients precisely; an unmapped site means "can you look for a gray box somewhere near the kitchen?"

Client contacts carry a competence trait. A high-competence contact works almost on their own. A low one gets lost, describes the wrong thing, or gives up frustrated, which makes mapping more valuable.

Onsite actions allowed: running cable, terminating jacks and RJ45 ends, trace and tone, cable testing, and working on client-owned gear related to the job. Unannounced reboots are off-limits onsite too, and fall under the change approval rule.

### Field kit

The tool bag mirrors a real network tech's kit. Brand names become parodies in-game.

| Item | In-game use |
| --- | --- |
| Cable tester with remote IDs | Wiremap, length, find which far-end jack a run lands on |
| Toner and probe | Trace an unlabeled run to its port or jack |
| RJ45 crimp tool and RJ45 ends | Re-terminate a bad cable end |
| Punch-down tool (keystone and phone block) | Re-terminate a jack |
| Spare keystones, faceplates, blanks | Replace a damaged jack |
| Patch cords, various lengths | Re-patch, replace a damaged cord |
| Console cables: USB-C, micro USB, standard rollover, firewall-vendor console cable | Each brand needs the right one; the wrong cable means no console |
| Laptop | Terminal, console sessions, docs |
| Precision screwdriver set | Open small devices, swap a PSU or SFP |
| Label maker | Close-out labeling |
| Utility knife, zip ties | Cable work and tidy-up |

The bag has limited space and restocks between visits, so forgetting the right console cable or running out of keystones is a real failure.

## Procedural generation

Every client is generated from a seed, like a Minecraft world. The same seed rebuilds the same client, so saves only need the seed plus what changed.

1. Client profile: industry, headcount, budget tier, hidden business hours, contacts with competence, patience and availability
2. Site: buildings, floors, stairwells; rooms subdivided from each floor footprint; room types by industry (exam rooms, warehouse bays, classrooms); room names and numbers; locked doors; bathrooms and break rooms
3. Network spaces: main closet, closets per floor, ceiling runs, desk drops per room, AP positions
4. Gear: devices per budget tier, brands from the parody roster, firmware versions, plus hidden unmanaged gear
5. Faults: pick cases from spec/03-case-files.md whose requirements fit this network (The Phantom Short needs a desk phone, an injector and a GFCI circuit), then plant the clues
6. Docs: write what the MSP knows, then degrade it by staleness (missing floor plan, wrong IPs, missing creds)
7. Validate: confirm at least one access path reaches every clue, so each case is solvable

Everything is data: device templates, room templates, fault definitions with requirements and clues, and dialect files. Generators assemble those pieces, so adding a brand, room type or case means adding data, not code.

# Part 7: Industry practices

## Industry practices worth simulating

These come from common MSP practice rather than the interview. All were reviewed with the interviewee and kept.

| Practice | What it is | Game mechanic |
| --- | --- | --- |
| Incident vs problem | Incidents restore service; problem management finds the root cause behind repeat incidents ([ConnectWise](https://connectwise.com/blog/operational-maturity/incident-vs-problem-management)) | Third similar incident at a client spawns a problem ticket; solving it raises network health more than any single fix |
| Post-incident summary | After a P1: timeline, cause, prevention | Short multiple-choice write-up after each P1; feeds the quarterly review |
| Lifecycle tracking | Quarterly review of end-of-life, end-of-support and warranty dates, with replacements scheduled before deadlines and explained in plain language for budget approval ([NinjaOne](https://www.ninjaone.com/blog/it-lifecycle-management-quarterly-planning/)) | Lifecycle tracker feeds sales handoffs; gear that dies out of support has no RMA and costs far more |
| Quarterly network review | Scheduled health check of each managed client's network | Recurring audit job, detailed below |
| Offboarding | Block sign-in, revoke MFA methods, remove group memberships ([Augmentt](https://www.augmentt.com/blog/the-offboarding-playbook-for-msps/)); for network: disable VPN account, rotate shared Wi-Fi keys they knew | From the interview: tier 1 and 2 handle separation tickets, and VPN access is the only network piece. Mostly background; reaches the network admin only when VPN removal needs help, or as a security ticket if it was missed |
| Expiry calendar | Certificates, firewall subscriptions, support contracts, domains | Proactive tickets before expiry; anything that expires becomes an outage, like the expired VPN certificate |
| Seasonal freezes | Accounting firms freeze around tax season, retail around holidays, finance at month-end; schools do projects in summer | From the interview: back-to-school is busy, the Christmas stretch is quiet, and tax season is busy for accounting offices. Each industry gets a yearly activity curve that sets ticket volume and freeze periods; changes during a freeze cost heavily |
| Maintenance notice | Clients get advance notice of planned work; emergency security fixes may skip it | Dispatch sends notice when a window is booked; a CVE sweep can use a shortened notice |
| Scheduled config backups | Monitoring tools back up device configs on a schedule | Backups are an evidence source for rebuilds; clients with backups turned off make switch swaps harder |

### Quarterly network review job

An overall look at a managed client's network. From the interview, the reviewer checks:

- Licensing and support status of every device
- Devices offline
- Configuration issues
- Security risks, like CVEs against the current firmware versions
- Loops
- Speed and negotiation problems on trunks
- Glaring mistakes, like a guest network on VLAN 1 alongside the corporate network
- Critical firmware updates needed; minor updates are skipped unless needed
- Docs: update them and add anything missing, like switches and APs

In-game it's an audit puzzle. The generator plants findings of mixed severity plus harmless noise. The player flags each finding and rates it. Critical findings become tickets or sales quotes. A missed critical finding turns into a real incident later. Flagging minor firmware as critical wastes the client's time and costs a little credibility.

# Reference

## Status

As of Oct 17, 2026: the workflow interview is complete, every proposed item was reviewed and kept, and first-slice picks are set in spec/03-case-files.md. Framework and save format are for Claude Code to propose in Phase 0.

## Sources

- [Flamingo: MSP stack audit](https://flamingo.run/blog/msp-stack-audit)
- [Expert Insights: best MSP platforms 2026](https://expertinsights.com/it-management/best-msp-platforms-for-business)
- [Domotz: best RMM tools 2026](https://blog.domotz.com/all/best-rmm-for-msp/)
- [MRFR: network security firewall market](https://www.marketresearchfuture.com/de/reports/network-security-firewall-market-32748)
- [QKS: network firewall forecast 2026 to 2030](https://qksgroup.com/market-research/market-forecast-network-firewalls-2026-2030-worldwide-2754)
- [HPE: pause flood protection](https://hpe.com/psnow/resources/ebooks/a00115977en_us_v4/s_logical-switches-pauseflood-about.html)
- [Dell community: network brought down by crashed PC](https://www.dell.com/community/Networking-General/network-brought-down-by-crashed-pc/td-p/5120068)
- [virtualizationhowto: Proxmox networking for vSphere admins](https://virtualizationhowto.com/2023/12/proxmox-networking-for-vmware-vsphere-admins)
- [Proxmox forum: nested hypervisor networking](https://forum.proxmox.com/threads/nested-hypervisor-networking-issues-no-traffic-passing.144035/)

The fault catalog beyond the cited rows comes from standard field practice and is not tied to a single source.
