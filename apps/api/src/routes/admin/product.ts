import { Hono } from "hono";
import { desc, eq, gte, ne, sql } from "drizzle-orm";
import {
  db,
  onboardingSessions,
  products,
  productCompetitors,
  battleCards,
  jobPostings,
  competitors,
  competitorCandidates,
  discoveryRuns,
} from "@outrival/db";
import { summarizeFirstSignalSlo, type FirstSignalSloInputs } from "@outrival/shared";
import { analyticsQuery } from "../../lib/analytics-safe";
import { num, rate, type AdminVariables } from "./shared";

export const productRouter = new Hono<{ Variables: AdminVariables }>();

// Onboarding metrics from onboarding_sessions (patch-25). Computed in JS — the
// 30d row count is small — over the per-milestone timings: step durations
// (median/p90/p95), funnel drop-off, status + mode split. No PostHog
// dependency (PostHog events aren't queryable there).
function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx] ?? null;
}

const ONBOARDING_SEGMENTS: Array<{ key: string; label: string; from: string; to: string }> = [
  { key: "analyze", label: "URL → Product analyzed", from: "product_url_submitted", to: "product_analyzed" },
  { key: "review", label: "Analyzed → Profile confirmed", from: "product_analyzed", to: "product_profile_confirmed" },
  { key: "discovery", label: "Profile → Discovery completed", from: "product_profile_confirmed", to: "discovery_completed" },
  { key: "choose", label: "Discovery → Competitors finalized", from: "discovery_completed", to: "competitors_finalized" },
  { key: "first_signal", label: "Finalized → First signal", from: "competitors_finalized", to: "first_signal_received" },
  { key: "aha", label: "Signup → First signal", from: "started", to: "first_signal_received" },
  { key: "full", label: "Signup → Analysis completed", from: "started", to: "analysis_completed" },
  // Cold-start activation tail (F2) — populate for sessions started after the
  // milestones shipped, so counts fill in over the window.
  { key: "first_scrape", label: "Signup → First scrape", from: "started", to: "first_scrape" },
  { key: "scrape_to_signal", label: "First scrape → First signal", from: "first_scrape", to: "first_real_signal" },
  { key: "digest_sample", label: "Signup → Digest sample", from: "started", to: "digest_sample" },
];

// Funnel stages by milestone key, in order — drop-off is measured between them.
const ONBOARDING_FUNNEL: Array<{ key: string; label: string }> = [
  { key: "started", label: "Started" },
  { key: "product_analyzed", label: "Product analyzed" },
  { key: "product_profile_confirmed", label: "Profile confirmed" },
  { key: "discovery_completed", label: "Discovery completed" },
  { key: "competitors_finalized", label: "Competitors finalized" },
  { key: "analysis_completed", label: "Analysis completed" },
];

productRouter.get("/onboarding-metrics", async (c) => {
  const windowDays = 30;
  const cutoff = new Date(Date.now() - windowDays * 86_400_000);
  const rows = await db
    .select({
      stage: onboardingSessions.stage,
      mode: onboardingSessions.mode,
      timings: onboardingSessions.timings,
    })
    .from(onboardingSessions)
    .where(gte(onboardingSessions.startedAt, cutoff));

  const total = rows.length;
  const byStatus = { completed: 0, abandoned: 0, inProgress: 0, other: 0 };
  const modeSplit = { quick_start: 0, full: 0 };
  for (const r of rows) {
    if (r.stage === "completed") byStatus.completed += 1;
    else if (r.stage === "abandoned") byStatus.abandoned += 1;
    else if (r.stage === "analysis_in_progress") byStatus.inProgress += 1;
    else byStatus.other += 1;
    if (r.mode === "full") modeSplit.full += 1;
    else modeSplit.quick_start += 1;
  }

  const segments = ONBOARDING_SEGMENTS.map((seg) => {
    const durations: number[] = [];
    for (const r of rows) {
      const t = (r.timings ?? {}) as Record<string, number>;
      const a = t[seg.from];
      const b = t[seg.to];
      if (typeof a === "number" && typeof b === "number" && b >= a) durations.push(b - a);
    }
    return {
      key: seg.key,
      label: seg.label,
      count: durations.length,
      medianMs: percentile(durations, 50),
      p90Ms: percentile(durations, 90),
      p95Ms: percentile(durations, 95),
    };
  });

  let prevReached: number | null = null;
  const funnel = ONBOARDING_FUNNEL.map((stage) => {
    const reached = rows.filter((r) => {
      const t = (r.timings ?? {}) as Record<string, number>;
      return typeof t[stage.key] === "number";
    }).length;
    const dropoffPct =
      prevReached && prevReached > 0 ? (prevReached - reached) / prevReached : null;
    prevReached = reached;
    return { key: stage.key, label: stage.label, reached, dropoffPct };
  });

  return c.json({ windowDays, total, byStatus, modeSplit, segments, funnel });
});

