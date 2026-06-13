import { Hono } from "hono";
import { z } from "zod";
import { and, asc, desc, eq, gte, isNull, isNotNull, ne, inArray, sql } from "drizzle-orm";
import { captureServerEvent } from "../lib/posthog";
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
  organizations,
  products,
  productCompetitors,
} from "@outrival/db";
import { scoreOverlap } from "@outrival/ai";
import { db } from "../lib/db";
import { authMiddleware } from "../middleware/auth";
import { aiIntensiveRateLimit } from "../middleware/ai-intensive-rate-limit";
import { ensureUserOrg } from "../lib/org";
import { associateCompetitorWithPrimaryProduct } from "../lib/products";
import { analyticsQuery } from "../lib/analytics-safe";
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
  validatePublicUrl,
  aggregateFreshness,
  computeNextScanAt,
  TECH_STACK_SCRAPE_INTERVAL_DAYS,
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
    // Legacy snapshots stored a single string (alt || src); patch stores objects.
    customerLogos?: Array<string | { name?: string | null; src?: string | null }>;
    testimonials?: Array<{ quote?: string; author?: string | null }>;
  };
};

// A captured customer logo surfaced to the fact sheet: brand name and/or absolute
// image URL. Old string-shaped entries are mapped into this by `toLogo` below.
type FactSheetLogo = { name: string | null; src: string | null };

function toLogo(entry: string | { name?: string | null; src?: string | null }): FactSheetLogo {
  if (typeof entry === "string") {
    const v = entry.trim();
    // Legacy single string was alt-or-src: an absolute URL is the image, else a name.
    return /^(https?:\/\/|data:image\/)/i.test(v)
      ? { name: null, src: v }
      : { name: v || null, src: null };
  }
  return { name: entry.name?.trim() || null, src: entry.src?.trim() || null };
}

