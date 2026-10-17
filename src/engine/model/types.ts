export type Tier = "low" | "mid" | "high";
export const DEVICE_KINDS = [
  "firewall",
  "switch",
  "ap",
  "phone",
  "camera",
  "pc",
  "server",
  "nvr",
] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];
export type Priority = "P1" | "P2" | "P3" | "P4";
export type PoePriority = "low" | "high" | "critical";
export type Staleness = "fresh" | "partly" | "stale";
export type Origin = "client" | "alert" | "tech";
/** "docs", "monitoring", "rmm", "hands", "isp", or "ssh:<role>" / "rmm:<role>" for one bound device. */
export type AccessToken = string;

export interface Contact {
  id: string;
  name: string;
  role: string;
  phone: string;
  competence: number; // 0 to 1
  patience: number; // 0 to 1
  availability: "usually" | "sometimes" | "rarely";
}

export interface ClientProfile {
  id: string;
  name: string;
  code: string;
  domain: string;
  industry: string;
  tier: Tier;
  headcount: number;
  managed: boolean;
  /** Hidden from the player. Minutes from midnight. */
  businessHours: { start: number; end: number };
  afterHoursWindow: { label: string; start: number; end: number };
  contactPreference: "quick-call-ok" | "scheduled-only";
  staleness: Staleness;
  contacts: Contact[];
  staff: string[];
}

export interface Room {
  id: string;
  name: string;
  type: string;
  building: string;
  floor: number;
  locked: boolean;
  networkCloset: boolean;
}

export interface Vlan {
  id: number;
  name: string;
  subnet: string;
  gateway: string;
  role: "data" | "voice" | "mgmt";
}

export interface Isp {
  name: string;
  circuitId: string;
  wanIp: string;
  wanCidr: string;
  gateway: string;
  phone: string;
  /** The ISP's support line asks for both before it talks about the account. */
  account: string;
  pin: string;
  /** The ISP's side is down: a modem stuck after a provisioning push, for example. */
  outage?: { since: number; until?: number };
  /** The ISP rebooted the modem from their end. Down until then. */
  rebootUntil?: number;
}

export interface Site {
  id: string; // "hq" or "branch"
  name: string;
  address: string;
  octet: number;
  buildings: { id: string; name: string; floors: number }[];
  rooms: Room[];
  vlans: Vlan[];
  isp: Isp;
}

export interface PortRef {
  device: string;
  port: string;
}

export interface Port {
  name: string;
  role: "wan" | "lan" | "uplink" | "access";
  mode: "access" | "trunk" | "routed";
  vlan?: number;
  shutdown?: boolean;
  description?: string;
  poeCapable: boolean;
  poeEnabled: boolean;
  poePriority: PoePriority;
  link?: PortRef;
}

export type ConfigValue = string | number | boolean | string[];
export type Fields = Record<string, ConfigValue>;
/** Brand-neutral config. Single sections are Fields, table sections are Record<key, Fields>. */
export type DeviceConfig = Record<string, Fields | Record<string, Fields>>;

export interface Device {
  id: string;
  siteId: string;
  hostname: string;
  templateId: string;
  kind: DeviceKind;
  brand: string;
  model: string;
  firmware: string;
  serial: string;
  mac: string;
  ip?: string;
  vlan?: number;
  gateway?: string;
  /** DNS servers typed into the adapter. Unset means DHCP hands them out. */
  dns?: string[];
  /** Logged-in user on a workstation. Remoting in needs their consent. */
  user?: string;
  tags?: string[];
  /** Goes to sleep every night between these minutes of the day. */
  sleep?: { from: number; to: number };
  /**
   * Loses power in this window on the listed weekdays (0 is Monday), from `since` until someone
   * fixes the cause at `until`.
   */
  powerCut?: PowerCut;
  /** Power-cycled by remote hands; dark until this minute, then boots from its startup config. */
  rebootUntil?: number;
  bootAt: number;
  roomId: string;
  managed: boolean;
  rmmAgent: boolean;
  /** Set when a fault added this device. */
  addedBy?: string;
  ports: Port[];
  poeBudgetW?: number;
  poe?: { class: number; drawW: number };
  credentials?: { username: string; password: string };
  dialect?: string;
  running?: DeviceConfig;
  startup?: DeviceConfig;
}

