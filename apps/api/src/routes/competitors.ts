import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq, gte, isNull, isNotNull, ne, inArray, sql } from "drizzle-orm";
import { tasks } from "@trigger.dev/sdk/v3";
import {
  competitors,
  monitors,
  changes,
  signals,
  snapshots,
  jobPostings,
  reviews,
  techStackEntries,
} from "@outrival/db";
import { db } from "../lib/db";
import { authMiddleware } from "../middleware/auth";
import { ensureUserOrg } from "../lib/org";
import { associateCompetitorWithPrimaryProduct } from "../lib/products";
import { chQuery } from "../lib/clickhouse-safe";
import {
  checkCompetitorQuota,
  getOrgPlan,
  isSourceAllowed,
  isFrequencyAllowed,
} from "../lib/plan";
import {
  SOURCE_TYPES,
  MONITOR_FREQUENCIES,
  PRICING_STATUSES,
  isReviewSource,
  validateMonitorUrl,
  aggregateFreshness,
  type SourceType,
  type MonitorFrequency,
} from "@outrival/shared";

type Variables = { user: { id: string } };

export const competitorsRouter = new Hono<{ Variables: Variables }>();

competitorsRouter.use("*", authMiddleware);

const CreateCompetitorSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  description: z.string().optional(),
});

async function assertOwnedCompetitor(competitorId: string, orgId: string) {
  return db.query.competitors.findFirst({
    where: and(eq(competitors.id, competitorId), eq(competitors.orgId, orgId)),
  });
}

// Subset of @outrival/scrapers' HomepageStructure we read off the snapshot jsonb.
// The API can't import the scrapers package (monorepo boundary), so the shape the
// parser produces (patch-16/17) is restated here for the fields the fact sheet needs.
type StoredHomepage = {
  hero?: { headline?: string | null; subheadline?: string | null };
  sections?: Array<{ heading?: string; type?: string }>;
  socialProof?: {
    customerLogos?: string[];
    testimonials?: Array<{ quote?: string; author?: string | null }>;
  };
};

