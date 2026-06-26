type Sev = "critical" | "high" | "medium" | "low";

const SEV_DOT: Record<Sev, string> = {
  critical: "bg-critical",
  high: "bg-high",
  medium: "bg-medium",
  low: "bg-low",
};

const CATEGORIES: { name: string; sev: Sev; desc: string }[] = [
  {
    name: "Pricing",
    sev: "critical",
    desc: "Plan added or removed, price change, billing model shift, new period, feature gating.",
  },
  {
    name: "Product",
    sev: "high",
    desc: "Major releases, UX overhauls, strategic feature launches.",
  },
  {
    name: "Hiring",
    sev: "high",
    desc: "First roles in a brand-new department, geographic expansion.",
  },
  {
    name: "Reviews",
    sev: "medium",
    desc: "Drop in G2 / Capterra score, negative sentiment at scale.",
  },
  {
    name: "Content",
    sev: "medium",
    desc: "Editorial post signalling repositioning, a public manifesto.",
  },
  {
    name: "Funding",
    sev: "low",
    desc: "Funding rounds, M&A and leadership moves, via news & press.",
  },
];

export function Categories() {
  return (
    <section className="py-16 sm:py-24" id="signals">
      <div className="mx-auto w-full max-w-6xl px-6">
        <div className="grid gap-x-10 gap-y-4 lg:grid-cols-2 lg:items-end">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
            Six categories.
            <br />
            Four severities.
          </h2>
          <p className="leading-relaxed text-text-muted">
            Every signal carries a category and a severity. You filter on what
            matters for your role — pricing for the CFO, hiring for talent,
            reviews for product.
          </p>
        </div>

        <div className="mt-14 grid grid-cols-1 gap-x-12 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {CATEGORIES.map((c) => (
            <div key={c.name} className="border-t border-border-strong pt-4">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="flex items-center gap-2.5 text-xl font-semibold tracking-tight">
                  <span className={`size-2 rounded-full ${SEV_DOT[c.sev]}`} />
                  {c.name}
                </h3>
                <span className="text-xs text-text-subtle">{c.sev}</span>
              </div>
              <p className="mt-2.5 text-sm leading-relaxed text-text-muted">
                {c.desc}
              </p>
            </div>
          ))}
        </div>

        {/* What one signal actually reads like — the closing moment. */}
        <div className="mt-12 border-t border-primary/70 pt-6">
          <span className="text-meta font-medium text-primary">
            A signal reads
          </span>
          <p className="mt-3 max-w-3xl text-content leading-relaxed">
            <span className="font-semibold">Linear</span> drops Business from $16
            → $14/seat and removes the 250-member cap. Business gets repositioned
            as the entry tier — your Pro plan loses $2 of competitive headroom.
          </p>
        </div>
      </div>
    </section>
  );
}
