import type { GameData } from "../data";
import type { DeviceKind, World } from "../model/types";

export interface AssetType {
  id: string;
  label: string;
  kinds: DeviceKind[];
}

/** The asset types in screen order, Wi-Fi last, like a docs tool sidebar. */
export function assetTypes(data: GameData): AssetType[] {
  return [
    ...data.assets.types.map((t) => ({ id: t.id, label: t.label, kinds: t.kinds })),
    { id: "wifi", label: data.assets.wifi.label, kinds: [] },
  ];
}

/** Which asset type a device kind belongs to. */
export function assetTypeOf(data: GameData, kind: DeviceKind): string {
  return data.assets.types.find((t) => t.kinds.includes(kind))?.id ?? kind;
}

/**
 * The ready-to-paste command that opens a device, built from what the docs say.
 * A wrong IP or user in the docs gives a wrong command, same as real life.
 * Undefined when the device has no CLI to land on or the docs lack what it needs.
 */
export function connectCommand(world: World, data: GameData, deviceId: string): string | undefined {
  const doc = world.docs.devices.find((d) => d.deviceId === deviceId);
  const cred = world.docs.credentials.find((c) => c.deviceId === deviceId);
  if (!doc?.ip || !cred) return undefined;
  const dev = world.devices.find((d) => d.id === deviceId);
  if (!dev || !data.devices.get(dev.templateId)?.dialect) return undefined;
  const tmpl = data.assets.types.find((t) => t.kinds.includes(doc.kind))?.connect;
  return tmpl?.replace("{user}", cred.username).replace("{ip}", doc.ip);
}
