import { and, eq, ne, isNull, gte, lt } from "drizzle-orm";
import { competitors, signals, qualityFeedback } from "@outrival/db";
import { db } from "./db";
import { analyticsQueryResult, sql } from "./analytics-safe";

// Monthly "Competitive Recap" data (Lever 9) — the numbers behind the in-app "Wrapped"
// slideshow, the teaser email, and the public shared version. Pure assembly from data
// we already track (signals / quality_feedback / scrape_runs); no new table. Best-effort
// (analytics reads degrade to null), tenant-scoped by orgId.

const SEV_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
const MONTH_LABEL = (d: Date) =>
  d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

export interface MonthlyRecap {
  month: { key: string; label: string; start: string; end: string };
  isEmpty: boolean;
  totalMoves: number;
  competitorsTracked: number;
  pagesChecked: number | null;
  busiest: { name: string; count: number } | null;
  quietest: { name: string } | null;
  biggestMove: {
    competitorName: string;
    category: string;
    severity: string;
    insight: string;
    signalId: string;
  } | null;
  categoryBreakdown: { category: string; count: number; pct: number }[];
  topExposure: { category: string; count: number } | null;
  feedback: { useful: number; notUseful: number; total: number };
}

// Resolve a "YYYY-MM" (or, by default, the last COMPLETE month relative to `now`) to a
// [start, end) UTC window.
export function resolveRecapMonth(monthParam: string | undefined, now: Date) {
  let year: number, month: number; // month 0-11
  const m = monthParam?.match(/^(\d{4})-(\d{2})$/);
  if (m) {
    year = Number(m[1]);
    month = Number(m[2]) - 1;
  } else {
    // Previous month (the recap fires on the 1st for the month that just ended).
    year = now.getUTCFullYear();
    month = now.getUTCMonth() - 1;
  }
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 1));
  const key = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}`;
  return { start, end, key, label: MONTH_LABEL(start) };
}

export async function buildMonthlyRecap(
  orgId: string,
  monthParam?: string,
  now: Date = new Date(),
): Promise<MonthlyRecap> {
  const { start, end, key, label } = resolveRecapMonth(monthParam, now);
  const monthMeta = { key, label, start: start.toISOString(), end: end.toISOString() };

  // Tracked competitors (for the count + the "quietest" — a rival that never moved).
  const roster = await db
    .select({ id: competitors.id, name: competitors.name })
    .from(competitors)
    .where(
      and(eq(competitors.orgId, orgId), isNull(competitors.deletedAt), ne(competitors.type, "self")),
    );

  // Every signal this month (bounded per org/month → aggregate in JS, not N SQL group-bys).
  const rows = await db
    .select({
      id: signals.id,
      severity: signals.severity,
      category: signals.category,
      insight: signals.insight,
      competitorId: signals.competitorId,
      competitorName: competitors.name,
      relevanceScore: signals.relevanceScore,
      createdAt: signals.createdAt,
    })
    .from(signals)
    .innerJoin(competitors, eq(signals.competitorId, competitors.id))
    .where(
      and(
        eq(signals.orgId, orgId),
        gte(signals.createdAt, start),
        lt(signals.createdAt, end),
        isNull(competitors.deletedAt),
        ne(competitors.type, "self"),
      ),
    );

  const byCompetitor = new Map<string, { name: string; count: number }>();
  const byCategory = new Map<string, number>();
  const exposureByCategory = new Map<string, number>(); // high+critical only
  for (const r of rows) {
    const c = byCompetitor.get(r.competitorId) ?? { name: r.competitorName, count: 0 };
    c.count++;
    byCompetitor.set(r.competitorId, c);
    byCategory.set(r.category, (byCategory.get(r.category) ?? 0) + 1);
    if (r.severity === "high" || r.severity === "critical") {
      exposureByCategory.set(r.category, (exposureByCategory.get(r.category) ?? 0) + 1);
    }
  }

  const busiest =
    [...byCompetitor.values()].sort((a, b) => b.count - a.count)[0] ?? null;

  // Quietest = a tracked rival with the fewest moves (0 if it never appeared).
  const quietestId = roster
    .map((c) => ({ name: c.name, count: byCompetitor.get(c.id)?.count ?? 0 }))
    .sort((a, b) => a.count - b.count)[0];
  const quietest = roster.length > 1 && quietestId ? { name: quietestId.name } : null;

  const biggestRow = [...rows].sort(
    (a, b) =>
      (SEV_RANK[b.severity] ?? 0) - (SEV_RANK[a.severity] ?? 0) ||
      (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0) ||
      b.createdAt.getTime() - a.createdAt.getTime(),
  )[0];
  const biggestMove = biggestRow
    ? {
        competitorName: biggestRow.competitorName,
        category: biggestRow.category,
        severity: biggestRow.severity,
        insight: biggestRow.insight,
        signalId: biggestRow.id,
      }
    : null;

  const total = rows.length;
  const categoryBreakdown = [...byCategory.entries()]
    .map(([category, count]) => ({
      category,
      count,
      pct: total > 0 ? Math.round((count / total) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count);
  const topExposureEntry = [...exposureByCategory.entries()].sort((a, b) => b[1] - a[1])[0];
  const topExposure = topExposureEntry
    ? { category: topExposureEntry[0], count: topExposureEntry[1] }
    : null;

  // Feedback stats this month (relational, org-scoped).
  const fb = await db
    .select({ verdict: qualityFeedback.verdict })
    .from(qualityFeedback)
    .where(
      and(
        eq(qualityFeedback.orgId, orgId),
        eq(qualityFeedback.targetType, "signal"),
        gte(qualityFeedback.createdAt, start),
        lt(qualityFeedback.createdAt, end),
      ),
    );
  const feedback = {
    useful: fb.filter((f) => f.verdict === "useful").length,
    notUseful: fb.filter((f) => f.verdict === "not_useful").length,
    total: fb.length,
  };

  // Pages checked this month (analytics, best-effort → null on error).
  let pagesChecked: number | null = null;
  if (roster.length > 0) {
    const ids = sql.join(
      roster.map((c) => sql`${c.id}`),
      sql`, `,
    );
    const res = await analyticsQueryResult<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM scrape_runs
      WHERE competitor_id IN (${ids})
        AND status <> 'failed'
        AND recorded_at >= ${start.toISOString()} AND recorded_at < ${end.toISOString()}
    `);
    pagesChecked = res.ok ? (res.rows[0]?.n ?? 0) : null;
  }

  return {
    month: monthMeta,
    isEmpty: total === 0,
    totalMoves: total,
    competitorsTracked: roster.length,
    pagesChecked,
    busiest,
    quietest,
    biggestMove,
    categoryBreakdown,
    topExposure,
    feedback,
  };
}