// "Fact sheet" / state view of a competitor (Overview tab): the current homepage
// facts we capture but never surfaced — positioning, value props, customers,
// numeric claims — plus a compact snapshot of pricing/hiring/reviews. Pure
// surfacing of existing data: no AI call, no scrape. ClickHouse reads are bounded
// (return [] when CH is down), so the fact sheet degrades gracefully.
async function buildOverview(
  competitorId: string,
  monitorList: Array<{ id: string; sourceType: string }>,
) {
  // Positioning + value props + social proof from the latest homepage snapshot's
  // parsed structure (only homepage snapshots carry it; null pre-patch).
  let capturedAt: Date | null = null;
  let homepage: {
    headline: string | null;
    subheadline: string | null;
    valueProps: string[];
    customerLogos: string[];
    testimonials: Array<{ quote: string; author: string | null }>;
  } | null = null;

  const homepageMonitor = monitorList.find((m) => m.sourceType === "homepage");
  if (homepageMonitor) {
    const [snap] = await db
      .select({ structure: snapshots.homepageStructure, scrapedAt: snapshots.scrapedAt })
      .from(snapshots)
      .where(
        and(
          eq(snapshots.monitorId, homepageMonitor.id),
          eq(snapshots.status, "success"),
          isNotNull(snapshots.homepageStructure),
        ),
      )
      .orderBy(desc(snapshots.scrapedAt))
      .limit(1);
    if (snap?.structure) {
      const s = snap.structure as StoredHomepage;
      capturedAt = snap.scrapedAt;
      homepage = {
        headline: s.hero?.headline ?? null,
        subheadline: s.hero?.subheadline ?? null,
        // Section headings carrying the value proposition (feature blocks and
        // integration showcases), in document order, capped for the glance.
        valueProps: (s.sections ?? [])
          .filter((sec) => sec.type === "features" || sec.type === "integrations")
          .map((sec) => sec.heading?.trim() ?? "")
          .filter((h) => h.length > 0)
          .slice(0, 8),
        customerLogos: (s.socialProof?.customerLogos ?? [])
          .map((l) => l.trim())
          .filter((l) => l.length > 0)
          .slice(0, 24),
        testimonials: (s.socialProof?.testimonials ?? [])
          .map((t) => ({ quote: t.quote?.trim() ?? "", author: t.author ?? null }))
          .filter((t) => t.quote.length > 0)
          .slice(0, 3),
      };
    }
  }

  const numericClaims = await chQuery<{
    pattern: string;
    value: number | null;
    unit: string | null;
    raw_text: string;
  }>({
    query: `
      SELECT pattern,
             argMax(value, observed_at) AS value,
             argMax(unit, observed_at) AS unit,
             argMax(raw_text, observed_at) AS raw_text
      FROM numeric_claims
      WHERE competitor_id = {competitorId: String}
        AND observed_at >= now() - INTERVAL 90 DAY
      GROUP BY pattern
      ORDER BY max(observed_at) DESC
      LIMIT 8
    `,
    params: { competitorId },
  });

  // Current tier set = the most recent recorded_at batch for this competitor.
  const pricingNow = await chQuery<{
    plan_name: string;
    price: number;
    currency: string;
    billing_period: string;
  }>({
    query: `
      SELECT plan_name, price, currency, billing_period
      FROM pricing_history
      WHERE competitor_id = {competitorId: String}
        AND recorded_at = (
          SELECT max(recorded_at) FROM pricing_history
          WHERE competitor_id = {competitorId: String}
        )
      ORDER BY price ASC
    `,
    params: { competitorId },
  });

  const reviews = await chQuery<{
    source: string;
    score: number;
    review_count: number;
    sentiment_score: number;
  }>({
    query: `
      SELECT source,
             argMax(score, recorded_at) AS score,
             argMax(review_count, recorded_at) AS review_count,
             argMax(sentiment_score, recorded_at) AS sentiment_score
      FROM review_scores
      WHERE competitor_id = {competitorId: String}
      GROUP BY source
      ORDER BY max(recorded_at) DESC
    `,
    params: { competitorId },
  });

  const [hiringRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(jobPostings)
    .where(and(eq(jobPostings.competitorId, competitorId), eq(jobPostings.isActive, true)));

  return {
    capturedAt,
    homepage,
    numericClaims,
    pricingNow,
    reviews,
    hiring: { openRoles: hiringRow?.count ?? 0 },
  };
}

competitorsRouter.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = CreateCompetitorSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);

  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const plan = await getOrgPlan(orgId);
  const quota = await checkCompetitorQuota(orgId, plan);
  if (!quota.allowed) {
    return c.json(
      { error: "plan_limit_competitors", used: quota.used, limit: quota.limit, plan },
      403,
    );
  }

  const [competitor] = await db
    .insert(competitors)
    .values({
      orgId,
      name: parsed.data.name,
      url: parsed.data.url,
      description: parsed.data.description ?? null,
    })
    .returning();
  if (!competitor) return c.json({ error: "Failed to create competitor" }, 500);

  // patch-28 — tag this competitor into the org's primary product so its signals
  // show in that product's feed (shared; reclassify/attach to others from the UI).
  await associateCompetitorWithPrimaryProduct(orgId, competitor.id);

  const createdMonitors = await db
    .insert(monitors)
    .values([
      { competitorId: competitor.id, sourceType: "homepage", frequency: "daily" },
      { competitorId: competitor.id, sourceType: "pricing", frequency: "daily" },
      { competitorId: competitor.id, sourceType: "blog", frequency: "weekly" },
    ])
    .returning();

  return c.json({ competitor, monitors: createdMonitors }, 201);
});

const AddMonitorSchema = z.object({
  sourceType: z.enum(SOURCE_TYPES),
  frequency: z.enum(MONITOR_FREQUENCIES).optional(),
  // Required for review sources (g2/capterra/appstore): the exact review-page
  // URL. Validated + host-locked below.
  url: z.string().optional(),
});

// Slow-changing review sources default to weekly; everything else daily.
// Clamped to a plan-allowed frequency below (weekly is allowed on every plan).
function defaultFrequencyFor(source: SourceType): MonitorFrequency {
  return source.endsWith("_reviews") ? "weekly" : "daily";
}