// First-signal SLO (docs/slos/onboarding-first-signal.md) — the landing's
// "<10 min to first signal" promise, MEASURED not assumed. Same query the ops
// alert runs (workers getFirstSignalSloInputs); surfaced here so the compliance %
// is a live number in /admin. Only completions whose 10-min window has ELAPSED
// count. Best-effort: a read error returns { available: false }, never throws.
productRouter.get("/first-signal-slo", async (c) => {
  const recentRows = await analyticsQuery<{ hit: boolean }>(sql`
    SELECT (fs.first_signal_at IS NOT NULL
            AND fs.first_signal_at <= os.completed_at + interval '10 minutes') AS hit
    FROM onboarding_sessions os
    LEFT JOIN LATERAL (
      SELECT min(s.created_at) AS first_signal_at FROM signals s WHERE s.org_id = os.org_id
    ) fs ON true
    WHERE os.stage = 'completed' AND os.completed_at IS NOT NULL
      AND os.completed_at <= now() - interval '10 minutes'
    ORDER BY os.completed_at DESC
    LIMIT 3
  `);

  const aggRows = await analyticsQuery<{
    week_n: number;
    week_within: number;
    window_n: number;
    window_within: number;
    cov_n: number;
    cov_within: number;
  }>(sql`
    WITH completions AS (
      SELECT os.org_id, os.completed_at
      FROM onboarding_sessions os
      WHERE os.stage = 'completed' AND os.completed_at IS NOT NULL
        AND os.completed_at >= now() - interval '28 days'
        AND os.completed_at <= now() - interval '10 minutes'
    ),
    fs AS (
      SELECT c.completed_at,
             (SELECT min(s.created_at) FROM signals s WHERE s.org_id = c.org_id) AS first_signal_at
      FROM completions c
    )
    SELECT
      count(*) FILTER (WHERE completed_at >= now() - interval '7 days')::int AS week_n,
      count(*) FILTER (WHERE completed_at >= now() - interval '7 days'
        AND first_signal_at <= completed_at + interval '10 minutes')::int AS week_within,
      count(*)::int AS window_n,
      count(*) FILTER (
        WHERE first_signal_at <= completed_at + interval '10 minutes')::int AS window_within,
      count(*) FILTER (WHERE completed_at <= now() - interval '24 hours')::int AS cov_n,
      count(*) FILTER (WHERE completed_at <= now() - interval '24 hours'
        AND first_signal_at <= completed_at + interval '24 hours')::int AS cov_within
    FROM fs
  `);

  const agg = aggRows[0];
  if (!agg) return c.json({ available: false });

  const inputs: FirstSignalSloInputs = {
    recent: recentRows.map((r) => r.hit === true),
    week: { completions: num(agg.week_n), within: num(agg.week_within) },
    window: { completions: num(agg.window_n), within: num(agg.window_within) },
    coverage24h: { completions: num(agg.cov_n), within: num(agg.cov_within) },
  };
  return c.json({ available: true, ...summarizeFirstSignalSlo(inputs) });
});

