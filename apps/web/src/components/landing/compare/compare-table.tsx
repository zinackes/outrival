import { COMPETITORS, OUTRIVAL, PRICE_AS_OF, type CompetitorKey } from "./data";

// Feature by feature, on the same board /pricing uses for the cost comparison
// (.lp-ctx): a sticky label rail, one column per tool, and the single spot of
// colour spent on the column that is ours.
//
// It was a grid of divs painted with app tokens (border-border, bg-surface),
// which on the graphite band rendered as a pale card that belonged to the
// dashboard rather than to the landing. Sharing one board style with /pricing
// also means a reader who crossed from there recognises the object.
//
// The competitor column used to be tone-coloured (amber for "partial", teal for
// "positive"). On graphite that read as two highlighted columns shouting at
// each other, and the tone was near-constant anyway, so it carried no
// information. The contrast does the work: the rival's answer in muted ink,
// ours in full ink on the outlined column.

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
      {/* Same tab stop as the pricing table's scroll box (`ux:31`). */}
      <div
        className="lp-ctx-wrap"
        tabIndex={0}
        role="region"
        aria-label={`Outrival and ${c.name} compared, feature by feature`}
      >
        <table className="lp-ctx">
          <caption className="sr-only">
            Outrival and {c.name} compared, feature by feature
          </caption>
          <thead>
            <tr>
              <td className="ctx-corner" />
              <th scope="col">{c.name}</th>
              <th scope="col" className="is-self">
                Outrival
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <th scope="row">{r.label}</th>
                <td>
                  {r.competitor}
                  {r.mark && <sup className="ctx-mark">†</sup>}
                </td>
                <td className="is-self">{r.outrival}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="lp-ctx-note">
        <span aria-hidden>† </span>
        Third-party estimate. {c.name} does not publish public pricing; figures
        vary by seats, competitors tracked and contract. As of {PRICE_AS_OF}.
      </p>
    </div>
  );
}
