// The "at a glance" table shared by /alternatives/* and the category hub. Both
// pages rendered the same four-column grid inline; keeping one copy is what
// lets them stay in the landing's table register — meta-sized column heads,
// hairline rows, colour spent once on the row that is ours.

const ROW = "grid grid-cols-[1.4fr_1.2fr_1fr_0.9fr]";

const HEADS = ["Tool", "Best for", "Entry price", "Self-serve"];

export type GlanceItem = {
  name: string;
  bestFor: string;
  entryPrice: string;
  selfServe: string;
  self?: boolean;
};

export function GlanceTable({
  items,
  note,
}: {
  items: readonly GlanceItem[];
  note: string;
}) {
  return (
    <div className="mt-10">
      <div className="overflow-x-auto">
        <div className="min-w-[640px] border-t border-border-strong">
          <div
            className={`${ROW} border-b border-border text-meta font-medium uppercase tracking-[0.06em] text-text-subtle`}
          >
            {HEADS.map((h) => (
              <div key={h} className="px-4 py-3">
                {h}
              </div>
            ))}
          </div>
          {items.map((it) => (
            <div
              key={it.name}
              className={`${ROW} border-b border-border text-dense last:border-b-0 ${
                it.self ? "bg-primary/[0.05]" : ""
              }`}
            >
              <div
                className={`px-4 py-3.5 font-medium ${
                  it.self ? "text-primary" : ""
                }`}
              >
                {it.name}
              </div>
              <div className="px-4 py-3.5 text-text-muted">{it.bestFor}</div>
              <div className="px-4 py-3.5 tabular-nums text-text-muted">
                {it.entryPrice}
              </div>
              <div
                className={`px-4 py-3.5 ${
                  it.self ? "font-medium" : "text-text-muted"
                }`}
              >
                {it.selfServe}
              </div>
            </div>
          ))}
        </div>
      </div>
      <p className="mt-3 text-dense text-text-subtle">{note}</p>
    </div>
  );
}