// First-signal miss attribution (docs/slos/onboarding-first-signal.md, step 3 of
// the error-budget policy) — for the 28d onboarding completions that MISSED the
// 10-minute first-signal window, what did the archive backfill do? Joins the
// miss-bucket taxonomy already written by every backfill run
// (resolveBackfillOutcome, apps/workers/src/lib/backfill-guard.ts) against the
// org's own missed completions, so the dominant bucket routes the fix per the
// SLO doc's policy: no_archive_capture/no_significant_change dominant → coverage
// work; no_backfill_run dominant → wiring (the chain never fired); change_triggered
// dominant → latency (the chain fired but arrived late). Also reports the
// never-signal cohort (missed forever, not just missed the 10-minute mark) since
// the SLO doc tracks those as a separate product problem. Best-effort: a read
// error or empty cohort returns { available: false }, never throws.
productRouter.get("/first-signal-misses", async (c) => {
  const cohortRows = await analyticsQuery<{
    completions: number;
    never_signal: number;
    missed: number;
  }>(sql`
    WITH completions AS (
      SELECT os.org_id, os.completed_at
      FROM onboarding_sessions os
      WHERE os.stage = 'completed' AND os.completed_at IS NOT NULL
        AND os.org_id IS NOT NULL
        AND os.completed_at >= now() - interval '28 days'
        AND os.completed_at <= now() - interval '10 minutes'
    )
    SELECT
      count(*)::int AS completions,
      count(*) FILTER (
        WHERE NOT EXISTS (SELECT 1 FROM signals s WHERE s.org_id = c.org_id)
      )::int AS never_signal,
      count(*) FILTER (
        WHERE NOT EXISTS (
          SELECT 1 FROM signals s
          WHERE s.org_id = c.org_id AND s.created_at <= c.completed_at + interval '10 minutes'
        )
      )::int AS missed
    FROM completions c
  `);

  const cohort = cohortRows[0];
  if (!cohort) return c.json({ available: false });

  // Per-org presence, not a partition: an org that missed can carry several
  // backfill outcomes (one per competitor's monitor), so bucket counts do NOT
  // sum to `missed`. Plain DISTINCT (not DISTINCT ON) — the join fans out to one
  // row per (org, outcome) pair, and it's the pair being deduped, not an ordering.
  const bucketRows = await analyticsQuery<{ bucket: string; orgs: number }>(sql`
    WITH completions AS (
      SELECT os.org_id, os.completed_at
      FROM onboarding_sessions os
      WHERE os.stage = 'completed' AND os.completed_at IS NOT NULL
        AND os.org_id IS NOT NULL
        AND os.completed_at >= now() - interval '28 days'
        AND os.completed_at <= now() - interval '10 minutes'
    ),
    missed AS (
      SELECT c.org_id
      FROM completions c
      WHERE NOT EXISTS (
        SELECT 1 FROM signals s
        WHERE s.org_id = c.org_id
          AND s.created_at <= c.completed_at + interval '10 minutes'
      )
    ),
    runs AS (
      SELECT DISTINCT m.org_id, br.outcome
      FROM missed m
      JOIN competitors comp ON comp.org_id = m.org_id
      JOIN backfill_runs br ON br.competitor_id = comp.id
      WHERE br.recorded_at >= now() - interval '28 days'
    )
    SELECT outcome AS bucket, count(DISTINCT org_id)::int AS orgs
    FROM runs GROUP BY 1
    UNION ALL
    SELECT 'no_backfill_run' AS bucket, count(*)::int AS orgs
    FROM missed m
    WHERE NOT EXISTS (
      SELECT 1 FROM competitors comp
      JOIN backfill_runs br ON br.competitor_id = comp.id
      WHERE comp.org_id = m.org_id AND br.recorded_at >= now() - interval '28 days'
    )
  `);

  return c.json({
    available: true,
    windowDays: 28,
    completions: num(cohort.completions),
    missed: num(cohort.missed),
    neverSignal: num(cohort.never_signal),
    buckets: bucketRows.map((r) => ({ bucket: r.bucket, orgs: num(r.orgs) })),
  });
});