export interface PowerCut {
  days: number[];
  from: number;
  to: number;
  since: number;
  until?: number;
  /** What remote hands say it is plugged into, before and after the fix. */
  source: string;
  fixedSource: string;
}

export interface Link {
  id: string;
  a: PortRef;
  b: PortRef;
  lengthM: number;
  condition: "good" | "damaged";
  /** The fault that plugged this cable in, like a loop under a desk. */
  addedBy?: string;
}

export interface DocDevice {
  deviceId: string;
  siteId: string;
  hostname: string;
  kind: DeviceKind;
  model: string;
  ip?: string;
  firmware: string;
  roomId: string;
  notes?: string;
}

export interface DocCredential {
  deviceId: string;
  hostname: string;
  username: string;
  password: string;
}

/** A Wi-Fi network as the docs record it. Its passphrase is a vault entry keyed by id. */
export interface DocWifi {
  id: string;
  siteId: string;
  ssid: string;
  vlan: number;
  security: string;
  notes?: string;
}

export interface DocSite {
  siteId: string;
  name: string;
  address: string;
  vlans: Vlan[];
  isp: Isp;
}

export interface DocHistoryEntry {
  at: number;
  by: string;
  entry: string; // "device:<id>", "site:<id>", "vault:<id>"
  field: string;
  from: string;
  to: string;
}

export interface Docs {
  sites: DocSite[];
  devices: DocDevice[];
  credentials: DocCredential[];
  wifi: DocWifi[];
  contacts: Contact[];
  floorPlan: boolean;
  accessNotes: string[];
  history: DocHistoryEntry[];
  accessLog: { at: number; who: string; entry: string }[];
}

export interface Clue {
  id: string;
  text: string;
  surface: string;
  requires: AccessToken;
}

export interface PlantedFault {
  faultId: string;
  name: string;
  startedAt: number;
  addedDevices: string[];
  clues: Clue[];
}

export interface CaseNote {
  issue: string;
  findings: string;
  changes: string;
  rootCause: string;
  nextSteps: string;
  wrongCause: string;
  wrongChange: string;
}

export interface CaseCall {
  facts: Record<string, string>;
  testFixed?: string;
  testBroken?: string;
  fixes: {
    id: string;
    label: string;
    unlockedBy: string;
    effect: "end-power-cut" | "unplug-loop";
    roles: string[];
  }[];
}

export interface CaseInstance {
  caseId: string;
  name: string;
  playbook: string;
  origin: Origin;
  priority: Priority;
  ticketTitle: string;
  ticketBody: string;
  ticketHistory: { at: number; by: string; text: string }[];
  /** Role name in the case text -> device id. */
  bindings: Record<string, string>;
  primary: string;
  fixed: { type: string; role: string }[];
  redHerring: string;
  rootCause: string;
  fix: string;
  note: CaseNote;
  /** What contacts say and do on a call for this case, with role names filled in. */
  call?: CaseCall;
  faults: PlantedFault[];
}

export interface ExtraTicket {
  id: string;
  kind: "misroute" | "duplicate" | "nothing";
  origin: Origin;
  priority: Priority;
  title: string;
  body: string;
  sendBack: "misrouted" | "duplicate" | "nothing";
  duplicateOf?: string;
  hint: string;
}

export interface HistoryEvent {
  at: number;
  deviceId: string;
  state: "down" | "up";
  note: string;
}

export interface OvikDevice {
  deviceId: string;
  hostname: string;
  ip: string;
  /** Switch and port Ovik thinks this device hangs off. Medium reliability. */
  uplink?: string;
}

export interface SolvabilityReport {
  solvable: boolean;
  access: AccessToken[];
  clues: { caseId: string; id: string; requires: AccessToken; reachable: boolean }[];
  /** How many tries each rerollable step took to land this client. */
  attempts: { world: number; faults: number; docs: number };
}

export interface World {
  generatorVersion: number;
  seed: string;
  scenario: string;
  client: ClientProfile;
  sites: Site[];
  devices: Device[];
  links: Link[];
  docs: Docs;
  cases: CaseInstance[];
  extraTickets: ExtraTicket[];
  history: HistoryEvent[];
  monitoring: { collectorId: string; inventory: OvikDevice[] };
  solvability: SolvabilityReport;
}