competitorsRouter.post("/:id/monitors", async (c) => {
  const competitorId = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const parsed = AddMonitorSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);

  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const competitor = await assertOwnedCompetitor(competitorId, orgId);
  if (!competitor || competitor.deletedAt) return c.json({ error: "Competitor not found" }, 404);

  const { sourceType } = parsed.data;
  // tech_stack is an internal anchor source (patch-18), not user-enableable.
  if (sourceType === "tech_stack") {
    return c.json({ error: "source_not_enableable", source: sourceType }, 400);
  }
  const plan = await getOrgPlan(orgId);
  if (!isSourceAllowed(plan, sourceType)) {
    return c.json({ error: "plan_locked_source", source: sourceType, plan }, 403);
  }

  // Review sources scrape a specific review page (not the homepage), so they
  // require an explicit URL. Every other source accepts an OPTIONAL URL override
  // — when absent, the scraper auto-discovers the page (e.g. /pricing). Both are
  // host-locked (SSRF + correctness) via validateMonitorUrl.
  let config: { url: string } | undefined;
  if (isReviewSource(sourceType) && !parsed.data.url) {
    return c.json({ error: "review_url_required", source: sourceType }, 400);
  }
  if (parsed.data.url) {
    const valid = validateMonitorUrl(sourceType, parsed.data.url, competitor.url);
    if (!valid.ok) {
      return c.json({ error: "invalid_monitor_url", reason: valid.error, source: sourceType }, 400);
    }
    config = { url: valid.url };
  }

  const desired = parsed.data.frequency ?? defaultFrequencyFor(sourceType);
  const frequency: MonitorFrequency = isFrequencyAllowed(plan, desired) ? desired : "weekly";

  // Idempotent: one monitor per (competitor, source). When re-enabling a review
  // source with a corrected URL, update the stored config rather than no-op.
  const existing = await db.query.monitors.findFirst({
    where: and(eq(monitors.competitorId, competitorId), eq(monitors.sourceType, sourceType)),
  });
  if (existing) {
    const currentUrl =
      existing.config && typeof existing.config === "object" && "url" in existing.config
        ? String((existing.config as { url: unknown }).url)
        : null;
    if (config && config.url !== currentUrl) {
      const [updated] = await db
        .update(monitors)
        .set({ config })
        .where(eq(monitors.id, existing.id))
        .returning();
      return c.json({ monitor: updated ?? existing, created: false });
    }
    return c.json({ monitor: existing, created: false });
  }

  const [monitor] = await db
    .insert(monitors)
    .values({ competitorId, sourceType, frequency, config })
    .returning();
  if (!monitor) return c.json({ error: "Failed to create monitor" }, 500);

  return c.json({ monitor, created: true }, 201);
});

