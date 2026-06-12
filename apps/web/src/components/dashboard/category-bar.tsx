const CAT_COLOR: Record<string, string> = {
  pricing: "var(--high)",
  product: "var(--foreground)",
  hiring: "var(--positive)",
  reviews: "var(--medium)",
  content: "var(--muted)",
  funding: "var(--critical)",
};

const FALLBACK = "var(--muted-2)";

export function CategoryBar({
  counts,
  w = 120,
}: {
  counts: Record<string, number>;
  w?: number;
}) {
  const entries = Object.entries(counts).filter(([, n]) => n > 0);
  const total = entries.reduce((acc, [, n]) => acc + n, 0);

  if (total === 0) {
    return (
      <div
        className="h-1.5 rounded bg-background border border-border"
        style={{ width: w }}
      />
    );
  }

  return (
    <div
      className="h-1.5 rounded overflow-hidden flex bg-background border border-border"
      style={{ width: w }}
      title={entries
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k}: ${v}`)
        .join(" · ")}
    >
      {entries
        .sort((a, b) => b[1] - a[1])
        .map(([cat, n]) => (
          <span
            key={cat}
            style={{
              width: `${(n / total) * 100}%`,
              backgroundColor: CAT_COLOR[cat] ?? FALLBACK,
            }}
          />
        ))}
    </div>
  );
}

// Static color → category key. Explains the stacked bar's colors once (e.g. in a
// header tooltip) instead of per row, since the color mapping is fixed.
export function CategoryKey() {
  return (
    <div className="flex flex-col gap-1 text-meta">
      {Object.keys(CAT_COLOR).map((cat) => (
        <span key={cat} className="inline-flex items-center gap-1.5 capitalize">
          <span
            className="w-[7px] h-[7px] rounded-full inline-block"
            style={{ backgroundColor: CAT_COLOR[cat] }}
          />
          {cat}
        </span>
      ))}
    </div>
  );
}

export function CategoryLegend({ counts }: { counts: Record<string, number> }) {
  const entries = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-meta font-mono uppercase tracking-wider text-muted-foreground">
      {entries.map(([cat, n]) => (
        <span key={cat} className="inline-flex items-center gap-1.5">
          <span
            className="w-[7px] h-[7px] rounded-full inline-block"
            style={{ backgroundColor: CAT_COLOR[cat] ?? FALLBACK }}
          />
          {cat}
          <span className="tabular-nums text-muted-foreground">{n}</span>
        </span>
      ))}
    </div>
  );
}
