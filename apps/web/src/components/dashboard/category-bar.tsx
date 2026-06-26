// The category wayfinding scale (globals.css --cat-*), the same system the
// overview band and the feed pills use. NOT severity/brand hues — borrowing those
// here mislabeled funding as critical-red and pricing as high-orange.
const CAT_COLOR: Record<string, string> = {
  pricing: "var(--cat-pricing)",
  product: "var(--cat-product)",
  hiring: "var(--cat-hiring)",
  reviews: "var(--cat-reviews)",
  content: "var(--cat-content)",
  funding: "var(--cat-funding)",
};

const FALLBACK = "var(--muted-2)";

export function CategoryBar({
  counts,
  w = 120,
}: {
  counts: Record<string, number>;
  w?: number;
}) {
  const sorted = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((acc, [, n]) => acc + n, 0);

  if (total === 0) {
    return (
      <div
        role="img"
        aria-label="Signal mix — no signals"
        className="h-1.5 rounded bg-background border border-border"
        style={{ width: w }}
      />
    );
  }

  // One breakdown string drives both the mouse tooltip (title) and the screen-
  // reader label, so the mix isn't conveyed by colour alone.
  const summary = sorted.map(([k, v]) => `${k}: ${v}`).join(" · ");

  return (
    <div
      role="img"
      aria-label={`Signal mix — ${summary}`}
      className="h-1.5 rounded overflow-hidden flex bg-background border border-border"
      style={{ width: w }}
      title={summary}
    >
      {sorted.map(([cat, n]) => (
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
            className="w-2 h-2 rounded-full inline-block"
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
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-meta capitalize text-muted-foreground">
      {entries.map(([cat, n]) => (
        <span key={cat} className="inline-flex items-center gap-1.5">
          <span
            className="w-2 h-2 rounded-full inline-block"
            style={{ backgroundColor: CAT_COLOR[cat] ?? FALLBACK }}
          />
          {cat}
          <span className="tabular-nums text-muted-foreground">{n}</span>
        </span>
      ))}
    </div>
  );
}