// "Fact sheet" / state view of a competitor (Overview tab): the current homepage
// facts we capture but never surfaced — positioning, value props, customers,
// numeric claims — plus a compact snapshot of pricing/hiring/reviews. Pure
// surfacing of existing data: no AI call, no scrape. Analytics reads are
// best-effort (return [] on error), so the fact sheet degrades gracefully.
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
    customerLogos: FactSheetLogo[];
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
          .map(toLogo)
          .filter((l) => l.name || l.src)
          .slice(0, 24),
        testimonials: (s.socialProof?.testimonials ?? [])
          .map((t) => ({ quote: t.quote?.trim() ?? "", author: t.author ?? null }))
          .filter((t) => t.quote.length > 0)
          .slice(0, 3),
      };
    }
  }

  const numericClaims = await analyticsQuery<{
    pattern: string;
    value: number | null;
    unit: string | null;
    raw_text: string;
  }>(sql`
    SELECT pattern, value, unit, raw_text
    FROM (
      SELECT DISTINCT ON (pattern) pattern, value, unit, raw_text, observed_at
      FROM numeric_claims
      WHERE competitor_id = ${competitorId}
        AND observed_at >= now() - make_interval(days => 90)
      ORDER BY pattern, observed_at DESC
    ) t
    ORDER BY observed_at DESC
    LIMIT 8
  `);

  // Current tier set = the most recent recorded_at batch for this competitor.
  const pricingNow = await analyticsQuery<{
    plan_name: string;
    price: number;
    currency: string;
    billing_period: string;
  }>(sql`
    SELECT plan_name, price, currency, billing_period
    FROM pricing_history
    WHERE competitor_id = ${competitorId}
      AND recorded_at = (
        SELECT max(recorded_at) FROM pricing_history
        WHERE competitor_id = ${competitorId}
      )
    ORDER BY price ASC
  `);

  const reviews = await analyticsQuery<{
    source: string;
    score: number;
    review_count: number;
    sentiment_score: number;
  }>(sql`
    SELECT source, score, review_count, sentiment_score
    FROM (
      SELECT DISTINCT ON (source) source, score, review_count, sentiment_score, recorded_at
      FROM review_scores
      WHERE competitor_id = ${competitorId}
      ORDER BY source, recorded_at DESC
    ) t
    ORDER BY recorded_at DESC
  `);

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

  // SSRF: this URL becomes the homepage monitor target the scraper fetches
  // directly, so reject IP literals / internal hosts before it's persisted.
  const safeUrl = validatePublicUrl(parsed.data.url);
  if (!safeUrl.ok) return c.json({ error: "invalid_url", reason: safeUrl.error }, 400);

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
      url: safeUrl.url,
      description: parsed.data.description ?? null,
    })
    .returning();
  if (!competitor) return c.json({ error: "Failed to create competitor" }, 500);

  // patch-28 — tag this competitor into the org's primary product so its signals
  // show in that product's feed (shared; reclassify/attach to others from the UI).
  await associateCompetitorWithPrimaryProduct(orgId, competitor.id);

  // patch-31 — detect the platform profile (fire-and-forget) so the first scrapes
  // can route via structured connectors. Never blocks the create.
  try {
    await tasks.trigger("detect-platform", { competitorId: competitor.id });
  } catch (e) {
    console.error("Failed to trigger platform detection", {
      competitorId: competitor.id,
      error: String(e),
    });
  }

  const createdMonitors = await db
    .insert(monitors)
    .values([
      { competitorId: competitor.id, sourceType: "homepage", frequency: "daily" },
      { competitorId: competitor.id, sourceType: "pricing", frequency: "daily" },
      { competitorId: competitor.id, sourceType: "blog", frequency: "weekly" },
      // patch-32: internal sitemap-diff anchor (weekly). Not user-facing; the diff
      // of its sorted URL-list snapshot surfaces brand-new competitor pages.
      { competitorId: competitor.id, sourceType: "sitemap", frequency: "weekly" },
      // Internal news/funding anchor (weekly). Google News RSS by brand → diff
      // surfaces company-level events (funding/M&A/leadership/press).
      { competitorId: competitor.id, sourceType: "news", frequency: "weekly" },
    ])
    .returning();

  void captureServerEvent(user.id, "competitor_added", {
    competitorId: competitor.id,
    competitorName: competitor.name,
    orgId,
  });

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
  // tech_stack (patch-18), sitemap (patch-32) and news are internal anchor
  // sources, not user-enableable.
  if (sourceType === "tech_stack" || sourceType === "sitemap" || sourceType === "news") {
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

  void captureServerEvent(user.id, "monitor_enabled", {
    competitorId,
    sourceType,
    frequency,
    orgId,
  });

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
  // Hide internal anchor monitors — they're infra, not user-facing sources:
  // tech_stack (patch-18, surfaced as its own read-only tab), sitemap (patch-32,
  // a discovery anchor whose URL-diff feeds signals) and news (Google News RSS
  // anchor whose diff feeds funding/company signals) — never a Sources row.
  const monitorList = allMonitors.filter(
    (m) =>
      m.sourceType !== "tech_stack" && m.sourceType !== "sitemap" && m.sourceType !== "news",
  );

  const monitorIds = monitorList.map((m) => m.id);
  const recentChanges = monitorIds.length
    ? await db
        .select({
          id: changes.id,
          // Preview renders ≤18 lines — cap the payload (rows run up to 50KB).
          diffText: sql<string | null>`left(${changes.diffText}, 4000)`,
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
    // When the next monthly tech-stack scan is due (patch-18). Derived, not stored:
    // the scan is interval-driven on techStackScrapedAt, not a monitor with a
    // nextRunAt. Null when never scanned (UI shows an ETA instead). Same interval
    // (env override + shared default) the worker enqueues on, so they never drift.
    nextScanAt: computeNextScanAt(
      competitor.techStackScrapedAt,
      Number(
        process.env.TECH_STACK_SCRAPE_INTERVAL_DAYS ?? TECH_STACK_SCRAPE_INTERVAL_DAYS,
      ),
    ),
    // Auto-detected platform profile (patch-31): framework / CMS / ATS / status
    // page / changelog / pricing widget. Detected for routing, surfaced read-only
    // here next to the third-party tech. Null when never detected.
    platformProfile: competitor.platformProfile,
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

  const rows = await analyticsQuery<{
    department: string;
    count: number;
    recorded_at: string;
  }>(sql`
    SELECT department, count, recorded_at::text AS recorded_at
    FROM job_counts
    WHERE competitor_id = ${competitor.id}
      AND recorded_at >= now() - make_interval(days => 90)
    ORDER BY recorded_at ASC
  `);

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

  // Latest per-criterion breakdown (patch-32). Persisted on review_scores but never
  // surfaced until now — take the most recent scrape that actually carried a
  // breakdown (G2/Capterra expose it; App Store doesn't). Best-effort.
  const [subRow] = await analyticsQuery<{
    easeOfUse: number | null;
    support: number | null;
    features: number | null;
    value: number | null;
  }>(sql`
    SELECT sub_ease_of_use AS "easeOfUse", sub_support AS "support",
           sub_features AS "features", sub_value AS "value"
    FROM review_scores
    WHERE competitor_id = ${competitor.id}
      AND (sub_ease_of_use IS NOT NULL OR sub_support IS NOT NULL
           OR sub_features IS NOT NULL OR sub_value IS NOT NULL)
    ORDER BY recorded_at DESC
    LIMIT 1
  `);

  // Recurring complaint themes (gap-B): the latest scrape that clustered any. Cast
  // to text + parse so it's driver-agnostic. Each theme = a competitive opening.
  const [themeRow] = await analyticsQuery<{ themes: string | null }>(sql`
    SELECT complaint_themes::text AS themes
    FROM review_scores
    WHERE competitor_id = ${competitor.id} AND complaint_themes IS NOT NULL
    ORDER BY recorded_at DESC
    LIMIT 1
  `);
  let complaintThemes: Array<{ theme: string; prevalence: string }> = [];
  if (themeRow?.themes) {
    try {
      const parsed = JSON.parse(themeRow.themes);
      if (Array.isArray(parsed)) complaintThemes = parsed;
    } catch {
      complaintThemes = [];
    }
  }

  return c.json({
    summary: {
      praises: praises.slice(0, 5).map((r) => r.content),
      complaints: complaints.slice(0, 5).map((r) => r.content),
      lastUpdatedAt: rows[0]?.detectedAt ?? null,
      subScores: subRow ?? null,
      complaintThemes,
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

  const rows = await analyticsQuery<{
    source: string;
    score: number;
    review_count: number;
    sentiment_score: number;
    recorded_at: string;
  }>(sql`
    SELECT source, score, review_count, sentiment_score, recorded_at::text AS recorded_at
    FROM review_scores
    WHERE competitor_id = ${competitor.id}
      AND recorded_at >= now() - make_interval(days => 180)
    ORDER BY recorded_at ASC
  `);

  return c.json({ scores: rows });
});

competitorsRouter.get("/:id/pricing-history", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const competitor = await assertOwnedCompetitor(id, orgId);
  if (!competitor) return c.json({ error: "Not found" }, 404);

  const rows = await analyticsQuery<{
    plan_name: string;
    price: number;
    currency: string;
    billing_period: string;
    recorded_at: string;
  }>(sql`
    SELECT plan_name, price, currency, billing_period, recorded_at::text AS recorded_at
    FROM pricing_history
    WHERE competitor_id = ${competitor.id}
    ORDER BY recorded_at ASC
  `);

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

competitorsRouter.post("/:id/refresh-summary", aiIntensiveRateLimit, async (c) => {
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

// Edit the competitor's display fields (kebab → Edit details). Name/url/category/
// description are user-correctable — scrapes don't own these. url is SSRF-validated
// below (it's what the homepage monitor fetches), the rest are free text.
const UpdateCompetitorSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    url: z.string().url().max(2048).optional(),
    category: z.string().max(100).nullable().optional(),
    description: z.string().max(2000).nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "No fields to update" });

competitorsRouter.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const competitor = await assertOwnedCompetitor(id, orgId);
  if (!competitor || competitor.deletedAt) return c.json({ error: "Not found" }, 404);

  const parsed = UpdateCompetitorSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);

  // SSRF: the scraper fetches competitor.url directly, so host-check any new url
  // (IP literals / internal hosts) before it's persisted.
  if (parsed.data.url !== undefined) {
    const safeUrl = validatePublicUrl(parsed.data.url);
    if (!safeUrl.ok) return c.json({ error: "invalid_url", reason: safeUrl.error }, 400);
    parsed.data.url = safeUrl.url;
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  for (const k of ["name", "url", "category", "description"] as const) {
    if (parsed.data[k] !== undefined) patch[k] = parsed.data[k];
  }

  const [updated] = await db
    .update(competitors)
    .set(patch)
    .where(eq(competitors.id, id))
    .returning();
  return c.json({ competitor: updated });
});

// Pause / resume monitoring (kebab → Pause). The scheduler skips a paused
// competitor's monitors without mutating their isActive flags, so resuming keeps
// each source's prior state. Per-source "Run now" still works while paused.
const MonitoringSchema = z.object({ paused: z.boolean() });

competitorsRouter.patch("/:id/monitoring", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const competitor = await assertOwnedCompetitor(id, orgId);
  if (!competitor || competitor.deletedAt) return c.json({ error: "Not found" }, 404);

  const parsed = MonitoringSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid body" }, 400);

  await db
    .update(competitors)
    .set({ monitoringPaused: parsed.data.paused, updatedAt: new Date() })
    .where(eq(competitors.id, id));
  return c.json({ ok: true, paused: parsed.data.paused });
});

// Mute / unmute real-time alerts (kebab → Mute alerts). Signals are still tracked
// and surface in the feed + digests; generate-signal just skips the immediate
// send-alert (email/Slack/in-app) when muted.
const AlertsSchema = z.object({ muted: z.boolean() });

competitorsRouter.patch("/:id/alerts", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const competitor = await assertOwnedCompetitor(id, orgId);
  if (!competitor || competitor.deletedAt) return c.json({ error: "Not found" }, 404);

  const parsed = AlertsSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid body" }, 400);

  await db
    .update(competitors)
    .set({ alertsMuted: parsed.data.muted, updatedAt: new Date() })
    .where(eq(competitors.id, id));
  return c.json({ ok: true, muted: parsed.data.muted });
});

// Recompute the overlap score (kebab → Recompute overlap). Re-scores this single
// competitor against the org's current product profile — useful after the profile
// changed. Synchronous AI call (like discovery), reusing the discovery scorer.
competitorsRouter.post("/:id/recompute-overlap", aiIntensiveRateLimit, async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const competitor = await assertOwnedCompetitor(id, orgId);
  if (!competitor || competitor.deletedAt) return c.json({ error: "Not found" }, 404);
  if (!competitor.url) return c.json({ error: "no_url" }, 400);

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
    columns: { productProfile: true },
  });
  if (!org?.productProfile) return c.json({ error: "missing_profile" }, 400);

  let scored: Awaited<ReturnType<typeof scoreOverlap>>;
  try {
    scored = await scoreOverlap(org.productProfile, [
      { url: competitor.url, title: competitor.name, snippet: competitor.description ?? "" },
    ]);
  } catch {
    return c.json({ error: "scoring_failed" }, 502);
  }
  const overlapScore = scored[0]?.overlapScore ?? null;

  await db
    .update(competitors)
    .set({ overlapScore, updatedAt: new Date() })
    .where(eq(competitors.id, id));
  return c.json({ overlapScore, reason: scored[0]?.reason ?? null });
});

