import type { Metadata } from "next";
import Link from "next/link";
import {
  Sparkles,
  ArrowUpRight,
  Tag,
  Gift,
  Briefcase,
  Star,
  type LucideIcon,
} from "lucide-react";
import { RecapDeck } from "@/components/dashboard/recap-wrapped";
import type { MonthlyRecap } from "@/lib/api";

// Public, read-only share view (Lever 8/9). Rendered from a share token — no auth, no
// cookies. Always noindex + never in the sitemap: the token is the only capability.
// Resolves to a "Competitive Snapshot Report" (landscape) or a "Wrapped" recap.

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export const metadata: Metadata = {
  title: "Competitive Snapshot — Outrival",
  robots: { index: false, follow: false },
};

type PricingRow = {
  competitorId: string;
  planName: string;
  price: number | null;
  currency: string | null;
  billingPeriod: string | null;
};
type Competitor = {
  id: string;
  name: string;
  url: string | null;
  category: string | null;
  aiSummary: string | null;
};
type Report = {
  org: { name: string };
  product: { name: string } | null;
  generatedAt: string;
  // The user's own product — anchors the "you vs the field" row in the matrix.
  self: { id: string; name: string; url: string | null } | null;
  selfPricing: PricingRow[];
  competitors: Competitor[];
  pricing: PricingRow[];
  hiring: { competitorId: string; total: number }[];
  reviews: { competitorId: string; source: string; score: number; reviewCount: number }[];
  recentActivity: {
    competitorName: string;
    title: string;
    link: string | null;
    source: string | null;
    publishedAt: string | null;
  }[];
  insights: { kind: string; text: string }[];
  // Discriminator (Lever 9): "recap" → the shared Wrapped instead of the landscape.
  kind?: "landscape" | "recap";
  recap?: MonthlyRecap;
};

async function fetchReport(token: string): Promise<Report | null> {
  try {
    const res = await fetch(`${API}/api/public/report/${encodeURIComponent(token)}`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    return (await res.json()) as Report;
  } catch {
    return null;
  }
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

const INSIGHT_ICON: Record<string, LucideIcon> = {
  pricing_gap: Tag,
  trial: Gift,
  hiring: Briefcase,
  reviews: Star,
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
      <Sparkles className="size-3.5 text-link" aria-hidden />
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
    <span className="font-mono text-dense font-medium tabular-nums sm:text-right">{value}</span>
  ) : (
    <span className="text-dense text-muted-foreground sm:text-right">—</span>
  );
}

function PoweredBy() {
  return (
    <footer className="mt-16 border-t border-border pt-6">
      <Link
        href="https://outrival.app"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <Sparkles className="size-4 text-link" />
        Powered by <span className="font-semibold text-foreground">Outrival</span>
        <ArrowUpRight className="size-3.5" />
      </Link>
      <p className="mt-2 text-meta text-muted-foreground">
        Automated competitive intelligence — monitor competitors, get strategic insights.
      </p>
    </footer>
  );
}

export default async function ReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const report = await fetchReport(token);

  if (!report) {
    return (
      <Shell>
        <div className="rounded-lg border border-border bg-card px-6 py-16 text-center">
          <h1 className="text-title font-semibold">This report isn’t available</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The link may have been revoked or is no longer valid.
          </p>
        </div>
        <PoweredBy />
      </Shell>
    );
  }

  // Recap share (Lever 9): the Wrapped, in public mode (dashboard links dropped, its own
  // "Powered by Outrival" close).
  if (report.kind === "recap" && report.recap) {
    return (
      <Shell>
        <RecapDeck recap={report.recap} publicMode />
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
            This snapshot is still being assembled — check back shortly.
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
                  const Icon = INSIGHT_ICON[ins.kind] ?? Sparkles;
                  return (
                    <li
                      key={i}
                      className="flex items-start gap-3 rounded-lg border border-border bg-card px-4 py-3.5"
                    >
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-accent/40 text-primary">
                        <Icon size={14} aria-hidden />
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
                    <span className="w-12 shrink-0 font-mono text-meta text-muted-foreground tabular-nums">
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
