export type Tier = "low" | "mid" | "high";
export type DeviceKind = "firewall" | "switch" | "ap" | "phone" | "camera" | "pc" | "server";
export type Priority = "P1" | "P2" | "P3" | "P4";
export type PoePriority = "low" | "high" | "critical";
export type Staleness = "fresh" | "partly" | "stale";
export type AccessToken = string; // "docs" | "rmm" | "monitoring" | "ssh:<kind>"

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

export interface Site {
  id: string;
  name: string;
  address: string;
  buildings: { id: string; name: string; floors: number }[];
  rooms: Room[];
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
  poeCapable: boolean;
  poeEnabled: boolean;
  poePriority: PoePriority;
  link?: PortRef;
}

export type ConfigValue = string | number | string[];
export type Fields = Record<string, ConfigValue>;
/** Brand-neutral config. Single sections are Fields, table sections are Record<key, Fields>. */
export type DeviceConfig = Record<string, Fields | Record<string, Fields>>;

export interface Device {
  id: string;
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
  roomId: string;
  managed: boolean;
  rmmAgent: boolean;
  /** Set when a fault added this device. Undocumented devices never reach the docs. */
  addedBy?: string;
  undocumented?: boolean;
  ports: Port[];
  poeBudgetW?: number;
  poe?: { class: number; drawW: number };
  credentials?: { username: string; password: string };
  dialect?: string;
  running?: DeviceConfig;
  startup?: DeviceConfig;
}

export interface Link {
  id: string;
  a: PortRef;
  b: PortRef;
  lengthM: number;
  condition: "good" | "damaged";
}

export interface Vlan {
  id: number;
  name: string;
  subnet: string;
  gateway: string;
  role: "data" | "voice" | "mgmt";
}

export interface Network {
  vlans: Vlan[];
  links: Link[];
  isp: {
    name: string;
    circuitId: string;
    wanIp: string;
    wanCidr: string;
    gateway: string;
    phone: string;
  };
}

export interface DocDevice {
  deviceId: string;
  hostname: string;
  kind: DeviceKind;
  model: string;
  ip?: string;
  firmware: string;
  roomId: string;
}

export interface DocCredential {
  deviceId: string;
  hostname: string;
  username: string;
  password: string;
}

export interface Docs {
  devices: DocDevice[];
  credentials: DocCredential[];
  vlans: Vlan[];
  isp: Network["isp"];
  contacts: Contact[];
  floorPlan: boolean;
  accessNotes: string[];
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
  /** Role name in the fault text -> device id. */
  bindings: Record<string, string>;
  addedDevices: string[];
  clues: Clue[];
}

export interface CaseInstance {
  caseId: string;
  name: string;
  ticketTitle: string;
  ticketBody: string;
  priority: Priority;
  redHerring: string;
  rootCause: string;
  fix: string;
  faults: PlantedFault[];
}

export interface SolvabilityReport {
  solvable: boolean;
  access: AccessToken[];
  clues: { id: string; requires: AccessToken; reachable: boolean }[];
  /** How many tries each rerollable step took to land this client. */
  attempts: { world: number; faults: number; docs: number };
}

export interface World {
  generatorVersion: number;
  seed: string;
  client: ClientProfile;
  site: Site;
  devices: Device[];
  network: Network;
  docs: Docs;
  case: CaseInstance;
  solvability: SolvabilityReport;
}
