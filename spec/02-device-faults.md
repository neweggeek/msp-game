# Device fault catalog

Every device type an MSP tech touches, with its most common real faults. The firewall is split by subsystem because each part (routing, NAT, policy, VPN, shaping, inspection) breaks in its own ways. A ★ marks a strong candidate for the first playable slice; the case files (03-case-files.md) chain these into detective mysteries.

## Edge and WAN

### ISP modem, ONT and ISP gateway

| Fault | Clue the player sees | What proves it | Pick |
| --- | --- | --- | --- |
| ISP gateway not in bridge mode | VPN and VoIP flaky, port forwards fail | Firewall WAN IP is private (192.168.x or 10.x) | ★ |
| ISP gateway reset after outage or firmware push | Site was fine for years, suddenly no inbound | Bridge mode off, static block unassigned on gateway | ★ |
| Fiber cut or ISP outage | Whole site down | ONT LOS light red, carrier status page | ★ |
| Cable modem noise | Drops several times a day, slow uploads | Modem log shows T3/T4 timeouts, upstream power out of range | |
| Static IP block wrong from ISP letter | New firewall has no internet | Gateway not inside configured subnet | |
| Stale ARP at ISP after firewall swap | New firewall up, no internet for hours | ISP gateway holds old firewall MAC | |
| ISP DNS outage | Names fail, IPs work | Lookups to ISP resolvers time out | |
| ISP blocks ports on business-lite plan | Mail server or web server unreachable | Inbound 25 or 443 blocked upstream | |
| Modem overheating or failing power brick | Reboots in the afternoon | Modem uptime resets, warm location | |

### LTE and 5G failover router

| Fault | Clue the player sees | What proves it | Pick |
| --- | --- | --- | --- |
| Failover health check pings the modem, not the internet | Primary ISP dies, site stays down | Health check target is the local modem IP | ★ |
| Data cap blown | Failover "worked" then went dead mid-month | Cloud backup and updates ran over LTE | ★ |
| SIM plan suspended | Failover link up, no traffic | Carrier portal shows suspended line | |
| CGNAT on cellular | Site-to-site and port forwards fail on failover | WAN IP in 100.64.0.0/10 | |
| Weak signal in basement closet | Failover slow and unstable | Poor RSRP and SINR, antenna inside rack | |
| Wrong APN after carrier change | Modem registers, no data session | APN mismatch in config | |
| Flapping between WANs | Calls drop every few minutes | SLA thresholds too tight, failback loop | |

## Firewall, by subsystem

