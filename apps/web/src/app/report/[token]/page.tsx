import type { Metadata } from "next";
import Link from "next/link";
import type { Icon as PhosphorIcon } from "@/components/icons";
import {
  SparkleIcon,
  ArrowUpRightIcon,
  TagIcon,
  GiftIcon,
  BriefcaseIcon,
  StarIcon,
} from "@/components/icons";
import { RecapDeck } from "@/components/dashboard/recap-wrapped";
import { serverApiBase } from "@/lib/api-base";
import type { PricingRow, ReportFailure, SharedReport } from "@/lib/report-outcome";
import {
  REPORT_FAILURE_COPY,
  reportFailureFromStatus,
  reportTitle,
  resolveReportView,
} from "@/lib/report-outcome";

// Public, read-only share view (Lever 8/9). Rendered from a share token — no auth, no
// cookies. Always noindex + never in the sitemap: the token is the only capability.
// Resolves to a "Competitive Snapshot Report" (landscape) or a "Wrapped" recap.

const API = serverApiBase();

type ReportLoad = { ok: true; report: SharedReport } | { ok: false; failure: ReportFailure };

async function attempt(url: string, init: RequestInit): Promise<ReportLoad> {
  try {
    const res = await fetch(url, init);
    if (!res.ok) return { ok: false, failure: reportFailureFromStatus(res.status) };
    return { ok: true, report: (await res.json()) as SharedReport };
  } catch {
    // Nothing answered at all — never the reader's link.
    return { ok: false, failure: "unavailable" };
  }
}

async function loadReport(token: string): Promise<ReportLoad> {
  const url = `${API}/api/public/report/${encodeURIComponent(token)}`;
  // 300s is also the revocation propagation window, and the number Settings → Data
  // quotes to the reader: a token revoked right after a successful render keeps
  // being served from this cache entry until it expires. Changing it changes that
  // promise — keep the two in step (shared-reports-settings.tsx).
  const first = await attempt(url, { next: { revalidate: 300 } });
  if (first.ok || first.failure === "revoked") return first;
  // A revoked link stays revoked, so its 404 is worth the 300s window. An outage is
  // not: cached, it would keep telling the reader to refresh while every refresh
  // replays the same stored failure. The uncached retry also opts this render out of
  // the full-route cache, so the next visit reaches the API again.
  return attempt(url, { cache: "no-store" });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  // Same URL and options as the render's first attempt, so Next's request
  // memoization serves both from one call.
  const load = await loadReport(token);
  return {
    title: load.ok ? reportTitle(load.report) : "Shared report",
    robots: { index: false, follow: false },
  };
}

function fmtPrice(price: number, currency: string | null): string {
  const sym = currency === "USD" ? "$" : currency === "EUR" ? "€" : currency === "GBP" ? "£" : "";
  const n = Number.isInteger(price) ? String(price) : price.toFixed(2);
  return sym ? `${sym}${n}` : `${n} ${currency ?? ""}`.trim();
}

// The cheapest paid, monthly-normalised plan → a one-glance entry price. Null when
// nothing priceable was captured (free-only or pricing scan pending).
function entryPrice(rows: PricingRow[]): string | null {
  const paid = rows.filter((r) => r.price != null && r.price > 0);
  if (paid.length === 0) return null;
  const monthly = paid.filter((r) => !r.billingPeriod || r.billingPeriod === "monthly");
  const pool = monthly.length ? monthly : paid;
  const cheapest = pool.reduce((min, r) => ((r.price ?? 0) < (min.price ?? 0) ? r : min));
  return `${fmtPrice(cheapest.price!, cheapest.currency)}/mo`;
}

const INSIGHT_ICON: Record<string, PhosphorIcon> = {
  pricing_gap: TagIcon,
  trial: GiftIcon,
  hiring: BriefcaseIcon,
  reviews: StarIcon,
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-5 py-12 sm:py-16">{children}</div>
    </main>
  );
}