// patch-28 — multi-product adoption: how many orgs run >1 SKU, the shared-vs-
// specific competitor split (validates the hybrid model), and battle-card spread.
productRouter.get("/multi-product-metrics", async (c) => {
  const perOrg = await db
    .select({ orgId: products.orgId, n: sql<number>`count(*)::int` })
    .from(products)
    .where(ne(products.status, "archived"))
    .groupBy(products.orgId);

  const distribution = { one: 0, two: 0, three: 0, fourToFive: 0, sixPlus: 0 };
  let multiProductOrgs = 0;
  let totalActiveProducts = 0;
  for (const r of perOrg) {
    totalActiveProducts += r.n;
    if (r.n >= 2) multiProductOrgs += 1;
    if (r.n === 1) distribution.one += 1;
    else if (r.n === 2) distribution.two += 1;
    else if (r.n === 3) distribution.three += 1;
    else if (r.n <= 5) distribution.fourToFive += 1;
    else distribution.sixPlus += 1;
  }

  // The shared/specific split is gone with the is_specific flag (2026-07-29). What
  // the junction can still answer, and the thing worth watching, is how much
  // cross-SKU tracking actually happens: total links, and how many competitors are
  // deliberately followed for more than one product.
  const [assoc] = await db
    .select({
      links: sql<number>`count(*)::int`,
      competitors: sql<number>`count(distinct ${productCompetitors.competitorId})::int`,
    })
    .from(productCompetitors);

  const [crossProduct] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(
      db
        .select({ competitorId: productCompetitors.competitorId })
        .from(productCompetitors)
        .groupBy(productCompetitors.competitorId)
        .having(sql`count(*) > 1`)
        .as("multi"),
    );

  const [cards] = await db
    .select({
      total: sql<number>`count(*)::int`,
      couples: sql<number>`count(distinct (${battleCards.productId}, ${battleCards.competitorId}))::int`,
    })
    .from(battleCards);

  return c.json({
    orgsWithProducts: perOrg.length,
    multiProductOrgs,
    totalActiveProducts,
    distribution,
    associations: {
      links: assoc?.links ?? 0,
      competitors: assoc?.competitors ?? 0,
      crossProduct: crossProduct?.n ?? 0,
    },
    battleCards: {
      total: cards?.total ?? 0,
      couples: cards?.couples ?? 0,
      avgPerProduct: totalActiveProducts > 0 ? (cards?.total ?? 0) / totalActiveProducts : 0,
    },
  });
});