competitorsRouter.get("/", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const list = await db.query.competitors.findMany({
    // Exclude the self-competitor (the user's own product) — it has its own page.
    where: and(
      eq(competitors.orgId, orgId),
      isNull(competitors.deletedAt),
      ne(competitors.type, "self"),
    ),
    orderBy: desc(competitors.createdAt),
  });

  if (list.length === 0) return c.json({ competitors: [] });

  const now = Date.now();
  const day = 24 * 3600 * 1000;
  const sevenDaysAgo = new Date(now - 7 * day);
  const fourteenDaysAgo = new Date(now - 14 * day);
  const sevenIso = sevenDaysAgo.toISOString();
  const fourteenIso = fourteenDaysAgo.toISOString();

  const aggregates = await db
    .select({
      competitorId: signals.competitorId,
      signals7d: sql<number>`count(*) filter (where ${signals.createdAt} >= ${sevenIso}::timestamp)::int`,
      signalsPrev: sql<number>`count(*) filter (where ${signals.createdAt} >= ${fourteenIso}::timestamp and ${signals.createdAt} < ${sevenIso}::timestamp)::int`,
      lastSignalAt: sql<string | null>`max(${signals.createdAt})`,
      catPricing: sql<number>`count(*) filter (where ${signals.createdAt} >= ${sevenIso}::timestamp and ${signals.category} = 'pricing')::int`,
      catProduct: sql<number>`count(*) filter (where ${signals.createdAt} >= ${sevenIso}::timestamp and ${signals.category} = 'product')::int`,
      catHiring: sql<number>`count(*) filter (where ${signals.createdAt} >= ${sevenIso}::timestamp and ${signals.category} = 'hiring')::int`,
      catReviews: sql<number>`count(*) filter (where ${signals.createdAt} >= ${sevenIso}::timestamp and ${signals.category} = 'reviews')::int`,
      catContent: sql<number>`count(*) filter (where ${signals.createdAt} >= ${sevenIso}::timestamp and ${signals.category} = 'content')::int`,
      catFunding: sql<number>`count(*) filter (where ${signals.createdAt} >= ${sevenIso}::timestamp and ${signals.category} = 'funding')::int`,
    })
    .from(signals)
    .where(
      and(
        eq(signals.orgId, orgId),
        gte(signals.createdAt, fourteenDaysAgo),
      ),
    )
    .groupBy(signals.competitorId);

  const byCompetitor = new Map(aggregates.map((a) => [a.competitorId, a]));

  // Per-competitor freshness for the global list dot (patch-14). A competitor is
  // only as fresh as its STALEST active source, and a failed last scan wins. We
  // ship the (lastScrapedAt, status) pair the FreshnessDot expects and let the
  // shared computeFreshness derive the level client-side.
  const monitorRows = await db
    .select({
      competitorId: monitors.competitorId,
      lastRunAt: monitors.lastRunAt,
      lastFailedAt: monitors.lastFailedAt,
    })
    .from(monitors)
    .where(
      and(
        inArray(
          monitors.competitorId,
          list.map((c) => c.id),
        ),
        eq(monitors.isActive, true),
      ),
    );

  const monitorsByCompetitor = new Map<string, typeof monitorRows>();
  for (const m of monitorRows) {
    const arr = monitorsByCompetitor.get(m.competitorId) ?? [];
    arr.push(m);
    monitorsByCompetitor.set(m.competitorId, arr);
  }

  const enriched = list.map((c) => {
    const a = byCompetitor.get(c.id);
    const freshness =
      aggregateFreshness(monitorsByCompetitor.get(c.id) ?? []) ??
      ({ lastScrapedAt: null, status: "success" } as const);
    return {
      ...c,
      freshness,
      stats: {
        signals7d: a?.signals7d ?? 0,
        signalsPrev: a?.signalsPrev ?? 0,
        lastSignalAt: a?.lastSignalAt ?? null,
        categoryCounts: {
          pricing: a?.catPricing ?? 0,
          product: a?.catProduct ?? 0,
          hiring: a?.catHiring ?? 0,
          reviews: a?.catReviews ?? 0,
          content: a?.catContent ?? 0,
          funding: a?.catFunding ?? 0,
        },
      },
    };
  });

  return c.json({ competitors: enriched });
});

competitorsRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const competitor = await assertOwnedCompetitor(id, orgId);
  if (!competitor) return c.json({ error: "Not found" }, 404);

  // Org plan ships with the detail payload so the UI can gate per-source actions
  // (e.g. lock review sources the plan doesn't include) without a second roundtrip.
  const plan = await getOrgPlan(orgId);

  const allMonitors = await db.query.monitors.findMany({
    where: eq(monitors.competitorId, competitor.id),
  });
  // Hide the tech_stack anchor monitor (patch-18) — it's infra, not a user-facing
  // source. Tech stack surfaces as its own read-only tab; the dev-only manual scan
  // (POST /api/dev/competitors/:id/scrape-tech-stack) drives a synthetic Sources
  // row, so the anchor monitor never needs to appear here.
  const monitorList = allMonitors.filter((m) => m.sourceType !== "tech_stack");

  const monitorIds = monitorList.map((m) => m.id);
  const recentChanges = monitorIds.length
    ? await db
        .select({
          id: changes.id,
          diffText: changes.diffText,
          summary: changes.summary,
          detectedAt: changes.detectedAt,
          monitorId: changes.monitorId,
          sourceType: monitors.sourceType,
          // resolved_url is the exact page the scraper landed on (it discovers
          // /pricing, /tarifs… from the homepage), so it's the right "View page"
          // target. config.url is only set when the user pinned a URL manually.
          monitorUrl: sql<string | null>`COALESCE(${snapshots.resolvedUrl}, ${monitors.config}->>'url')`,
        })
        .from(changes)
        .innerJoin(monitors, eq(monitors.id, changes.monitorId))
        .leftJoin(snapshots, eq(snapshots.id, changes.snapshotAfterId))
        .where(inArray(changes.monitorId, monitorIds))
        .orderBy(desc(changes.detectedAt))
        .limit(20)
    : [];

  const recentSignals = await db
    .select({
      id: signals.id,
      severity: signals.severity,
      category: signals.category,
      insight: signals.insight,
      soWhat: signals.soWhat,
      recommendedAction: signals.recommendedAction,
      isRead: signals.isRead,
      createdAt: signals.createdAt,
      changeId: signals.changeId,
      sourceType: monitors.sourceType,
      monitorUrl: sql<string | null>`COALESCE(${snapshots.resolvedUrl}, ${monitors.config}->>'url')`,
    })
    .from(signals)
    .leftJoin(changes, eq(changes.id, signals.changeId))
    .leftJoin(monitors, eq(monitors.id, changes.monitorId))
    .leftJoin(snapshots, eq(snapshots.id, changes.snapshotAfterId))
    .where(eq(signals.competitorId, competitor.id))
    .orderBy(desc(signals.createdAt))
    .limit(20);

  // Detected tech stack (patch-18): current (active) entries for the profile
  // section, plus the last scrape time for the freshness dot. Grouped client-side.
  const techRows = await db.query.techStackEntries.findMany({
    where: and(
      eq(techStackEntries.competitorId, competitor.id),
      eq(techStackEntries.isActive, true),
    ),
  });
  const techStack = {
    entries: techRows.map((t) => ({
      techId: t.techId,
      name: t.techName,
      category: t.category,
      importance: t.importance,
      firstDetectedAt: t.firstDetectedAt,
      lastDetectedAt: t.lastDetectedAt,
    })),
    lastScrapedAt: competitor.techStackScrapedAt,
  };

  const overview = await buildOverview(competitor.id, monitorList);

  return c.json({
    competitor,
    monitors: monitorList,
    recentChanges,
    recentSignals,
    techStack,
    overview,
    plan,
  });
});