// Product memberships for the "Assign to products" dialog (patch-28): every org
// product plus the subset this competitor is currently linked to. Attach/detach
// reuse the products router endpoints (POST/DELETE /products/:pid/competitors/:cid).
competitorsRouter.get("/:id/products", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const competitor = await assertOwnedCompetitor(id, orgId);
  if (!competitor || competitor.deletedAt) return c.json({ error: "Not found" }, 404);

  const all = await db
    .select({
      id: products.id,
      name: products.name,
      isPrimary: products.isPrimary,
      status: products.status,
    })
    .from(products)
    .where(eq(products.orgId, orgId))
    .orderBy(asc(products.position), asc(products.name));

  const links = await db
    .select({
      productId: productCompetitors.productId,
      isSpecific: productCompetitors.isSpecific,
    })
    .from(productCompetitors)
    .innerJoin(products, eq(products.id, productCompetitors.productId))
    .where(and(eq(productCompetitors.competitorId, id), eq(products.orgId, orgId)));

  return c.json({ products: all, links });
});

// CSV export of this competitor's signals (kebab → Export signals). Returns a
// downloadable text/csv body, not JSON — the client triggers a Blob download.
function csvCell(value: unknown): string {
  let s = value == null ? "" : String(value);
  // CSV/formula injection: a cell starting with = + - @ (or tab/CR) is executed
  // as a formula by Excel/Sheets. Prefix a single quote to neutralize it.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

competitorsRouter.get("/:id/export", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const competitor = await assertOwnedCompetitor(id, orgId);
  if (!competitor || competitor.deletedAt) return c.json({ error: "Not found" }, 404);

  const rows = await db
    .select({
      detectedAt: signals.createdAt,
      severity: signals.severity,
      category: signals.category,
      insight: signals.insight,
      soWhat: signals.soWhat,
      recommendedAction: signals.recommendedAction,
    })
    .from(signals)
    .where(eq(signals.competitorId, id))
    .orderBy(desc(signals.createdAt))
    .limit(1000);

  const header = ["detected_at", "severity", "category", "insight", "so_what", "recommended_action"];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.detectedAt instanceof Date ? r.detectedAt.toISOString() : String(r.detectedAt),
        r.severity,
        r.category,
        r.insight,
        r.soWhat,
        r.recommendedAction,
      ]
        .map(csvCell)
        .join(","),
    );
  }

  const slug = competitor.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "competitor";

  void captureServerEvent(user.id, "competitor_signals_exported", {
    competitorId: id,
    competitorName: competitor.name,
    signalCount: rows.length,
    orgId,
  });

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}-signals.csv"`,
    },
  });
});

competitorsRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const competitor = await assertOwnedCompetitor(id, orgId);
  if (!competitor) return c.json({ error: "Not found" }, 404);

  await db.update(competitors).set({ deletedAt: new Date() }).where(eq(competitors.id, id));

  void captureServerEvent(user.id, "competitor_deleted", {
    competitorId: id,
    competitorName: competitor.name,
    orgId,
  });

  return c.json({ ok: true });
});