// --- Enrichment completeness: how much of the structured enrichment actually
//     lands — salary/seniority on jobs, sub-scores/themes on reviews, platform
//     profile on competitors. The arbiter for whether each enrichment is worth
//     surfacing, or whether the extraction needs work. Relational + best-effort
//     analytics (review_scores). Global (all orgs), not org-scoped. ---
productRouter.get("/enrichment-completeness", async (c) => {
  const [hiring] = await db
    .select({
      total: sql<number>`count(*)::int`,
      withSeniority: sql<number>`count(*) filter (where ${jobPostings.seniority} is not null)::int`,
      withSalary: sql<number>`count(*) filter (where ${jobPostings.salaryMin} is not null)::int`,
      viaAts: sql<number>`count(*) filter (where ${jobPostings.url} is not null)::int`,
    })
    .from(jobPostings)
    .where(eq(jobPostings.isActive, true));

  const [platform] = await db
    .select({
      eligible: sql<number>`count(*) filter (where ${competitors.url} is not null and ${competitors.type} <> 'self' and ${competitors.deletedAt} is null)::int`,
      withProfile: sql<number>`count(*) filter (where ${competitors.platformProfile} is not null and ${competitors.type} <> 'self' and ${competitors.deletedAt} is null)::int`,
    })
    .from(competitors);

  const [reviews] = await analyticsQuery<{
    with_scores: number;
    with_subscores: number;
    with_themes: number;
  }>(sql`
    SELECT
      count(distinct competitor_id)::int AS with_scores,
      count(distinct competitor_id) filter (
        where sub_ease_of_use is not null or sub_support is not null
           or sub_features is not null or sub_value is not null
      )::int AS with_subscores,
      count(distinct competitor_id) filter (where complaint_themes is not null)::int AS with_themes
    FROM review_scores
  `);

  return c.json({
    hiring: {
      total: hiring?.total ?? 0,
      withSeniority: hiring?.withSeniority ?? 0,
      withSalary: hiring?.withSalary ?? 0,
      viaAts: hiring?.viaAts ?? 0,
    },
    reviews: {
      withScores: reviews?.with_scores ?? 0,
      withSubScores: reviews?.with_subscores ?? 0,
      withThemes: reviews?.with_themes ?? 0,
    },
    platform: {
      eligible: platform?.eligible ?? 0,
      withProfile: platform?.withProfile ?? 0,
    },
  });
});

// --- Platform detection (patch-31): step A (no browser) vs step B (browser)
//     resolution — the cost arbiter, twin of extraction. Detection is rare
//     (competitor add + 30d cadence + drift) so the window is 7d, not 24h. ---
productRouter.get("/platform-detection", async (c) => {
  const stageRows = await analyticsQuery<{ stage: string; c: string; avg_ms: number }>(sql`
    SELECT stage, count(*) AS c, round(avg(duration_ms))::int AS avg_ms
    FROM platform_detection_runs
    WHERE recorded_at >= now() - make_interval(days => 7)
    GROUP BY stage
  `);
  const stage = (s: string) => stageRows.find((r) => r.stage === s);
  const aStatic = num(stage("a_static")?.c ?? "0");
  const bBrowser = num(stage("b_browser")?.c ?? "0");

  const [conn] = await analyticsQuery<{
    ats: string;
    status_page: string;
    changelog: string;
    pricing_widget: string;
    total: string;
  }>(sql`
    SELECT count(*) filter (where ats <> '')            AS ats,
           count(*) filter (where status_page <> '')    AS status_page,
           count(*) filter (where changelog <> '')      AS changelog,
           count(*) filter (where pricing_widget <> '') AS pricing_widget,
           count(*)                                     AS total
    FROM platform_detection_runs
    WHERE recorded_at >= now() - make_interval(days => 7)
  `);

  // Top detected values per slot in one pass (split by `kind` in JS).
  const topRows = await analyticsQuery<{ kind: string; name: string; c: string }>(sql`
    SELECT 'framework' AS kind, framework AS name, count(*) AS c
      FROM platform_detection_runs
      WHERE recorded_at >= now() - make_interval(days => 7) AND framework <> ''
      GROUP BY framework
    UNION ALL
    SELECT 'cms', cms, count(*)
      FROM platform_detection_runs
      WHERE recorded_at >= now() - make_interval(days => 7) AND cms <> ''
      GROUP BY cms
    UNION ALL
    SELECT 'ats', ats, count(*)
      FROM platform_detection_runs
      WHERE recorded_at >= now() - make_interval(days => 7) AND ats <> ''
      GROUP BY ats
    ORDER BY c DESC
  `);
  const top = (kind: string) =>
    topRows
      .filter((r) => r.kind === kind)
      .slice(0, 8)
      .map((r) => ({ name: r.name, count: num(r.c) }));

  return c.json({
    window: "7d",
    stages: { aStatic, bBrowser },
    avgMsByStage: {
      aStatic: num(stage("a_static")?.avg_ms ?? 0),
      bBrowser: num(stage("b_browser")?.avg_ms ?? 0),
    },
    connectors: {
      total: num(conn?.total ?? "0"),
      ats: num(conn?.ats ?? "0"),
      statusPage: num(conn?.status_page ?? "0"),
      changelog: num(conn?.changelog ?? "0"),
      pricingWidget: num(conn?.pricing_widget ?? "0"),
    },
    topFrameworks: top("framework"),
    topCms: top("cms"),
    topAts: top("ats"),
  });
});

