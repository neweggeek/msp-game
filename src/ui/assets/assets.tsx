import { useState } from "react";
import { type AssetType, type DeviceKind, assetTypeOf, assetTypes } from "../../engine";
import { data, useUi } from "../store";

export const TYPES: AssetType[] = assetTypes(data);
export const typeOf = (kind: DeviceKind) => assetTypeOf(data, kind);
export const typeLabel = (id: string) => TYPES.find((t) => t.id === id)?.label ?? id;
export const typeOrder = (id: string) => {
  const i = TYPES.findIndex((t) => t.id === id);
  return i < 0 ? TYPES.length : i;
};

/** "All" plus one chip per asset type that has something in it, with counts. */
export function TypeChips({
  counts,
  value,
  onChange,
}: {
  counts: Record<string, number>;
  value: string;
  onChange: (id: string) => void;
}) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const shown = TYPES.filter((t) => counts[t.id]);
  return (
    <div className="chips" role="tablist" aria-label="Asset type">
      {[{ id: "all", label: "All" }, ...shown].map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          className={`chip ${value === t.id ? "on" : ""}`}
          onClick={() => onChange(t.id)}
        >
          {t.label} <span className="count">{t.id === "all" ? total : counts[t.id]}</span>
        </button>
      ))}
    </div>
  );
}

export function countBy<T>(rows: T[], key: (r: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[key(r)] = (out[key(r)] ?? 0) + 1;
  return out;
}

/** Sort key that puts 10.0.1.9 before 10.0.1.10. */
export function ipKey(ip: string | undefined): string {
  if (!ip) return "~";
  return ip
    .split(".")
    .map((p) => p.padStart(3, "0"))
    .join(".");
}

export type SortDir = 1 | -1;
export function useSort<K extends string>(first: K) {
  const [sort, setSort] = useState<{ key: K; dir: SortDir }>({ key: first, dir: 1 });
  const by = (key: K) => setSort((s) => ({ key, dir: s.key === key ? (-s.dir as SortDir) : 1 }));
  const cmp = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true }) * sort.dir;
  return { sort, by, cmp };
}

/** A clickable column header that shows the sort direction. */
export function SortTh<K extends string>({
  k,
  label,
  sort,
  by,
}: {
  k: K;
  label: string;
  sort: { key: K; dir: SortDir };
  by: (k: K) => void;
}) {
  const on = sort.key === k;
  return (
    <th aria-sort={on ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button type="button" className="sortable" onClick={() => by(k)}>
        {label}
        {on ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
      </button>
    </th>
  );
}

/** Put text on the clipboard and say so in the status line. */
export function useCopy() {
  const { say } = useUi();
  return (text: string, what: string) => {
    const done = () => say(`Copied ${what}.`);
    const fallback = () => {
      const t = document.createElement("textarea");
      t.value = text;
      document.body.appendChild(t);
      t.select();
      const ok = document.execCommand("copy");
      t.remove();
      ok ? done() : say(`Copy failed. Type it: ${text}`);
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  };
}

/** Rows split into one section per asset type, in type order. Unknown types go last. */
export function groupByType<T>(
  rows: T[],
  type: (r: T) => string,
): { id: string; label: string; rows: T[] }[] {
  const ids = [...new Set(rows.map(type))].sort((a, b) => typeOrder(a) - typeOrder(b));
  return ids.map((id) => ({
    id,
    label: TYPES.find((t) => t.id === id)?.label ?? "Unknown",
    rows: rows.filter((r) => type(r) === id),
  }));
}
