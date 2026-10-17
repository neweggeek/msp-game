/**
 * Fill "{key}" placeholders. "{key:<10}" pads right to 10, "{key:>6}" pads left.
 * Unknown keys render as an empty string.
 */
export function fill(template: string, lookup: (key: string) => unknown): string {
  return template.replace(
    /\{([a-zA-Z0-9_.-]+)(?::([<>])(\d+))?\}/g,
    (_m, key: string, align?: string, width?: string) => {
      const raw = lookup(key);
      const text =
        raw === undefined || raw === null ? "" : Array.isArray(raw) ? raw.join(" ") : String(raw);
      if (!align || !width) return text;
      return align === "<" ? text.padEnd(Number(width)) : text.padStart(Number(width));
    },
  );
}

/** Lookup into a flat or nested object: "ap.hostname" reads obj.ap.hostname. */
export function pathLookup(obj: Record<string, unknown>): (key: string) => unknown {
  return (key) => {
    let cur: unknown = obj;
    for (const part of key.split(".")) {
      if (cur === null || typeof cur !== "object") return undefined;
      cur = (cur as Record<string, unknown>)[part];
    }
    return cur;
  };
}