function Wordmark({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className ?? ""}`}>
      <SparkleIcon className="size-4 text-link" aria-hidden />
      <span className="text-dense font-semibold tracking-tight">Outrival</span>
    </span>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-meta font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </h2>
  );
}

// A bordered initial — coherent identity without loading arbitrary competitor logos
// (which would need the dashboard's CORS/fallback machinery) into a public server view.
function Monogram({ name }: { name: string }) {
  const initial = name.trim().charAt(0).toUpperCase() || "•";
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-card text-meta font-semibold text-muted-foreground">
      {initial}
    </span>
  );
}

// One aligned metric cell in the landscape matrix. `sm:contents` on the row's metric
// wrapper promotes these to grid columns on wide screens; on mobile they wrap under
// the name as a compact strip.
function Cell({ value }: { value: string | null }) {
  return value ? (
    <span className="text-dense font-medium tabular-nums sm:text-right">{value}</span>
  ) : (
    <span className="text-dense text-muted-foreground sm:text-right">—</span>
  );
}

// One list section of a shared battle card. An empty section is dropped rather than
// rendered as a heading over nothing: the reader can't regenerate the card from here,
// so an empty block is a dead end rather than a prompt.
function CardSection({ title, lines }: { title: string; lines: string[] }) {
  if (lines.length === 0) return null;
  return (
    <section className="mb-12">
      <SectionLabel>{title}</SectionLabel>
      <ul className="mt-4 space-y-2.5">
        {lines.map((line, i) => (
          <li
            key={i}
            className="flex items-start gap-3 rounded-lg border border-border bg-card px-4 py-3.5 text-sm leading-snug"
          >
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PoweredBy() {
  return (
    <footer className="mt-16 border-t border-border pt-6">
      <Link
        href="https://outrival.app"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <SparkleIcon className="size-3.5 text-link" />
        Powered by <span className="font-semibold text-foreground">Outrival</span>
        <ArrowUpRightIcon className="size-3.5" />
      </Link>
      <p className="mt-2 text-meta text-muted-foreground">
        Automated competitive intelligence: monitor competitors, get strategic insights.
      </p>
    </footer>
  );
}

// The one screen a reader gets when there is nothing to show. It has to say which of
// the two it is: "ask for a new link" and "refresh in a minute" are opposite moves,
// and a stranger has no other way to tell them apart (OUT-189).
function FailureScreen({ failure }: { failure: ReportFailure }) {
  const { title, description } = REPORT_FAILURE_COPY[failure];
  return (
    <Shell>
      <div className="rounded-lg border border-border bg-card px-6 py-16 text-center">
        <h1 className="text-title font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      </div>
      <PoweredBy />
    </Shell>
  );
}

export default async function ReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const load = await loadReport(token);

  if (!load.ok) return <FailureScreen failure={load.failure} />;

  const report = load.report;
  const resolved = resolveReportView(report);

  // A payload that names a kind it didn't carry is a server fault, not a dead link:
  // the landscape branch below reads `pricing`/`competitors` unconditionally, so
  // falling through to it threw a TypeError and served a 500 to a public reader.
  if (resolved.view === "incomplete") return <FailureScreen failure="unavailable" />;

  // Recap share (Lever 9): the Wrapped, in public mode (dashboard links dropped, its own
  // "Powered by Outrival" close).
  if (resolved.view === "recap") {
    return (
      <Shell>
        <RecapDeck recap={resolved.recap} publicMode />
      </Shell>
    );
  }

  // Battle card share (OUT-193): the same six sections the dashboard shows, minus
  // everything that needs a session (edit, regenerate, evidence drilldown). The date
  // is stated plainly because a card read before a call is only worth what its age
  // says it is, and the reader here has no dashboard to check it against.
  if (resolved.view === "battle_card") {
    const { content, competitor } = resolved;
    const generatedOn = new Date(report.generatedAt).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    return (
      <Shell>
        <header className="mb-12">
          <div className="flex items-center justify-between gap-4">
            <p className="text-meta font-medium uppercase tracking-wide text-muted-foreground">
              Battle card
            </p>
            <Wordmark className="text-muted-foreground" />
          </div>
          <h1 className="mt-3 flex items-center gap-3 text-title-lg font-semibold tracking-tight sm:text-stat sm:leading-tight">
            <Monogram name={competitor.name} />
            <span className="min-w-0">
              {report.product ? `${report.product.name} vs ` : "vs "}
              {competitor.name}
            </span>
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {report.org.name} · Generated {generatedOn}
          </p>
          <div className="mt-6 h-px w-full bg-gradient-to-r from-primary/60 via-border to-transparent" />
        </header>

        <CardSection title="Their strengths" lines={content.their_strengths} />
        <CardSection title="Their weaknesses" lines={content.their_weaknesses} />
        <CardSection title="Our strengths" lines={content.our_strengths} />
        <CardSection title="When we win" lines={content.when_we_win} />
        <CardSection title="When we lose" lines={content.when_we_lose} />

        {content.common_objections.length > 0 && (
          <section className="mb-12">
            <SectionLabel>Common objections</SectionLabel>
            <div className="mt-4 space-y-3">
              {content.common_objections.map((o, i) => (
                <div key={i} className="rounded-lg border border-border bg-card px-4 py-3.5">
                  <p className="text-sm font-semibold">{o.objection}</p>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                    {o.response}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        <PoweredBy />
      </Shell>
    );
  }

  const { org, product, generatedAt, self, selfPricing, competitors, pricing, hiring, reviews, recentActivity, insights } =
    report;

  const pricingByComp = new Map<string, PricingRow[]>();
  for (const r of pricing) {
    const list = pricingByComp.get(r.competitorId) ?? [];
    list.push(r);
    pricingByComp.set(r.competitorId, list);
  }
  const hiringByComp = new Map(hiring.map((h) => [h.competitorId, h.total]));
  const reviewByComp = new Map(reviews.map((r) => [r.competitorId, r]));
  const generated = new Date(generatedAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // Rows for the landscape matrix: the user's product pinned first (highlighted "You"),
  // then each competitor. Each carries its entry price / open roles / rating.
  const rows: {
    id: string;
    name: string;
    url: string | null;
    isYou: boolean;
    price: string | null;
    roles: number | null;
    rating: { score: number; source: string } | null;
  }[] = [];
  if (self) {
    rows.push({
      id: self.id,
      name: self.name,
      url: self.url,
      isYou: true,
      price: entryPrice(selfPricing),
      roles: null,
      rating: null,
    });
  }
  for (const c of competitors) {
    const rev = reviewByComp.get(c.id);
    rows.push({
      id: c.id,
      name: c.name,
      url: c.url,
      isYou: false,
      price: entryPrice(pricingByComp.get(c.id) ?? []),
      roles: hiringByComp.get(c.id) ?? null,
      rating: rev ? { score: rev.score, source: rev.source } : null,
    });
  }

  const profiles = competitors.filter((c) => c.aiSummary || c.category);

  return (
    <Shell>
      {/* Masthead — a report cover, not a bare heading. */}
      <header className="mb-12">
        <div className="flex items-center justify-between gap-4">
          <p className="text-meta font-medium uppercase tracking-wide text-muted-foreground">
            Competitive Snapshot
          </p>
          <Wordmark className="text-muted-foreground" />
        </div>
        <h1 className="mt-3 text-title-lg font-semibold tracking-tight sm:text-stat sm:leading-tight">
          {org.name}
          {product ? <span className="text-muted-foreground"> · {product.name}</span> : null}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Tracking{" "}
          <span className="font-medium text-foreground tabular-nums">{competitors.length}</span>{" "}
          competitor{competitors.length === 1 ? "" : "s"} · Generated {generated}
        </p>
        <div className="mt-6 h-px w-full bg-gradient-to-r from-primary/60 via-border to-transparent" />
      </header>

      {competitors.length === 0 ? (
        <div className="rounded-xl border border-border bg-card px-6 py-14 text-center">
          <p className="text-sm text-muted-foreground">
            This snapshot is still being assembled. Check back shortly.
          </p>
        </div>
      ) : (
        <>
          {/* Punchline first — the deterministic gaps the scan already found. */}
          {insights.length > 0 && (
            <section className="mb-12">
              <SectionLabel>Key takeaways</SectionLabel>
              <ul className="mt-4 space-y-2.5">
                {insights.map((ins, i) => {
                  const Icon = INSIGHT_ICON[ins.kind] ?? SparkleIcon;
                  return (
                    <li
                      key={i}
                      className="flex items-start gap-3 rounded-lg border border-border bg-card px-4 py-3.5"
                    >
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-accent/40 text-link">
                        <Icon size={16} aria-hidden />
                      </span>
                      <span className="text-sm leading-snug">{ins.text}</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {/* The landscape matrix — you against the field, aligned so it scans. */}
          <section className="mb-12">
            <SectionLabel>The landscape</SectionLabel>
            <div className="mt-4 overflow-hidden rounded-xl border border-border">
              <div className="hidden border-b border-border bg-card px-4 py-2.5 sm:grid sm:grid-cols-[minmax(0,1fr)_6rem_5rem_7rem] sm:gap-4">
                <span className="text-meta font-medium uppercase tracking-wide text-muted-foreground">
                  Company
                </span>
                <span className="text-right text-meta font-medium uppercase tracking-wide text-muted-foreground">
                  Entry price
                </span>
                <span className="text-right text-meta font-medium uppercase tracking-wide text-muted-foreground">
                  Hiring
                </span>
                <span className="text-right text-meta font-medium uppercase tracking-wide text-muted-foreground">
                  Rating
                </span>
              </div>
              {rows.map((r) => (
                <div
                  key={r.id}
                  className={`border-b border-border px-4 py-3 last:border-b-0 sm:grid sm:grid-cols-[minmax(0,1fr)_6rem_5rem_7rem] sm:items-center sm:gap-4 ${
                    r.isYou ? "bg-accent/30" : ""
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Monogram name={r.name} />
                    <span className="min-w-0 truncate font-medium">{r.name}</span>
                    {r.isYou && (
                      <span className="shrink-0 rounded-full border border-border bg-background px-1.5 py-px text-meta text-muted-foreground">
                        You
                      </span>
                    )}
                  </div>
                  <div className="mt-2.5 flex items-center gap-5 sm:mt-0 sm:contents">
                    <Cell value={r.price} />
                    <Cell value={r.roles != null ? String(r.roles) : null} />
                    <Cell value={r.rating ? `${r.rating.score}/5` : null} />
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-2 text-meta text-muted-foreground">
              Entry price is the cheapest paid monthly plan · Hiring is open roles right now ·
              Rating is the latest third-party review score.
            </p>
          </section>

          {/* Who's in the field — the qualitative read behind the numbers. */}
          {profiles.length > 0 && (
            <section className="mb-12">
              <SectionLabel>Who’s in the field</SectionLabel>
              <div className="mt-4 space-y-3">
                {profiles.map((c) => (
                  <div key={c.id} className="rounded-lg border border-border bg-card px-4 py-3.5">
                    <div className="flex items-center gap-2.5">
                      <Monogram name={c.name} />
                      <span className="font-semibold">{c.name}</span>
                      {c.category ? (
                        <span className="rounded-full border border-border px-2 py-px text-meta text-muted-foreground">
                          {c.category}
                        </span>
                      ) : null}
                    </div>
                    {c.aiSummary ? (
                      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                        {c.aiSummary}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Recent activity — dated events the news scrape already carries. */}
          {recentActivity.length > 0 && (
            <section>
              <SectionLabel>Recent activity</SectionLabel>
              <ul className="mt-4 divide-y divide-border overflow-hidden rounded-xl border border-border">
                {recentActivity.map((a, i) => (
                  <li key={i} className="flex items-baseline gap-3 px-4 py-3 text-sm">
                    <span className="w-12 shrink-0 text-meta text-muted-foreground tabular-nums">
                      {a.publishedAt
                        ? new Date(a.publishedAt).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })
                        : "—"}
                    </span>
                    <span className="shrink-0 font-medium">{a.competitorName}</span>
                    {a.link ? (
                      <a
                        href={a.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-w-0 truncate text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                      >
                        {a.title}
                      </a>
                    ) : (
                      <span className="min-w-0 truncate text-muted-foreground">{a.title}</span>
                    )}
                    {a.source ? (
                      <span className="ml-auto shrink-0 text-meta text-muted-foreground max-sm:hidden">
                        {a.source}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <PoweredBy />
    </Shell>
  );
}
