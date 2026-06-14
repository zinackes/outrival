import { cookies } from "next/headers";
import { endOfDay, startOfDay, subDays } from "date-fns";
import type {
  Signal,
  Competitor,
  TrendsSummary,
  Digest,
  SectoralSignal,
  ActivitySource,
  ActivityUpcoming,
  ActivityEvent,
  ProductSummary,
} from "./api";
import type { CompetitorData } from "@/app/dashboard/competitors/[id]/competitor-detail-view";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

// Server-side GET that forwards the caller's session cookie to the API.
// CORS doesn't apply server-to-server, so the only thing the API needs is the
// auth cookie — which lives on `.outrival.app` and reaches this web server too.
async function serverGet<T>(path: string): Promise<T> {
  const cookieHeader = (await cookies()).toString();
  const res = await fetch(`${BASE}${path}`, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`server API ${path} -> ${res.status}`);
  return res.json() as Promise<T>;
}

/**
 * Prefetch the dashboard overview data on the server so it lands in the first
 * paint instead of after JS hydration + a browser round-trip.
 *
 * Best-effort by design: any failure (cookie missing, API down, hairpin
 * blocked) returns null and OverviewView falls back to its own client fetch.
 * The page is therefore never slower than before — only faster when this hits.
 */
export async function getOverviewData(): Promise<{
  signals: Signal[];
  competitors: Competitor[];
} | null> {
  try {
    const [s, c] = await Promise.all([
      serverGet<{ signals: Signal[] }>("/api/signals?limit=200"),
      serverGet<{ competitors: Competitor[] }>("/api/competitors"),
    ]);
    return { signals: s.signals, competitors: c.competitors };
  } catch {
    return null;
  }
}

/**
 * Prefetch the signals feed. The page passes the URL's product/sort so the seed
 * matches what SignalsView would fetch on mount (other filters are client-side).
 * Best-effort: null → SignalsView falls back to its own client fetch.
 */
export async function getSignalsData(params: {
  productId?: string;
  sort?: "threat" | "recent";
}): Promise<Signal[] | null> {
  const q = new URLSearchParams({ limit: "200", sort: params.sort ?? "threat" });
  if (params.productId) q.set("productId", params.productId);
  try {
    const r = await serverGet<{ signals: Signal[] }>(`/api/signals?${q.toString()}`);
    return r.signals;
  } catch {
    return null;
  }
}

/**
 * Prefetch the competitors list (with per-competitor stats). Best-effort: null →
 * CompetitorsList falls back to its own client fetch + keeps its 30s polling.
 */
export async function getCompetitorsData(): Promise<Competitor[] | null> {
  try {
    const r = await serverGet<{ competitors: Competitor[] }>("/api/competitors");
    return r.competitors;
  } catch {
    return null;
  }
}

/**
 * Prefetch a single competitor's detail (competitor + monitors + changes +
 * signals + tech stack + overview + plan). Best-effort: null → the detail view
 * falls back to its own client fetch.
 */
export async function getCompetitorDetailData(
  id: string,
): Promise<CompetitorData | null> {
  try {
    return await serverGet<CompetitorData>(`/api/competitors/${id}`);
  } catch {
    return null;
  }
}

/**
 * Prefetch the trends summary for the default 90-day window (matching
 * TrendsView's initial range = lastNDays(90)). Best-effort: null → TrendsView
 * falls back to its own client fetch. Drill-down series stay client-side.
 */
export async function getTrendsData(): Promise<TrendsSummary | null> {
  const from = startOfDay(subDays(new Date(), 90));
  const to = endOfDay(new Date());
  const q = `?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
  try {
    return await serverGet<TrendsSummary>(`/api/trends/summary${q}`);
  } catch {
    return null;
  }
}

/**
 * Prefetch the digests list. Best-effort: null → DigestsView falls back to its
 * own client fetch.
 */
export async function getDigestsData(): Promise<Digest[] | null> {
  try {
    const r = await serverGet<{ digests: Digest[] }>("/api/digests");
    return r.digests;
  } catch {
    return null;
  }
}

/**
 * Prefetch the sectoral feed's default page (no category, active view) — must
 * match SectoralFeed's initial fetch (limit 25). Best-effort: null → the feed
 * falls back to its own client fetch. Pagination + filters stay client-side.
 */
export async function getSectoralData(): Promise<SectoralSignal[] | null> {
  try {
    const r = await serverGet<{ signals: SectoralSignal[] }>(
      "/api/sectoral?limit=25",
    );
    return r.signals;
  } catch {
    return null;
  }
}

/**
 * Prefetch the activity page's two mount fetches: health (sources + upcoming)
 * and the default (unfiltered) timeline page (limit 25). Best-effort: null →
 * ActivityView falls back to its own client fetches.
 */
export async function getActivityData(): Promise<{
  sources: ActivitySource[];
  upcoming: ActivityUpcoming[];
  events: ActivityEvent[];
} | null> {
  try {
    const [health, timeline] = await Promise.all([
      serverGet<{ sources: ActivitySource[]; upcoming: ActivityUpcoming[] }>(
        "/api/activity/health",
      ),
      serverGet<{ events: ActivityEvent[] }>("/api/activity/timeline?limit=25"),
    ]);
    return {
      sources: health.sources,
      upcoming: health.upcoming ?? [],
      events: timeline.events,
    };
  } catch {
    return null;
  }
}

/**
 * Prefetch the compare picker's raw inputs (products + competitors). The view
 * derives the entity list + default selection from these. Best-effort: null →
 * CompareView falls back to its own client fetch. The matrix stays client-side
 * (it tracks the user's live selection).
 */
export async function getCompareData(): Promise<{
  products: ProductSummary[];
  competitors: Competitor[];
} | null> {
  try {
    const [p, c] = await Promise.all([
      serverGet<{ products: ProductSummary[] }>("/api/products"),
      serverGet<{ competitors: Competitor[] }>("/api/competitors"),
    ]);
    return { products: p.products, competitors: c.competitors };
  } catch {
    return null;
  }
}
