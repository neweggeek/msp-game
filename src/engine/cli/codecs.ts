import type { ConfigValue } from "../model/types";
import type { Dialect } from "../schema";
import { isIp, maskToPrefix, parseCidr, prefixToMask } from "../util/ip";

export type FieldDef = Dialect["fields"][string][string];

export type Parsed =
  | { ok: true; value: ConfigValue }
  | { ok: false; error: "bad-value" | "missing-arg"; token?: string };

const unquote = (t: string) => t.replace(/^"(.*)"$/, "$1");

export function parseValue(def: FieldDef, tokens: string[]): Parsed {
  if (tokens.length === 0) return { ok: false, error: "missing-arg" };
  const first = tokens[0] as string;
  const bad = (token: string): Parsed => ({ ok: false, error: "bad-value", token });
  switch (def.codec) {
    case "string":
    case "quoted":
      return { ok: true, value: tokens.map(unquote).join(" ") };
    case "int":
      return /^\d+$/.test(first) ? { ok: true, value: Number(first) } : bad(first);
    case "enum":
      return def.values?.includes(first) ? { ok: true, value: first } : bad(first);
    case "list": {
      const wrong = def.values ? tokens.find((t) => !def.values?.includes(t)) : undefined;
      return wrong ? bad(wrong) : { ok: true, value: tokens };
    }
    case "ip":
      return isIp(first) ? { ok: true, value: first } : bad(first);
    case "ip-mask": {
      if (first.includes("/")) {
        const { ip, prefix } = parseCidr(first);
        return isIp(ip) && prefix >= 0 && prefix <= 32
          ? { ok: true, value: `${ip}/${prefix}` }
          : bad(first);
      }
      if (!isIp(first)) return bad(first);
      const mask = tokens[1];
      if (!mask) return { ok: false, error: "missing-arg" };
      const prefix = maskToPrefix(mask);
      return prefix === null ? bad(mask) : { ok: true, value: `${first}/${prefix}` };
    }
  }
}

export function formatValue(def: FieldDef, value: ConfigValue): string {
  switch (def.codec) {
    case "string":
    case "quoted":
      return `"${String(value)}"`;
    case "list":
      return Array.isArray(value) ? value.join(" ") : String(value);
    case "ip-mask": {
      const { ip, prefix } = parseCidr(String(value));
      return `${ip} ${prefixToMask(prefix)}`;
    }
    default:
      return String(value);
  }
}