SMB firewall trouble clusters around defaults left in place, stale firmware, overly broad VPN or port forward access, and nobody watching the logs ([Integrity360](https://insights.integrity360.com/top-sme-firewall-mistakes-how-to-fix-them)). In-game, each subsystem is its own config page or CLI section, so the player has to know where to look.

### Interfaces and WAN

| Fault | Clue the player sees | What proves it | Pick |
| --- | --- | --- | --- |
| WAN set to DHCP, ISP gave static (or reverse) | No internet after ISP change | WAN has no address or wrong one | |
| Fiber ISP needs VLAN-tagged WAN | New circuit lights up, no DHCP | ISP docs require tag, WAN untagged | ★ |
| PPPoE password changed or MTU left at 1500 | DSL site down, or pages half load | PPPoE auth fail, or large packets dropped | |
| Port moved to wrong zone or role | Server VLAN suddenly treated as WAN | Interface role changed in last config diff | |
| Speed or duplex mismatch with modem | Slow WAN, errors on WAN port | Interface counters, hard-set speed one side | |

### Routing

| Fault | Clue the player sees | What proves it | Pick |
| --- | --- | --- | --- |
| Missing static route to subnet behind core switch | New VLAN has LAN access but no internet | Return route absent on firewall | ★ |
| Asymmetric routing with L3 core | TCP fails, ping works | Session drops, traffic exits a different path | ★ |
| Route-based VPN missing static route | Tunnel up, no traffic | No route pointing at tunnel interface | ★ |
| Policy route overrides routing table | One app goes out the wrong WAN | Policy route list order | |
| More-specific route steals traffic | Remote subnet unreachable after change | Overlapping /24 inside a /16 route | |
| Default route priority wrong on dual WAN | Traffic black-holed when WAN2 link is up but dead | Equal distance, wrong priority | |

### NAT and port forwards

| Fault | Clue the player sees | What proves it | Pick |
| --- | --- | --- | --- |
| Port forward points to old server IP | Remote access to camera NVR or app broken after server swap | VIP mapped IP vs current IP plan | ★ |
| Outbound NAT missing for new subnet | New VLAN has no internet | NAT off on that policy | ★ |
| Mail server sends from wrong public IP | Outbound mail lands in spam or bounces | SNAT pool vs SPF record and PTR | ★ |
| Hairpin NAT missing | Inside users can't reach public hostname | Works from outside only | |
| NAT enabled on VPN policy | Site-to-site sees firewall IP, not users | Translated source in session table | |

### Security policy

| Fault | Clue the player sees | What proves it | Pick |
| --- | --- | --- | --- |
| Rule order: broad deny above new allow | "I added the rule and it does nothing" | Hit counts on the deny, zero on the allow | ★ |
| Schedule object on a rule | Backups fail every night, fine all day | Rule tied to business-hours schedule | ★ |
| Address group missing new host | One new PC can't reach the server | Object group membership | |
| Service object wrong port | Vendor app blocked | Port in object vs vendor docs | |
| Geo-IP block hits a cloud vendor | One SaaS fails after vendor moves region | Deny log shows geo match | |
| Implicit deny with logging off | Silent drops, nothing in logs | Logging disabled on implicit rule | |
| Inter-VLAN policy missing | Printer VLAN unreachable from staff | No rule between zones | |

### IPsec site-to-site VPN

| Fault | Clue the player sees | What proves it | Pick |
| --- | --- | --- | --- |
| Phase 1 mismatch | Tunnel never comes up | IKE log: no proposal chosen, PSK or peer ID mismatch | ★ |
| Phase 2 selector mismatch | Tunnel up, no traffic | Proxy IDs differ between sides | ★ |
| Branch WAN IP changed | Tunnel dead after ISP work at branch | Remote gateway IP stale, no DDNS | ★ |
| Lifetime mismatch | Drops at rekey, roughly hourly | Lifetimes differ each side | |
| MTU over tunnel | Small traffic fine, file copies stall | Large DF pings fail through tunnel | |
| Policy missing one direction | One side can reach, other can't | Only outbound policy exists | |

### Remote access VPN

| Fault | Clue the player sees | What proves it | Pick |
| --- | --- | --- | --- |
| Home LAN overlaps office LAN | One remote user can't reach anything | Both are 192.168.1.0/24 | ★ |
| Client too old for firmware | Everyone fails after firmware upgrade | Compatibility table in vendor KB | ★ |
| Certificate expired | All users get cert error | Cert expiry date | |
| LDAP bind account password expired | All users fail at once | Bind failure in auth log | ★ |
| Split tunnel missing new subnet | VPN works except new file server | Subnet absent from split list | |
| DNS suffix not pushed | Connects, names fail | Client resolves via home DNS | |
| MFA codes rejected | Some users fail, others fine | Firewall clock drift | |

### Traffic shaping and QoS

| Fault | Clue the player sees | What proves it | Pick |
| --- | --- | --- | --- |
| Shaper unit typo | Whole site capped at 10 Mbps | 10000 kbps entered where Mbps meant | ★ |
| Voice not prioritized | Choppy calls at lunch | No QoS or DSCP not honored | ★ |
| Shaper left at old circuit speed | ISP upgrade "did nothing" | Shaper below new circuit rate | |
| Per-IP shaper on server | Server slow for everyone | Per-IP limit applied to server object | |

### UTM and inspection

| Fault | Clue the player sees | What proves it | Pick |
| --- | --- | --- | --- |
| Web filter miscategorizes vendor site | One portal blocked | Filter log, category block | ★ |
| SSL deep inspection breaks app | Cloud app fails at office only | Untrusted CA or pinned cert | ★ |
| IPS false positive after signature update | App breaks overnight with no change | IPS log drops matching app traffic | |
| AV proxy times out large downloads | Big downloads stall at 99% | Proxy-mode AV buffering | |
| App control blocks meetings app | Video calls fail | App control category | |

### HA cluster

| Fault | Clue the player sees | What proves it | Pick |
| --- | --- | --- | --- |
| Heartbeat cable unplugged, split brain | Random outages, both units active | Both members claim primary | ★ |
| Firmware or config mismatch | Members out of sync | Cluster status, checksum mismatch | |
| Monitored link flaps | Failover loop | HA log shows repeated failovers | |
| Virtual MAC and ISP ARP | Failover works but internet drops | ISP holds old MAC | |

### DHCP and DNS on the firewall

| Fault | Clue the player sees | What proves it | Pick |
| --- | --- | --- | --- |
| Two DHCP servers (firewall and Windows server) | Random clients get wrong DNS | Leases from two server IPs | ★ |
| Scope exhausted | New devices get 169.254 | Lease table full | ★ |
| Static device inside the dynamic range | Intermittent IP conflict | ARP shows two MACs | |
| Wrong DNS servers handed out | Internal names fail | DHCP DNS option is public | |

### SD-WAN and multi-WAN

| Fault | Clue the player sees | What proves it | Pick |
| --- | --- | --- | --- |
| Health check target unreachable by design | Firewall thinks WAN1 is dead, all traffic on LTE | Target blocks ICMP | ★ |
| SLA too strict | Constant WAN flapping | Jitter threshold below normal | |
| Rule order sends voice over LTE | Calls choppy, data fine | SD-WAN rule order | |
| Sessions stick after failover | Some apps stay dead after WAN recovers | Old sessions pinned to failed link | |

### Admin, firmware and licensing

| Fault | Clue the player sees | What proves it | Pick |
| --- | --- | --- | --- |
| Trusted hosts exclude MSP IP | Locked out of a remote firewall | Admin access restricted to old office IP | ★ |
| Memory conserve mode | New sessions dropped, existing fine | High memory, conserve mode in logs | ★ |
| License expired | Web filter, AV or cloud management stops | License status page | ★ |
| Firmware upgrade changes a default | Things break after patch night | Release notes: feature removed or default changed | ★ |
| Previous tech's undocumented change | Problem began on a specific date | Config revision diff | ★ |
| Local-in policy blocks monitoring | Monitor shows firewall down, users fine | SNMP blocked to MSP collector | |

## Switching and cabling

### Managed switch

| Fault | Clue the player sees | What proves it | Pick |
| --- | --- | --- | --- |
| Switching loop | Whole site down or crawling | Broadcast storm, MAC flapping, topology changes climbing | ★ |
| VLAN missing from trunk | New VLAN works on one switch only | Trunk allowed list, VLAN not created downstream | ★ |
| Config never saved | Everything broke after a power blip | Running config differs from startup | ★ |
| Port err-disabled | User port dead after they plugged something in | BPDU guard or port security violation | ★ |
| Management IP or gateway wrong | Switch works but MSP can't reach it remotely | No default gateway on management VLAN | ★ |
| Pause frame flood | Network crawls, switch unresponsive | Rx pause counters climbing on one port | ★ |
| Desk switch wins STP root | Uplinks blocking, odd paths | Root bridge is not the core | |
| LACP mismatch | Half the uplinks suspended | LAG member state individual or suspended | |
| Native VLAN mismatch | Traffic leaks between VLANs | CDP or LLDP mismatch warning | |
| Firmware memory leak | Switch slows and needs weekly reboot | Uptime and memory trend, known bug in release notes | |

### PoE switch

Most VoIP and AP power problems trace to a dead or misconfigured port, bad cabling to the jack, or a switch whose total draw exceeds its budget ([VoIP.ms](https://wiki.voip.ms/article/Troubleshoot_PoE_Issues_in_VoIP)).

| Fault | Clue the player sees | What proves it | Pick |
| --- | --- | --- | --- |
| Budget exceeded | APs, phones or cameras reboot or never power | Budget nearly used, last ports denied | ★ |
| One PSU failed, budget halved | Half the phones dark after a weekend | PSU alarm, budget dropped | ★ |
| Class too low for AP | AP up, radios off or reduced | AP log says low-power mode | ★ |
| PoE disabled on port | New phone gets data light, no power | Port PoE admin off | |
| Priority all low | Wrong devices lose power first | Priority table | |
| Passive 24V device on 802.3af port | Old radio or camera never powers | Device needs passive injector | |

### Unmanaged desk switch

| Fault | Clue the player sees | What proves it | Pick |
| --- | --- | --- | --- |
| Both ends of a cable plugged into it | Site-wide outage at 9 AM | Loop traced to an office desk switch | ★ |
| Sits in the middle of a trunk | Phones behind it land on data VLAN | Tags stripped by consumer switch | ★ |
| Dying power brick | Desk cluster drops randomly | Brick warm, switch reboots | |
| 100 Mb switch on gig run | Group of users slow | Uplink negotiates 100 Mb | |

### SFP, fiber and DAC

| Fault | Clue the player sees | What proves it | Pick |
| --- | --- | --- | --- |
| Unsupported third-party optic | Uplink down after reboot | Log: unsupported transceiver, port err-disabled | ★ |
| 1G optic in 10G port | New building link won't come up | Port needs manual speed setting | ★ |
| Wrong optic type | Fiber link dark | SR optic on single-mode run | |
| Dirty connector or Tx/Rx swapped | Link down or erroring | DOM Rx power low or absent | |
| Kinked fiber in tray | Errors after someone moved the rack | Rx power marginal | |
| DAC incompatible | Stack or uplink won't link | Vendor compatibility list | |

### Cabling, patch panels and wall jacks

| Fault | Clue the player sees | What proves it | Pick |
| --- | --- | --- | --- |
| Damaged cable or bad termination | Gig device links at 100 Mb, errors | Cable test shows open pair | ★ |
| Mislabeled jack or patch | "Plugged in" device is somewhere else | MAC learned on unexpected port | ★ |
| Cable crushed by chair or door | One desk drops when someone sits down | Errors correlate with movement | ★ |
| Run over 100 m | Errors under load | Cable certifier length fail | |
| Split pairs | Crosstalk errors, slow | Certifier crosstalk fail | |
| Contractor cut a run | Room dead after renovation | Toner finds open, ceiling work | |
| Water or rodent damage | Intermittent in one wing | Visible damage in ceiling | |

### Media converters and extenders

| Fault | Clue the player sees | What proves it | Pick |
| --- | --- | --- | --- |
| Power brick dead | Outbuilding offline | Converter LEDs dark | ★ |
| Link pass-through off | Switch shows link up, nothing passes | Copper side up while fiber side is down | |
| Speed mismatch | Link up, heavy errors | Fixed 100 Mb converter on auto gig port | |

## Wireless

Office Wi-Fi trouble usually comes from APs mounted in hallways or packed too close, interference from neighbors and microwaves, untested auto channel plans, and growth outpacing the original design ([NinjaOne](https://www.ninjaone.com/blog/common-wi-fi-pitfalls-that-cause-connectivity-problems/)).

### Access points

| Fault | Clue the player sees | What proves it | Pick |
| --- | --- | --- | --- |
| Not enough PoE | AP reboots or runs one radio | Low-power mode in AP log, class 4 on af port | ★ |
| SSID mapped to wrong VLAN | Staff on guest subnet | SSID VLAN vs docs | ★ |
| Uplink lost, AP falls back to mesh | One AP slow, wired link down | AP shows wireless uplink, cable test on its run | ★ |
| Conference room client limit | Wi-Fi dies only during big meetings | Max clients reached on one AP | ★ |
| Co-channel interference | Slow everywhere, high retries | APs too close on same channel | ★ |
| WPA3-only or 802.11r breaks old devices | Scanners and old laptops can't join | Association failures by device type | |
| DFS radar events | Brief drops, channel changes | DFS event log | |
| Hallway or ceiling-tile-above-metal placement | Coverage holes in offices | Low RSSI where users sit | |
| Sticky clients | Laptops cling to far AP | No minimum RSSI or roaming assist | |
| AP factory reset after power event | Broadcasts default SSID | AP unadopted, default config | |

### Controllers and cloud dashboards

| Fault | Clue the player sees | What proves it | Pick |
| --- | --- | --- | --- |
| New APs never adopt | APs blink, never show in controller | DHCP option 43 or DNS record missing | ★ |
| Self-hosted controller VM down | Guest portal dead, everything else fine | Controller host offline or service crashed | ★ |
| Controller upgrade breaks old APs | Older APs disconnected after update | Model dropped from supported list | |
| Controller certificate expired | APs disconnect, admin page warns | Cert expiry | |
| Cloud subscription lapsed | Dashboard read-only, can't change anything | License status | |

### Guest and captive portal

| Fault | Clue the player sees | What proves it | Pick |
| --- | --- | --- | --- |
| Guest scope exhausted | Guests get 169.254 by noon | Long lease, small scope | ★ |
| Portal redirect loop | Guests stuck on splash page | Portal host not in walled garden | |
| Guest policy blocks internet | Guests connect, no browsing | Policy denies guest to WAN | |

### Point-to-point bridges

| Fault | Clue the player sees | What proves it | Pick |
| --- | --- | --- | --- |
| Trees grew into the path | Barn link degrades every summer | Signal history drops seasonally | ★ |
| Radio floods pause frames | Main switch crawls when bridge acts up | Rx pause counters on bridge port | ★ |
| Dish knocked out of alignment | Link dropped after storm | Signal far below baseline | |
| Neighbor on same frequency | Throughput collapses at certain hours | Noise floor up, spectrum scan | |
| Surge from lightning | Bridge dead and switch port damaged | Port and radio both fail tests | |

### Consumer mesh and ISP Wi-Fi

| Fault | Clue the player sees | What proves it | Pick |
| --- | --- | --- | --- |
| Mesh system creates double NAT | Mom-and-pop shop VPN and printing flaky | Mesh in router mode behind firewall | ★ |
| ISP gateway Wi-Fi left on | Business APs suffer interference | Extra SSID on same channel from ISP box | |
| Mesh node backhaul too weak | Back office slow | Node link rate low | |

## Power and environment

Power faults are the best detective material: remote tools only show a device as "down" or "rebooting", and the real cause lives in the building. Batteries are the leading cause of UPS failure, followed by aging capacitors, fans, power supplies and loose connections ([UPS Solutions](https://upssolutions.com.au/blogs/ups-solutions-blog/the-5-most-leading-causes-of-ups-failure)).

### Outlets, GFCI and breakers

| Fault | Clue the player sees | What proves it | Pick |
| --- | --- | --- | --- |
| GFCI tripped upstream | Device on an outlet that "has power" is dead | Reset button popped on a GFCI elsewhere on the circuit | ★ |
| Outlet controlled by a light switch | Device dies every night, back every morning | Outage times match lights off | ★ |
| Shared breaker with space heater or microwave | Closet drops when it's cold or at lunch | Breaker trips, outage times match | ★ |
| Cleaning crew unplugs device | Outage every Tuesday at 7 PM | Same weekday and hour, device was unplugged | ★ |
| Power strip switched off by foot | Desk cluster dark | Strip switch off under desk | |
| Daisy-chained power strips | Random brownout reboots | Overloaded strip, warm plugs | |

### UPS

| Fault | Clue the player sees | What proves it | Pick |
| --- | --- | --- | --- |
| Battery dead, fails on first blip | Short power flicker took the whole closet down | UPS self-test fail, battery date years old | ★ |
| Gear on surge-only outlets | UPS fine, closet still lost power | Plugs in surge row, not battery row | ★ |
| Overloaded UPS | Beeping, shuts off under load | Load over 100% after new gear added | |
| Self-test drops the load | Closet reboots once a week | Self-test schedule matches outages | |
| Stuck in bypass | No protection, no alarm | UPS status bypass | |
| Network card IP conflict | UPS shows offline, devices conflict | UPS management card took a used IP | |

### PoE injectors, splitters and adapters

| Fault | Clue the player sees | What proves it | Pick |
| --- | --- | --- | --- |
| Injector plugged into a dead outlet | AP down, switch port shows link but no PoE | Injector LED off, outlet dead upstream | ★ |
| Injector hidden behind a desk phone | AP down, cable test looks odd | AP fed through phone PC port and an injector | ★ |
| Passive injector on 802.3af device (or reverse) | Device never powers or gets damaged | Injector type vs device spec | |
| Splitter wrong voltage | Camera reboots at night when IR turns on | Splitter rated below device draw | |

### Closet environment

| Fault | Clue the player sees | What proves it | Pick |
| --- | --- | --- | --- |
| Closet overheats | Random reboots on weekends | Building AC off weekends, door shut | ★ |
| Fan clogged with dust | One device reboots in afternoons | Fan alarm, temp sensor high | |
| Water leak above rack | Multiple devices fail after rain | Water marks, wet ceiling tile | |
| Closet used as storage | Equipment unplugged or blocked | Boxes against rack, cables pulled | |

## Servers and virtualization, network side

### DHCP, DNS and domain controller

| Fault | Clue the player sees | What proves it | Pick |
| --- | --- | --- | --- |
| DHCP service stopped after patching | New devices get 169.254, old ones fine until lease ends | Service stopped, last patch reboot | ★ |
| Server time skew | Logins fail, VPN MFA rejects codes | Server clock minutes off, NTP source dead | ★ |
| DNS forwarders point at an old ISP | Slow or failed internet lookups | Forwarder timeouts | |
| Stale DNS record | Name points to retired server | Record vs IP plan | |
| Missing conditional forwarder | Branch can't resolve HQ names | No forwarder for partner zone | |

### Hypervisor networking

| Fault | Clue the player sees | What proves it | Pick |
| --- | --- | --- | --- |
| Port group on wrong VLAN | One VM offline after rebuild | Port group VLAN vs docs | ★ |
| Host uplink trunk missing a VLAN | VMs fine on host A, dead after moving to host B | Switch trunk differs between host ports | ★ |
| vNIC left disconnected | VM up, no network after migration | vNIC connected checkbox off | |
| Teaming mode vs switch mismatch | VM MAC flapping, intermittent | IP-hash teaming without switch LAG | |
| Virtual firewall drops everything | Firewall VM passes nothing | Forged transmits or MAC changes blocked | |
| Bridge not VLAN-aware | Tagged VMs on host get nothing | Bridge config lacks VLAN aware | |

### NAS and storage network

| Fault | Clue the player sees | What proves it | Pick |
| --- | --- | --- | --- |
| NAS on DHCP changed address | Mapped drives and scan-to-folder fail | NAS IP differs from docs and shortcuts | ★ |
| Jumbo frames on one side only | iSCSI disconnects, small pings fine | Large DF pings fail | |
| SMB1 turned off | Old copier can't scan to folder | Copier only speaks SMB1 | |
| Backups saturate shared link | Everything slow at 10 AM | Backup job schedule matches slowdown | |

## Endpoints that break networks

### VoIP desk phones

| Fault | Clue the player sees | What proves it | Pick |
| --- | --- | --- | --- |
| PC behind phone stuck at 100 Mb | One user's file transfers are slow | Phone's PC port is 10/100 | ★ |
| Phone PC port patched to another wall jack | Loop when someone "tidies" cables | Loop traced to a phone | ★ |
| Voice VLAN or LLDP-MED missing | Phones boot on data VLAN, no dial tone | Phone IP from data scope | ★ |
| SIP ALG on | One-way audio, phones unregister | ALG enabled, NAT rewrite in capture | ★ |
| Provisioning option 66 wrong | Phones boot with no config | Phones request wrong TFTP or HTTP server | |
| NAT timeout shorter than registration | Inbound calls fail after idle | UDP session ages out before re-register | |
| Phone hidden in a PoE chain | Downstream device dies when phone is unplugged | Physical inspection of desk | |

### IP cameras and NVR

| Fault | Clue the player sees | What proves it | Pick |
| --- | --- | --- | --- |
| New cameras eat the PoE budget | APs and phones reboot after install day | Budget used, camera ports undocumented | ★ |
| Every camera ships on the same default IP | Cameras vanish one by one as installer plugs them in | Duplicate IP, same vendor default | ★ |
| NVR DHCP server enabled | Random PCs get odd addresses | Offers from NVR MAC | ★ |
| Multicast flood | Whole VLAN slow when cameras stream | No IGMP snooping | |
| NVR saturates uplink | Slow internet when someone views cameras remotely | Port forward to NVR, upload maxed | |

### Printers and copiers

| Fault | Clue the player sees | What proves it | Pick |
| --- | --- | --- | --- |
| Scan-to-email breaks after mail provider change | Copier says "send failed" | SMTP auth or TLS rejected | ★ |
| Printer on DHCP changed address | "Printer offline" for everyone on Monday | Printer IP vs print server port | ★ |
| Discovery fails across VLANs | Users can't find printer after VLAN split | mDNS or WSD doesn't cross subnets | |
| Wi-Fi Direct left on | Extra network causes interference | Printer broadcasting its own SSID | |

### POS and card readers

| Fault | Clue the player sees | What proves it | Pick |
| --- | --- | --- | --- |
| New firewall policy blocks processor | Cards decline as "communication error" | Deny log on processor port or host | ★ |
| DNS filter blocks processor domain | Some transactions fail | DNS filter log | |
| Static IP conflict on terminal | Terminal drops randomly | ARP shows two MACs | |
| Processor changes IP list | Allow-list rule now stale | Vendor notice, deny log | |

### Building systems: HVAC, BACnet, door access

| Fault | Clue the player sees | What proves it | Pick |
| --- | --- | --- | --- |
| BACnet broadcast doesn't cross subnets | Building controller loses some devices after re-IP | No BBMD on remote subnet | ★ |
| Vendor's own cellular modem in the closet | Mystery device with internet bypassing firewall | Unknown MAC, own WAN | |
| Controller static IP conflicts with DHCP | HVAC or door access drops randomly | Static inside dynamic range | |

### Workstations and docks

| Fault | Clue the player sees | What proves it | Pick |
| --- | --- | --- | --- |
| USB-C dock NIC floods pause frames | Floor crawls when a laptop docks | Rx pause counters on that port | ★ |
| Leftover static IP from another site | One laptop has no network at office | Static set on NIC | |
| Hyper-V or VM bridge on laptop | MAC flapping on a desk port | Multiple MACs on one access port | |
| NIC power saving | Wired PC drops when idle | NIC sleep setting | |

### Conference rooms, AV and smart TVs

| Fault | Clue the player sees | What proves it | Pick |
| --- | --- | --- | --- |
| Screen casting fails after VLAN split | Can't find the TV from laptops | mDNS doesn't cross VLANs | ★ |
| AV-over-IP multicast | Network slow when the boardroom display is on | Multicast flood without snooping | |
| Room system Wi-Fi hotspot | Interference near boardroom | TV broadcasting its own SSID | |

### Consumer devices brought from home

| Fault | Clue the player sees | What proves it | Pick |
| --- | --- | --- | --- |
| Home router plugged into a wall jack | Clients get 192.168.0.x | Rogue DHCP from consumer MAC | ★ |
| Personal streaming box on corporate VLAN | Unknown device eats bandwidth | MAC vendor lookup, top talker | |

## Management, monitoring and MSP tooling

These faults don't break the client network. They break the tech's view of it, which makes them good red herrings and good access puzzles.

| Device or tool | Fault | Clue the player sees | What proves it | Pick |
| --- | --- | --- | --- | --- |
| Monitoring probe | Probe PC asleep or rebooted | Every device at a site shows down, client says all fine | Probe host offline, nothing else changed | ★ |
| Monitoring | SNMP community or v3 creds changed | One device "down" for days, users fine | SNMP timeout only, ping fine | ★ |
| RMM agent | Host powered off or sleeping | Can't get in, so player reaches for VPN or remote hands | Agent last check-in time | ★ |
| RMM agent | Agent installed on wrong client in RMM | Script runs against the wrong company | Site name mismatch | |
| Docs vault | Password rotated, never recorded | Login fails with "correct" creds | Doc edit date older than change | ★ |
| Docs vault | MFA tied to departed tech's phone | Can't log into cloud controller | MFA owner in account settings | ★ |
| Cloud controller | Org access lost after staff change | Client admin left, nobody owns the org | Org admin list | |
| Cloud controller | Vendor cloud outage | Can't manage, but network still works | Vendor status page | |
| Vendor KB | Release notes reveal a known bug | Symptom matches a listed issue for that build | Firmware version vs known issues | ★ |

## Totals

217 faults across 45 device types and firewall subsystems. 95 carry a ★ as candidates; the first slice should use 15 to 20 of them, picked through the case files. The case files chain several faults into single mysteries, which is where the detective feel comes from.