competitorsRouter.get("/:id/signals", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const competitor = await assertOwnedCompetitor(id, orgId);
  if (!competitor) return c.json({ error: "Not found" }, 404);

  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
  const rows = await db
    .select({
      id: signals.id,
      severity: signals.severity,
      category: signals.category,
      insight: signals.insight,
      soWhat: signals.soWhat,
      recommendedAction: signals.recommendedAction,
      isRead: signals.isRead,
      createdAt: signals.createdAt,
      changeId: signals.changeId,
    })
    .from(signals)
    .where(eq(signals.competitorId, competitor.id))
    .orderBy(desc(signals.createdAt))
    .limit(limit);

  return c.json({ signals: rows });
});

competitorsRouter.get("/:id/jobs", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const competitor = await assertOwnedCompetitor(id, orgId);
  if (!competitor) return c.json({ error: "Not found" }, 404);

  const all = await db.query.jobPostings.findMany({
    where: and(eq(jobPostings.competitorId, competitor.id), eq(jobPostings.isActive, true)),
    orderBy: desc(jobPostings.detectedAt),
  });

  const byDepartment = new Map<string, typeof all>();
  for (const job of all) {
    const key = job.department ?? "Other";
    const arr = byDepartment.get(key) ?? [];
    arr.push(job);
    byDepartment.set(key, arr);
  }

  return c.json({
    total: all.length,
    departments: Array.from(byDepartment.entries()).map(([department, jobs]) => ({
      department,
      count: jobs.length,
      jobs,
    })),
  });
});

competitorsRouter.get("/:id/job-trends", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const competitor = await assertOwnedCompetitor(id, orgId);
  if (!competitor) return c.json({ error: "Not found" }, 404);

  const rows = await chQuery<{
    department: string;
    count: number;
    recorded_at: string;
  }>({
    query: `
      SELECT department, count, toString(recorded_at) AS recorded_at
      FROM job_counts
      WHERE competitor_id = {competitorId: String}
        AND job_counts.recorded_at >= now() - INTERVAL 90 DAY
      ORDER BY job_counts.recorded_at ASC
    `,
    params: { competitorId: competitor.id },
  });

  return c.json({ trends: rows });
});

