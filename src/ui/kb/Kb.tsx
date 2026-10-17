import { useState } from "react";
import { data } from "../store";

const brandName = (id: string) => data.brands.get(id)?.name ?? id;

export function KbView({ compact = false }: { compact?: boolean }) {
  const [q, setQ] = useState("");
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = [...data.kb.values()].filter((e) => {
    const text = `${e.title} ${e.body.join(" ")} ${brandName(e.brand)}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
  return (
    <section className="panel grow" style={{ flex: compact ? "1 1 40%" : 1 }}>
      <header>
        <h2>Vendor KB</h2>
        <span className="sub">{hits.length} articles</span>
      </header>
      <div className="body" style={{ paddingBottom: 0 }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search vendor knowledge base"
          style={{ width: "100%" }}
          aria-label="Search KB"
        />
      </div>
      <div className="scroll">
        {hits.map((e) => (
          <details key={e.id} className="kb-entry" open={!compact && words.length > 0}>
            <summary>
              <span className="t">{e.title}</span>{" "}
              <span className="dim">· {brandName(e.brand)}</span>
            </summary>
            {e.body.map((p) => (
              <p key={p} className={p.startsWith("  ") || /^[a-z-]+ /.test(p) ? "mono" : ""}>
                {p}
              </p>
            ))}
          </details>
        ))}
      </div>
    </section>
  );
}
