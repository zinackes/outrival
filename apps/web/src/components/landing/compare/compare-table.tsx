import { COMPETITORS, OUTRIVAL, PRICE_AS_OF, type CompetitorKey } from "./data";

// Feature-by-feature comparison. Adapts the landing's Comparison grammar (border
// rows, tone-coloured cells, primary-tinted Outrival column) to a two-product,
// head-to-head layout. Tone reflects buyer-favourability, not a value judgement
// of the vendor: an annual contract is "subtle" for a small buyer, not "bad".

type Tone = "subtle" | "partial" | "positive";

const TONE: Record<Tone, string> = {
  subtle: "text-text-subtle",
  partial: "text-medium",
  positive: "text-positive",
};

const ROW = "grid grid-cols-[1.3fr_1fr_1fr] sm:grid-cols-[1.5fr_1fr_1fr]";

export function CompareTable({ competitorKey }: { competitorKey: CompetitorKey }) {
  const c = COMPETITORS[competitorKey];

  const rows: {
    label: string;
    competitor: string;
    competitorTone: Tone;
    outrival: string;
    mark?: boolean;
  }[] = [
    {
      label: "Entry price",
      competitor: c.cells.entryPrice,
      competitorTone: "subtle",
      outrival: OUTRIVAL.entryPrice,
      mark: true,
    },
    {
      label: "How you start",
      competitor: c.cells.access,
      competitorTone: "subtle",
      outrival: OUTRIVAL.access,
    },
    {
      label: "Time to first value",
      competitor: c.cells.setup,
      competitorTone: "partial",
      outrival: OUTRIVAL.setup,
    },
    {
      label: "AI-written insight",
      competitor: c.cells.aiInsight,
      competitorTone: "partial",
      outrival: OUTRIVAL.aiInsight,
    },
    {
      label: "Digest & alerts",
      competitor: c.cells.digest,
      competitorTone: "partial",
      outrival: OUTRIVAL.digest,
    },
    {
      label: "EU data hosting",
      competitor: c.cells.hosting,
      competitorTone: "subtle",
      outrival: OUTRIVAL.hosting,
    },
    {
      label: "Commitment",
      competitor: c.cells.commitment,
      competitorTone: "subtle",
      outrival: OUTRIVAL.commitment,
    },
  ];

  return (
    <div>
      <div className="overflow-x-auto">
        <div className="min-w-[640px] border-t border-border-strong">
          {/* header */}
          <div
            className={`${ROW} border-b border-border text-xs font-medium text-text-subtle`}
          >
            <div className="px-4 py-3" />
            <div className="px-4 py-3">{c.name}</div>
            <div className="bg-primary/[0.04] px-4 py-3 text-primary">
              Outrival
            </div>
          </div>
          {rows.map((r) => (
            <div
              key={r.label}
              className={`${ROW} border-b border-border text-sm last:border-b-0`}
            >
              <div className="px-4 py-3.5 text-text-muted">{r.label}</div>
              <div className={`px-4 py-3.5 ${TONE[r.competitorTone]}`}>
                {r.competitor}
                {r.mark && <sup className="ml-0.5 text-text-subtle">†</sup>}
              </div>
              <div className="bg-primary/[0.04] px-4 py-3.5 text-positive">
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