competitorsRouter.get("/:id/reviews", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const competitor = await assertOwnedCompetitor(id, orgId);
  if (!competitor) return c.json({ error: "Not found" }, 404);

  const rows = await db.query.reviews.findMany({
    where: eq(reviews.competitorId, competitor.id),
    orderBy: desc(reviews.detectedAt),
    limit: 60,
  });

  const praises = rows.filter((r) => r.author === "praise");
  const complaints = rows.filter((r) => r.author === "complaint");
  const recent = rows.slice(0, 30);

  return c.json({
    summary: {
      praises: praises.slice(0, 5).map((r) => r.content),
      complaints: complaints.slice(0, 5).map((r) => r.content),
      lastUpdatedAt: rows[0]?.detectedAt ?? null,
    },
    recent,
  });
});

competitorsRouter.get("/:id/review-scores", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const competitor = await assertOwnedCompetitor(id, orgId);
  if (!competitor) return c.json({ error: "Not found" }, 404);

  const rows = await chQuery<{
    source: string;
    score: number;
    review_count: number;
    sentiment_score: number;
    recorded_at: string;
  }>({
    query: `
      SELECT source, score, review_count, sentiment_score, toString(recorded_at) AS recorded_at
      FROM review_scores
      WHERE competitor_id = {competitorId: String}
        AND review_scores.recorded_at >= now() - INTERVAL 180 DAY
      ORDER BY review_scores.recorded_at ASC
    `,
    params: { competitorId: competitor.id },
  });

  return c.json({ scores: rows });
});

competitorsRouter.get("/:id/pricing-history", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const competitor = await assertOwnedCompetitor(id, orgId);
  if (!competitor) return c.json({ error: "Not found" }, 404);

  const rows = await chQuery<{
    plan_name: string;
    price: number;
    currency: string;
    billing_period: string;
    recorded_at: string;
  }>({
    query: `
      SELECT plan_name, price, currency, billing_period, toString(recorded_at) AS recorded_at
      FROM pricing_history
      WHERE competitor_id = {competitorId: String}
      ORDER BY pricing_history.recorded_at ASC
    `,
    params: { competitorId: competitor.id },
  });

  return c.json({ history: rows });
});

const PricingOverrideSchema = z.object({
  status: z.enum(PRICING_STATUSES),
  demoUrl: z.string().url().nullable().optional(),
  note: z.string().max(500).nullable().optional(),
});

// Manual override: the user fills pricing in by hand (typically after an
// "unknown" auto-detection). Sets pricingManualOverride so scrapes stop
// overwriting it.
competitorsRouter.put("/:id/pricing", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const competitor = await assertOwnedCompetitor(id, orgId);
  if (!competitor) return c.json({ error: "Not found" }, 404);

  const body = PricingOverrideSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: "Invalid body" }, 400);

  await db
    .update(competitors)
    .set({
      pricingStatus: body.data.status,
      pricingDemoUrl: body.data.demoUrl ?? null,
      pricingNote: body.data.note ?? null,
      pricingManualOverride: true,
      updatedAt: new Date(),
    })
    .where(eq(competitors.id, id));
  return c.json({ ok: true });
});

// Hand pricing back to auto-detection and re-scrape now if a pricing monitor exists.
competitorsRouter.post("/:id/pricing/redetect", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const competitor = await assertOwnedCompetitor(id, orgId);
  if (!competitor) return c.json({ error: "Not found" }, 404);

  await db
    .update(competitors)
    .set({ pricingManualOverride: false, updatedAt: new Date() })
    .where(eq(competitors.id, id));

  const pricingMonitor = await db.query.monitors.findFirst({
    where: and(eq(monitors.competitorId, id), eq(monitors.sourceType, "pricing")),
  });
  if (pricingMonitor) {
    await tasks.trigger("scrape-monitor", { monitorId: pricingMonitor.id, force: true });
  }
  return c.json({ ok: true, rescraped: Boolean(pricingMonitor) });
});

competitorsRouter.post("/:id/refresh-summary", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const competitor = await assertOwnedCompetitor(id, orgId);
  if (!competitor) return c.json({ error: "Not found" }, 404);

  const handle = await tasks.trigger("refresh-competitor-summary", {
    competitorId: id,
  });
  return c.json({ runId: handle.id });
});

competitorsRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const competitor = await assertOwnedCompetitor(id, orgId);
  if (!competitor) return c.json({ error: "Not found" }, 404);

  await db.update(competitors).set({ deletedAt: new Date() }).where(eq(competitors.id, id));
  return c.json({ ok: true });
});
