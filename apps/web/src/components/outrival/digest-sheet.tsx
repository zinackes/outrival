import { format } from "date-fns";
import {
  URGENCY_META,
  digestGroups,
  digestHeadline,
  digestLabel,
  digestStats,
  digestSupportingPoints,
  isQuietDigest,
  quietSentence,
} from "@/lib/digest-shape";
import type { Digest } from "@/lib/api";

/**
 * A brief as a document, for a board pack rather than for a screen.
 *
 * Deliberately NOT theme-aware: paper is paper. The sheet declares its own ink and
 * rules as scoped custom properties so it renders identically whatever the reader's
 * theme is, and prints without a dark rectangle behind every word. This is the one
 * surface in the product that opts out of the token system, and it says so here.
 *
 * Backs "Save as PDF" (the browser's own print pipeline) and, later, the public
 * read-only share link, so the artefact a customer forwards is the same object.
 */
const SHEET_CSS = `
.digest-sheet {
  --sheet-ink: #16181d;
  --sheet-muted: #4c515a;
  --sheet-faint: #6b6f78;
  --sheet-rule: #dcdee3;
  --sheet-hair: #e6e8ec;
  background: #ffffff;
  color: var(--sheet-ink);
}
@media print {
  @page { size: A4; margin: 16mm 14mm; }
  .print-hide { display: none !important; }
  .digest-sheet { padding: 0 !important; }
  .digest-sheet section { break-inside: auto; }
  .digest-sheet article { break-inside: avoid; }
  .digest-sheet h1, .digest-sheet h2 { break-after: avoid; }
}
`;

export function DigestSheet({ digest }: { digest: Digest }) {
  const content = digest.content;
  const stats = digestStats(content);
  const quiet = isQuietDigest(content);
  const headline = digestHeadline(content);
  const points = digestSupportingPoints(content);
  const groups = digestGroups(content);
  const trends = content?.sectoralTrends ?? [];
  const questions = content?.watchedQuestions ?? [];
  const kind = digest.period === "daily" ? "Daily competitive brief" : "Competitive brief";

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: SHEET_CSS }} />
      <div className="digest-sheet mx-auto max-w-[820px] px-8 py-12 sm:px-14">
        <header className="flex items-start justify-between gap-6 border-b-2 border-[color:var(--sheet-ink)] pb-3.5">
          <div className="flex items-center gap-2.5 text-content font-semibold tracking-tight">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              className="size-[17px]"
              aria-hidden
            >
              <circle cx="12" cy="12" r="3" />
              <ellipse cx="12" cy="12" rx="10" ry="5.2" transform="rotate(-28 12 12)" />
            </svg>
            Outrival
          </div>
          <div className="text-right text-xs leading-relaxed text-[color:var(--sheet-faint)]">
            {kind}, {digestLabel(digest)}
            <br />
            {stats.movers.length > 0
              ? `${stats.movers.length} ${stats.movers.length === 1 ? "competitor" : "competitors"} moved`
              : "No competitor moved"}
          </div>
        </header>

        <h1 className="m-0 mt-7 max-w-[24em] text-title-lg font-semibold leading-[1.22] tracking-tight text-balance">
          {quiet ? quietSentence(content) : (headline ?? digestLabel(digest))}
        </h1>

        {!quiet && (
          <>
            <dl className="mt-5 flex flex-wrap gap-x-7 gap-y-3 border-y border-[color:var(--sheet-rule)] py-3.5">
              <Fact label="Moves" value={String(stats.moves)} />
              <Fact label="Need an answer" value={String(stats.action)} />
              <Fact label="Competitors moving" value={String(stats.movers.length)} />
              <Fact label="Activity" value={content.temperature} mono={false} />
            </dl>

            {points.length > 0 && (
              <ul className="m-0 mt-5 flex list-disc flex-col gap-1.5 pl-[17px]">
                {points.map((p, i) => (
                  <li key={i} className="text-sm leading-relaxed">
                    {p}
                  </li>
                ))}
              </ul>
            )}

            {groups.map((group) => (
              <section key={group.urgency} className="mt-8">
                <h2 className="m-0 text-meta font-semibold uppercase tracking-[0.07em] text-[color:var(--sheet-faint)]">
                  {URGENCY_META[group.urgency].label}
                </h2>
                {group.items.map((s, i) => (
                  <article
                    key={i}
                    className="grid grid-cols-1 gap-x-5 border-t border-[color:var(--sheet-hair)] py-3.5 sm:grid-cols-[116px_minmax(0,1fr)]"
                  >
                    <div className="flex flex-col">
                      <span className="text-dense font-semibold tracking-tight">
                        {s.competitor}
                      </span>
                      {s.category && (
                        <span className="text-xs capitalize text-[color:var(--sheet-faint)]">
                          {s.category.replace(/_/g, " ")}
                        </span>
                      )}
                    </div>
                    <div>
                      <p className="m-0 text-sm leading-relaxed">{s.insight}</p>
                      {s.so_what && (
                        <p className="m-0 mt-1.5 text-dense leading-relaxed text-[color:var(--sheet-muted)]">
                          {s.so_what}
                        </p>
                      )}
                    </div>
                  </article>
                ))}
              </section>
            ))}

            {trends.length > 0 && (
              <section className="mt-8">
                <h2 className="m-0 text-meta font-semibold uppercase tracking-[0.07em] text-[color:var(--sheet-faint)]">
                  Sector trends
                </h2>
                {trends.map((t, i) => (
                  <article
                    key={i}
                    className="border-t border-[color:var(--sheet-hair)] py-3.5"
                  >
                    <p className="m-0 text-dense font-semibold tracking-tight">{t.title}</p>
                    <p className="m-0 mt-1.5 text-sm leading-relaxed text-[color:var(--sheet-muted)]">
                      {t.insight}
                    </p>
                  </article>
                ))}
              </section>
            )}

            {questions.length > 0 && (
              <section className="mt-8">
                <h2 className="m-0 text-meta font-semibold uppercase tracking-[0.07em] text-[color:var(--sheet-faint)]">
                  Watched questions
                </h2>
                {questions.map((q, i) => (
                  <article
                    key={i}
                    className="border-t border-[color:var(--sheet-hair)] py-3.5"
                  >
                    <p className="m-0 text-dense font-semibold tracking-tight">{q.question}</p>
                    <p className="m-0 mt-1.5 text-sm leading-relaxed text-[color:var(--sheet-muted)]">
                      {q.changeSummary}
                    </p>
                  </article>
                ))}
              </section>
            )}
          </>
        )}

        {quiet && (
          <p className="m-0 mt-4 max-w-[54ch] text-sm leading-relaxed text-[color:var(--sheet-muted)]">
            Nothing your competitors did in this period was worth interrupting you for.
          </p>
        )}

        <footer className="mt-9 flex flex-wrap justify-between gap-3 border-t border-[color:var(--sheet-rule)] pt-3 text-meta text-[color:var(--sheet-faint)]">
          <span>
            Generated by Outrival on {format(new Date(digest.createdAt), "d MMMM yyyy")}.
          </span>
          <span className="font-mono">outrival.app</span>
        </footer>
      </div>
    </>
  );
}

function Fact({
  label,
  value,
  mono = true,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-meta uppercase tracking-[0.05em] text-[color:var(--sheet-faint)]">
        {label}
      </dt>
      <dd
        className={`m-0 text-lead font-semibold tracking-tight ${
          mono ? "font-mono tabular-nums" : "capitalize"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