// --- Discovery: Exa candidate quality (acceptance rate) + on-demand /detect
//     monthly consumption (the variable Exa cost). ---
productRouter.get("/discovery", async (c) => {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400_000);
  const monthKey = new Date().toISOString().slice(0, 7); // YYYY-MM

  const [agg, bySource, discovery, recent] = await Promise.all([
    db
      .select({
        total: sql<number>`count(*)::int`,
        newC: sql<number>`count(*) filter (where ${competitorCandidates.status} = 'new')::int`,
        added: sql<number>`count(*) filter (where ${competitorCandidates.status} = 'added')::int`,
        dismissed: sql<number>`count(*) filter (where ${competitorCandidates.status} = 'dismissed')::int`,
        avgOverlap: sql<number>`coalesce(round(avg(${competitorCandidates.overlapScore})::numeric, 1), 0)`,
      })
      .from(competitorCandidates)
      .where(gte(competitorCandidates.firstSeenAt, thirtyDaysAgo)),
    db
      .select({
        source: competitorCandidates.source,
        total: sql<number>`count(*)::int`,
        added: sql<number>`count(*) filter (where ${competitorCandidates.status} = 'added')::int`,
        dismissed: sql<number>`count(*) filter (where ${competitorCandidates.status} = 'dismissed')::int`,
      })
      .from(competitorCandidates)
      .where(gte(competitorCandidates.firstSeenAt, thirtyDaysAgo))
      .groupBy(competitorCandidates.source),
    db
      .select({
        detectThisMonth: sql<number>`coalesce(sum(case when ${discoveryRuns.detectCountMonth} = ${monthKey} then ${discoveryRuns.detectCount} else 0 end),0)::int`,
        activeOrgs: sql<number>`count(distinct ${discoveryRuns.orgId}) filter (where ${discoveryRuns.detectCountMonth} = ${monthKey} and ${discoveryRuns.detectCount} > 0)::int`,
      })
      .from(discoveryRuns),
    db
      .select({
        url: competitorCandidates.url,
        title: competitorCandidates.title,
        overlapScore: competitorCandidates.overlapScore,
        status: competitorCandidates.status,
        source: competitorCandidates.source,
        firstSeenAt: competitorCandidates.firstSeenAt,
      })
      .from(competitorCandidates)
      .orderBy(desc(competitorCandidates.firstSeenAt))
      .limit(15),
  ]);

  const a = agg[0];
  const decided = (a?.added ?? 0) + (a?.dismissed ?? 0);
  return c.json({
    windowDays: 30,
    candidates: {
      total: a?.total ?? 0,
      new: a?.newC ?? 0,
      added: a?.added ?? 0,
      dismissed: a?.dismissed ?? 0,
      acceptanceRate: rate(a?.added ?? 0, decided),
      avgOverlap: Number(a?.avgOverlap ?? 0),
    },
    bySource: bySource.map((r) => ({
      source: r.source,
      total: r.total,
      added: r.added,
      dismissed: r.dismissed,
      acceptanceRate: rate(r.added, r.added + r.dismissed),
    })),
    discovery: {
      month: monthKey,
      detectThisMonth: discovery[0]?.detectThisMonth ?? 0,
      activeOrgs: discovery[0]?.activeOrgs ?? 0,
    },
    recent: recent.map((r) => ({
      url: r.url,
      title: r.title,
      overlapScore: r.overlapScore,
      status: r.status,
      source: r.source,
      firstSeenAt: r.firstSeenAt?.toISOString() ?? null,
    })),
  });
});
