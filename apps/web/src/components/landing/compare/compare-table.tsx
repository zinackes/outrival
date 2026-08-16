import { COMPETITORS, OUTRIVAL, PRICE_AS_OF, type CompetitorKey } from "./data";

// Feature-by-feature comparison, in the landing's table register: meta-sized
// column heads, hairline rows, and colour spent exactly once — on the column
// that is ours.
//
// The competitor column used to be tone-coloured (amber for "partial", teal for
// "positive"). On the graphite band that read as two highlighted columns
// shouting at each other, and the tone was near-constant anyway, so it carried
// no information. The contrast now does the work: the rival's answer in muted
// ink, ours in full ink on a tinted column.

const ROW = "grid grid-cols-[1.3fr_1fr_1fr] sm:grid-cols-[1.5fr_1fr_1fr]";

export function CompareTable({ competitorKey }: { competitorKey: CompetitorKey }) {
  const c = COMPETITORS[competitorKey];

  const rows: {
    label: string;
    competitor: string;
    outrival: string;
    mark?: boolean;
  }[] = [
    {
      label: "Entry price",
      competitor: c.cells.entryPrice,
      outrival: OUTRIVAL.entryPrice,
      mark: true,
    },
    {
      label: "How you start",
      competitor: c.cells.access,
      outrival: OUTRIVAL.access,
    },
    {
      label: "Time to first value",
      competitor: c.cells.setup,
      outrival: OUTRIVAL.setup,
    },
    {
      label: "AI-written insight",
      competitor: c.cells.aiInsight,
      outrival: OUTRIVAL.aiInsight,
    },
    {
      label: "Digest & alerts",
      competitor: c.cells.digest,
      outrival: OUTRIVAL.digest,
    },
    {
      label: "EU data hosting",
      competitor: c.cells.hosting,
      outrival: OUTRIVAL.hosting,
    },
    {
      label: "Commitment",
      competitor: c.cells.commitment,
      outrival: OUTRIVAL.commitment,
    },
  ];

  return (
    <div>
      <div className="overflow-x-auto">
        <div className="min-w-[640px] border-t border-border-strong">
          {/* header */}
          <div
            className={`${ROW} border-b border-border text-meta font-medium uppercase tracking-[0.06em] text-text-subtle`}
          >
            <div className="px-4 py-3" />
            <div className="px-4 py-3">{c.name}</div>
            <div className="bg-primary/[0.05] px-4 py-3 text-primary">
              Outrival
            </div>
          </div>
          {rows.map((r) => (
            <div
              key={r.label}
              className={`${ROW} border-b border-border text-dense last:border-b-0`}
            >
              <div className="px-4 py-3.5 text-text-subtle">{r.label}</div>
              <div className="px-4 py-3.5 text-text-muted">
                {r.competitor}
                {r.mark && <sup className="ml-0.5 text-text-subtle">†</sup>}
              </div>
              <div className="bg-primary/[0.05] px-4 py-3.5 font-medium">
                {r.outrival}
              </div>
            </div>
          ))}
        </div>
      </div>
      <p className="mt-3 text-dense text-text-subtle">
        <span aria-hidden>† </span>
        Third-party estimate. {c.name} does not publish public pricing; figures
        vary by seats, competitors tracked and contract. As of {PRICE_AS_OF}.
      </p>
    </div>
  );
}
