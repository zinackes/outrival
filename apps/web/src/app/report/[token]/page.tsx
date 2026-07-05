import type { Metadata } from "next";
import Link from "next/link";
import { Sparkles, ArrowUpRight } from "lucide-react";

// Public, read-only "Competitive Snapshot Report" (Lever 8). Rendered from a share
// token — no auth, no cookies. Always noindex + never in the sitemap: the token is
// the only capability. "Powered by Outrival" footer closes the acquisition loop.

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
type Report = {
  org: { name: string };
  product: { name: string } | null;
  generatedAt: string;
  competitors: {
    id: string;
    name: string;
    url: string | null;
    category: string | null;
    aiSummary: string | null;
  }[];
  pricing: PricingRow[];
  hiring: { competitorId: string; total: number }[];
  reviews: { competitorId: string; source: string; score: number; reviewCount: number }[];
  recentActivity: {
    competitorName: string;
    title: string;
    link: string | null;
    publishedAt: string | null;
  }[];
  insights: { kind: string; text: string }[];
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

function entryPrice(rows: PricingRow[]): string | null {
  const paid = rows.filter((r) => r.price != null && r.price > 0);
  if (paid.length === 0) return null;
  const monthly = paid.filter((r) => !r.billingPeriod || r.billingPeriod === "monthly");
  const pool = monthly.length ? monthly : paid;
  const cheapest = pool.reduce((min, r) => ((r.price ?? 0) < (min.price ?? 0) ? r : min));
  return `${fmtPrice(cheapest.price!, cheapest.currency)}/mo`;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-5 py-12 sm:py-16">{children}</div>
    </main>
  );
}

function PoweredBy() {
  return (
    <footer className="mt-14 border-t border-border pt-6">
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

  const { org, product, generatedAt, competitors, pricing, hiring, reviews, recentActivity, insights } =
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

  return (
    <Shell>
      <header className="mb-10">
        <p className="text-meta font-medium uppercase tracking-wide text-muted-foreground">
          Competitive Snapshot
        </p>
        <h1 className="mt-1 text-title-lg font-semibold tracking-tight">
          {org.name}
          {product ? <span className="text-muted-foreground"> · {product.name}</span> : null}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Tracking {competitors.length} competitor{competitors.length === 1 ? "" : "s"} · Generated{" "}
          {generated}
        </p>
      </header>

      {insights.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-3 text-sm font-semibold">Key takeaways</h2>
          <ul className="space-y-2">
            {insights.map((ins, i) => (
              <li
                key={i}
                className="flex gap-2.5 rounded-md border border-border bg-card px-4 py-3 text-sm"
              >
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-link" />
                <span>{ins.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold">Competitors</h2>
        <div className="space-y-3">
          {competitors.map((c) => {
            const price = entryPrice(pricingByComp.get(c.id) ?? []);
            const roles = hiringByComp.get(c.id);
            const rev = reviewByComp.get(c.id);
            return (
              <div key={c.id} className="rounded-md border border-border bg-card px-4 py-3.5">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="font-semibold">{c.name}</span>
                  {c.category ? (
                    <span className="text-meta text-muted-foreground">{c.category}</span>
                  ) : null}
                </div>
                {c.aiSummary ? (
                  <p className="mt-1.5 text-sm text-muted-foreground">{c.aiSummary}</p>
                ) : null}
                <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-dense">
                  {price ? (
                    <span>
                      <span className="text-muted-foreground">From </span>
                      <span className="font-medium tabular-nums">{price}</span>
                    </span>
                  ) : null}
                  {roles ? (
                    <span>
                      <span className="font-medium tabular-nums">{roles}</span>
                      <span className="text-muted-foreground"> open roles</span>
                    </span>
                  ) : null}
                  {rev ? (
                    <span>
                      <span className="font-medium tabular-nums">{rev.score}/5</span>
                      <span className="text-muted-foreground">
                        {" "}
                        on {rev.source} ({rev.reviewCount})
                      </span>
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {recentActivity.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold">Recent activity</h2>
          <ul className="space-y-2.5">
            {recentActivity.map((a, i) => (
              <li key={i} className="text-sm">
                <span className="font-medium">{a.competitorName}</span>{" "}
                <span className="text-muted-foreground">— {a.title}</span>
                {a.publishedAt ? (
                  <span className="text-meta text-muted-foreground">
                    {" "}
                    ·{" "}
                    {new Date(a.publishedAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      )}

      <PoweredBy />
    </Shell>
  );
}
