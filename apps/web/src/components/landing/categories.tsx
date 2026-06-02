function SevPill({
  sev,
  label,
}: {
  sev: "critical" | "high" | "medium" | "low";
  label: string;
}) {
  const dot = {
    critical: "bg-critical",
    high: "bg-high",
    medium: "bg-medium",
    low: "bg-low",
  }[sev];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 font-mono text-[11px] text-text-muted">
      <span className={`size-1.5 rounded-full ${dot}`} /> {label}
    </span>
  );
}

function CatMini({
  cat,
  sev,
  sevLabel,
  title,
  eg,
}: {
  cat: string;
  sev: "critical" | "high" | "medium" | "low";
  sevLabel: string;
  title: string;
  eg: string;
}) {
  return (
    <div className="flex flex-col rounded-xl border border-border bg-surface p-5">
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs text-text-subtle">{cat}</span>
        <SevPill sev={sev} label={sevLabel} />
      </div>
      <div className="mt-3 font-semibold">{title}</div>
      <div className="mt-1 text-sm leading-relaxed text-text-muted">{eg}</div>
    </div>
  );
}

export function Categories() {
  return (
    <section className="py-20 sm:py-28" id="signals">
      <div className="mx-auto w-full max-w-6xl px-6">
        <div className="grid gap-x-10 gap-y-4 lg:grid-cols-2 lg:items-end">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
            Six categories.
            <br />
            Four severities.
          </h2>
          <p className="text-text-muted leading-relaxed">
            Every signal carries a category and a severity. You filter on what
            matters for your role — pricing for the CFO, hiring for talent,
            reviews for product.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-4 lg:grid-cols-12">
          <div className="flex flex-col rounded-xl border border-border bg-surface p-6 lg:col-span-5">
            <div className="inline-flex items-center gap-2 font-mono text-xs text-text-muted">
              <span className="size-1.5 rounded-full bg-critical" /> Critical
              example
            </div>
            <h3 className="mt-3 text-xl font-semibold">Pricing</h3>
            <p className="mt-2 text-sm leading-relaxed text-text-muted">
              Plan added or removed · price change · billing model shift (per
              seat → flat) · new billing period · feature gating.
            </p>
            <div className="mt-4 border-l-2 border-primary/40 pl-4 text-sm italic leading-relaxed text-text-muted">
              Linear drops Business from $16 → $14/seat and removes the 250
              member cap. Read: Business gets repositioned as the entry tier —
              your Pro plan loses $2 of competitive headroom.
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:col-span-7">
            <CatMini
              cat="product"
              sev="high"
              sevLabel="high"
              title="Product"
              eg="Major releases, UX overhauls, strategic feature launches."
            />
            <CatMini
              cat="hiring"
              sev="high"
              sevLabel="high"
              title="Hiring"
              eg="First roles in a brand-new department, geographic expansion."
            />
            <CatMini
              cat="reviews"
              sev="medium"
              sevLabel="medium"
              title="Reviews"
              eg="Drop in G2/Capterra score, negative sentiment at scale."
            />
            <CatMini
              cat="content"
              sev="medium"
              sevLabel="medium"
              title="Content"
              eg="Editorial post signalling repositioning, public manifesto."
            />
          </div>

          <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5 sm:flex-row sm:items-center sm:gap-6 lg:col-span-12">
            <div className="flex flex-col items-start gap-1.5">
              <span className="font-mono text-xs text-text-subtle">funding</span>
              <SevPill sev="low" label="low" />
            </div>
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="font-semibold">Funding</span>
              <span className="text-sm text-text-muted">
                Funding rounds detected via TechCrunch, press, Crunchbase.
                Strategic context but rarely actionable short-term — hence the
                default low severity.
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
