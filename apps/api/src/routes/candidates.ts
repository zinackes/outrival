import { Hono } from "hono";
import { z } from "zod";
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { detectPlatform } from "@outrival/queue";
import {
  competitorCandidates,
  competitors,
  discoveryRuns,
  organizations,
  products,
  signals,
  selfProfileLastEditedAt,
} from "@outrival/db";
import { PLAN_LIMITS, deriveCompetitorName } from "@outrival/shared";
import {
  DetectionConfigSchema,
  resolveDetectionConfig,
  nextAutomaticDetectionAt,
  type DetectionConfig,
} from "@outrival/shared";
import { selfProfileToDiscoveryProfile } from "@outrival/ai";
import { db } from "../lib/db";
import { authMiddleware } from "../middleware/auth";
import { aiIntensiveRateLimit } from "../middleware/ai-intensive-rate-limit";
import { ensureUserOrg } from "../lib/org";
import { enqueueJob } from "../lib/queue";
import {
  associateCompetitorWithProduct,
  primaryProductId,
  productDiscoveryTarget,
} from "../lib/products";
import {
  checkCompetitorQuota,
  getOrgPlan,
  assertWithinLimit,
  tierLimitBody,
  currentMonthKey,
  dimensionUsage,
} from "../lib/plan";
import { detectCandidatesForProduct } from "../lib/detect-candidates";
import { seedCompetitorMonitors, enqueueFirstScrapes } from "../lib/seed-monitors";

type Variables = { user: { id: string } };

export const candidatesRouter = new Hono<{ Variables: Variables }>();

candidatesRouter.use("*", authMiddleware);

// Anti-double-run cooldown on the paid Exa discovery call, keyed per discovery TARGET
// (`orgId:productId`, or `orgId:all` for an all-products refresh) — NOT per org. A
// per-org cooldown blocked the "add product" wizard: creating a second SKU (or the
// wizard re-running discovery for a freshly created one) was refused for 30 min because
// an unrelated product had just run. The real Exa-cost guards live elsewhere (per-tier
// monthly `discoveriesPerMonth` quota + the 10/h aiIntensiveRateLimit), so this is only
// a short guard against double-clicks, not a usage cap. In-memory Map → single-instance
// only (multi-replica TODO).
const DETECT_RATE_LIMIT_ENABLED = true;
const DETECT_COOLDOWN_MS = (Number(process.env.DETECT_COOLDOWN_SEC ?? 90) || 90) * 1000;
const lastDetectAt = new Map<string, number>();

const ConfigBodySchema = DetectionConfigSchema.extend({
  excludedDomains: z.array(z.string()).max(50),
  keywords: z.string().max(200),
});

// Bulk dismiss / restore (quick triage): one round-trip to clear or undo a batch.
const IdsBodySchema = z.object({ ids: z.array(z.string()).min(1).max(100) });

/** Reduce a free-form entry ("https://www.Foo.com/x", "Foo.com") to a bare host. */
function normalizeDomain(raw: string): string | null {
  const t = raw.trim().toLowerCase();
  if (!t) return null;
  try {
    const h = new URL(t.includes("://") ? t : `https://${t}`).hostname;
    return h.startsWith("www.") ? h.slice(4) : h;
  } catch {
    return null;
  }
}

// Resolve the discovery product scope (patch-28). A supplied productId owned by the org
// narrows to that SKU; its absence means "all products" — the union across the org's
// products. Tenant-safe: a forged/foreign id falls through to the org-wide union (still
// org-scoped), never another tenant's data.
type DiscoveryScope = { kind: "product"; productId: string } | { kind: "all" };

async function resolveScope(orgId: string, raw?: string): Promise<DiscoveryScope> {
  if (raw) {
    const owned = await db.query.products.findFirst({
      // Archived excluded, so a scope cookie left on a removed product falls through to
      // the org-wide union instead of running discovery for a SKU that no longer exists.
      where: and(
        eq(products.id, raw),
        eq(products.orgId, orgId),
        ne(products.status, "archived"),
      ),
      columns: { id: true },
    });
    if (owned) return { kind: "product", productId: owned.id };
  }
  return { kind: "all" };
}

// The org's non-archived products, primary first — the set an "all products" discovery
// action (list union, refresh, staleness) spans.
async function nonArchivedProductIds(orgId: string): Promise<string[]> {
  const rows = await db.query.products.findMany({
    where: and(eq(products.orgId, orgId), ne(products.status, "archived")),
    orderBy: [desc(products.isPrimary), asc(products.position), asc(products.createdAt)],
    columns: { id: true },
  });
  return rows.map((r) => r.id);
}

// What the search actually ran on, in the terms a user can act on. The Discovery
// page prints this as the source note under its reading, because when a scan returns
// junk the fix is one of these five values (profile category/audience, extra
// keywords, region, exclusions) and all of them used to be invisible behind a sheet.
// The all-products scope reports the primary product's profile: it is the one the
// org-wide search is anchored on.
export interface DiscoveryBasis {
  productId: string | null;
  category: string | null;
  audience: string | null;
  keywords: string;
  region: string | null;
  excludedDomains: number;
  autoDetect: boolean;
  cadence: DetectionConfig["cadence"];
}

async function discoveryBasis(
  orgId: string,
  scope: DiscoveryScope,
): Promise<DiscoveryBasis> {
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
    columns: { detectionConfig: true, productProfile: true },
  });
  const cfg = resolveDetectionConfig(org?.detectionConfig);
  const productId =
    scope.kind === "product"
      ? scope.productId
      : ((await nonArchivedProductIds(orgId))[0] ?? null);
  const target = productId ? await productDiscoveryTarget(orgId, productId) : null;
  // The org-level profile is the fallback for the primary product and for an org
  // that has no product row yet (mid-onboarding); a secondary SKU must never borrow
  // it, or the basis would describe a different product than the one searched for.
  const profile = selfProfileToDiscoveryProfile(
    target?.selfProfile ?? null,
    !target || target.isPrimary ? (org?.productProfile ?? null) : null,
  );

  return {
    productId,
    category: profile?.category?.trim() || null,
    audience: profile?.audience?.trim() || null,
    keywords: cfg.keywords,
    region: cfg.region,
    excludedDomains: cfg.excludedDomains.length,
    autoDetect: cfg.autoDetect,
    cadence: cfg.cadence,
  };
}

// Per-product discovery staleness (patch-22): "fresh" while the last run is <7 days old
// AND the self-profile hasn't been edited since. Aggregated for the all-products view.
async function productStaleness(
  orgId: string,
  productId: string,
): Promise<{ needsRediscovery: boolean; lastDiscoveryAt: Date | null; reason?: string }> {
  const lastRun = await db.query.discoveryRuns.findFirst({
    where: and(eq(discoveryRuns.orgId, orgId), eq(discoveryRuns.productId, productId)),
    orderBy: desc(discoveryRuns.lastDiscoveryAt),
  });
  if (!lastRun) return { needsRediscovery: true, lastDiscoveryAt: null };

  const daysSince = (Date.now() - lastRun.lastDiscoveryAt.getTime()) / 86400000;
  const target = await productDiscoveryTarget(orgId, productId);
  const profileAt = target
    ? (selfProfileLastEditedAt(target.selfProfile) ?? target.selfUpdatedAt)
    : null;
  const profileChanged =
    !!profileAt &&
    (!lastRun.basedOnProfileUpdateAt || profileAt > lastRun.basedOnProfileUpdateAt);

  if (daysSince < 7 && !profileChanged) {
    return {
      needsRediscovery: false,
      lastDiscoveryAt: lastRun.lastDiscoveryAt,
      reason: "profile_unchanged_recent_run",
    };
  }
  return {
    needsRediscovery: true,
    lastDiscoveryAt: lastRun.lastDiscoveryAt,
    reason: profileChanged ? "profile_changed" : "stale_run",
  };
}

// Record a discovery run for staleness + the monthly quota counter (patch-22/28). The
// (org, product) row snapshots the profile edit it was based on so a later edit (or 7+
// days) marks the next run worth doing, and carries that month's on-demand detect count.
async function recordDiscoveryRun(orgId: string, productId: string): Promise<void> {
  const target = await productDiscoveryTarget(orgId, productId);
  const profileAt = target
    ? (selfProfileLastEditedAt(target.selfProfile) ?? target.selfUpdatedAt)
    : null;
  const month = currentMonthKey();
  const existingRun = await db.query.discoveryRuns.findFirst({
    where: and(eq(discoveryRuns.orgId, orgId), eq(discoveryRuns.productId, productId)),
  });
  const nextCount =
    (existingRun?.detectCountMonth === month ? existingRun.detectCount : 0) + 1;
  if (existingRun) {
    await db
      .update(discoveryRuns)
      .set({
        lastDiscoveryAt: new Date(),
        basedOnProfileUpdateAt: profileAt,
        detectCount: nextCount,
        detectCountMonth: month,
      })
      .where(eq(discoveryRuns.id, existingRun.id));
  } else {
    await db.insert(discoveryRuns).values({
      orgId,
      productId,
      lastDiscoveryAt: new Date(),
      basedOnProfileUpdateAt: profileAt,
      detectCount: nextCount,
      detectCountMonth: month,
    });
  }
}

candidatesRouter.get("/", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const statusParam = c.req.query("status");

  // patch-28 — discovery is product-scoped: each SKU has its own review queue. "All
  // products" (no scope) unions every SKU's queue so the org-wide view isn't limited to
  // the primary product.
  const scopeSel = await resolveScope(orgId, c.req.query("productId"));
  const scope =
    scopeSel.kind === "product"
      ? and(
          eq(competitorCandidates.orgId, orgId),
          eq(competitorCandidates.productId, scopeSel.productId),
        )
      : eq(competitorCandidates.orgId, orgId);
  const where =
    statusParam === "new" || statusParam === "dismissed" || statusParam === "added"
      ? and(scope, eq(competitorCandidates.status, statusParam))
      : scope;

  const rows = await db.query.competitorCandidates.findMany({
    where,
    orderBy: desc(competitorCandidates.firstSeenAt),
    limit: 100,
  });

  // Tab counts (product-scoped, status-independent) so the UI can badge both tabs
  // without a second round-trip per tab switch.
  const countRows = await db
    .select({
      status: competitorCandidates.status,
      n: sql<number>`count(*)::int`,
    })
    .from(competitorCandidates)
    .where(scope)
    .groupBy(competitorCandidates.status);

  const counts = { new: 0, dismissed: 0, added: 0 };
  for (const r of countRows) {
    if (r.status === "new") counts.new = r.n;
    else if (r.status === "dismissed") counts.dismissed = r.n;
    else if (r.status === "added") counts.added = r.n;
  }

  // Seats + search basis travel with the list because both explain THIS list: what
  // tracking a candidate costs (a competitor seat, the scarce resource the queue is
  // spent against) and what produced it. Shipping them here keeps the page's first
  // paint to the single server-seeded request it already makes.
  const plan = await getOrgPlan(orgId);
  const quota = await checkCompetitorQuota(orgId, plan, 0);
  const basis = await discoveryBasis(orgId, scopeSel);

  return c.json({
    candidates: rows,
    counts,
    seats: { used: quota.used, limit: quota.limit },
    basis,
  });
});

candidatesRouter.get("/config", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
  });
  if (!org) return c.json({ error: "Not found" }, 404);

  return c.json({
    config: resolveDetectionConfig(org.detectionConfig),
    lastRunAt: org.detectionLastRunAt,
  });
});

candidatesRouter.put("/config", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const body = await c.req.json().catch(() => null);
  const parsed = ConfigBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);
  }

  const excludedDomains = [
    ...new Set(
      parsed.data.excludedDomains
        .map(normalizeDomain)
        .filter((d): d is string => d !== null),
    ),
  ];

  const config = { ...parsed.data, excludedDomains };
  await db
    .update(organizations)
    .set({ detectionConfig: config, updatedAt: new Date() })
    .where(eq(organizations.id, orgId));

  return c.json({ config });
});

// Whether re-running discovery is worth it (patch-22 intelligent rate limiting):
// "fresh" while the last run is <7 days old AND the self-profile hasn't been edited
// since. UI greys the button and suggests editing the profile. Never blocking.
candidatesRouter.get("/staleness", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  // patch-28 — staleness is per product: a brand-new SKU reads as "never_run" even when
  // the primary product was just discovered. The all-products view aggregates: it's worth
  // refreshing if ANY non-archived SKU is stale or never run.
  const scopeSel = await resolveScope(orgId, c.req.query("productId"));
  const productIds =
    scopeSel.kind === "product"
      ? [scopeSel.productId]
      : await nonArchivedProductIds(orgId);

  // The monthly scan allowance and the date the cron will next run for this org.
  // Both belong to the same question the page asks here ("is scanning worth it, and
  // can I"), so they ride along rather than costing a third request.
  const plan = await getOrgPlan(orgId);
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
    columns: { detectionConfig: true, detectionLastRunAt: true },
  });
  const scans = {
    used: await dimensionUsage(orgId, "discoveriesPerMonth"),
    limit: PLAN_LIMITS[plan].discoveriesPerMonth,
  };
  const nextAutomaticAt = nextAutomaticDetectionAt(
    org?.detectionLastRunAt ?? null,
    resolveDetectionConfig(org?.detectionConfig),
  );

  if (productIds.length === 0) {
    return c.json({
      staleness: "never_run",
      needsRediscovery: true,
      scans,
      nextAutomaticAt,
    });
  }

  let anyRun = false;
  let anyStale = false;
  let latest: Date | null = null;
  let staleReason: string | undefined;
  for (const productId of productIds) {
    const s = await productStaleness(orgId, productId);
    if (s.lastDiscoveryAt) {
      anyRun = true;
      if (!latest || s.lastDiscoveryAt > latest) latest = s.lastDiscoveryAt;
    }
    if (s.needsRediscovery) {
      anyStale = true;
      staleReason ??= s.reason ?? "stale_run";
    }
  }

  if (!anyRun) {
    return c.json({
      staleness: "never_run",
      needsRediscovery: true,
      scans,
      nextAutomaticAt,
    });
  }
  if (anyStale) {
    return c.json({
      staleness: "outdated",
      needsRediscovery: true,
      lastDiscoveryAt: latest,
      reason: staleReason,
      scans,
      nextAutomaticAt,
    });
  }
  return c.json({
    staleness: "fresh",
    needsRediscovery: false,
    lastDiscoveryAt: latest,
    reason: "profile_unchanged_recent_run",
    scans,
    nextAutomaticAt,
  });
});

// What the review queue actually bought the org: every candidate that was tracked,
// with the competitor it became and what that competitor has captured since. A seat
// spent on a company that produces nothing is the one thing the queue could never
// tell you, and it is the argument for reviewing the next batch at all.
candidatesRouter.get("/added", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const scopeSel = await resolveScope(orgId, c.req.query("productId"));
  const scope =
    scopeSel.kind === "product"
      ? and(
          eq(competitorCandidates.orgId, orgId),
          eq(competitorCandidates.productId, scopeSel.productId),
        )
      : eq(competitorCandidates.orgId, orgId);

  const rows = await db.query.competitorCandidates.findMany({
    where: and(scope, eq(competitorCandidates.status, "added")),
    orderBy: desc(competitorCandidates.firstSeenAt),
    limit: 25,
  });
  if (rows.length === 0) return c.json({ added: [] });

  // Rows added before competitor_id existed carry no link, so they resolve by
  // hostname against the org's live competitors. A miss (competitor since deleted)
  // is reported as a null competitor rather than dropped: "added, then removed" is
  // still an outcome.
  const tracked = await db.query.competitors.findMany({
    where: and(eq(competitors.orgId, orgId), isNull(competitors.deletedAt)),
    columns: { id: true, name: true, url: true, color: true, createdAt: true },
  });
  const byId = new Map(tracked.map((t) => [t.id, t]));
  const byHost = new Map<string, (typeof tracked)[number]>();
  for (const t of tracked) {
    const h = normalizeDomain(t.url ?? "");
    if (h && !byHost.has(h)) byHost.set(h, t);
  }

  const resolved = rows.map((r) => {
    const host = normalizeDomain(r.url);
    const competitor =
      (r.competitorId ? byId.get(r.competitorId) : undefined) ??
      (host ? byHost.get(host) : undefined) ??
      null;
    return { row: r, competitor };
  });

  const ids = [...new Set(resolved.flatMap((r) => (r.competitor ? [r.competitor.id] : [])))];
  const activity = new Map<string, { signalCount: number; lastSignalAt: Date | null }>();
  if (ids.length > 0) {
    const counted = await db
      .select({
        competitorId: signals.competitorId,
        n: sql<number>`count(*)::int`,
        last: sql<Date | null>`max(${signals.createdAt})`,
      })
      .from(signals)
      .where(and(eq(signals.orgId, orgId), inArray(signals.competitorId, ids)))
      .groupBy(signals.competitorId);
    for (const r of counted) {
      activity.set(r.competitorId, { signalCount: r.n, lastSignalAt: r.last });
    }
  }

  return c.json({
    added: resolved.map(({ row, competitor }) => ({
      id: row.id,
      url: row.url,
      title: row.title,
      snippet: row.snippet,
      overlapScore: row.overlapScore,
      productId: row.productId,
      firstSeenAt: row.firstSeenAt,
      competitor: competitor
        ? {
            id: competitor.id,
            name: competitor.name,
            url: competitor.url,
            color: competitor.color,
            addedAt: competitor.createdAt,
          }
        : null,
      signalCount: competitor ? (activity.get(competitor.id)?.signalCount ?? 0) : 0,
      lastSignalAt: competitor ? (activity.get(competitor.id)?.lastSignalAt ?? null) : null,
    })),
  });
});

candidatesRouter.post("/:id/add", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const candidate = await db.query.competitorCandidates.findFirst({
    where: and(eq(competitorCandidates.id, id), eq(competitorCandidates.orgId, orgId)),
  });
  if (!candidate) return c.json({ error: "Not found" }, 404);
  if (candidate.status === "added") return c.json({ error: "Already added" }, 400);

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
      name: deriveCompetitorName(candidate.url, candidate.title),
      url: candidate.url,
      overlapScore: candidate.overlapScore,
    })
    .returning();
  if (!competitor) return c.json({ error: "Failed to create competitor" }, 500);

  // patch-28 — tag this competitor into the product it was discovered for (shared),
  // so it lands in that SKU's feed, not always the primary. Legacy candidates with no
  // productId fall back to the primary.
  const targetProductId = candidate.productId ?? (await primaryProductId(orgId));
  if (targetProductId) {
    await associateCompetitorWithProduct(orgId, targetProductId, competitor.id);
  }

  // patch-31 — detect the platform profile (fire-and-forget) so the first scrapes
  // can route via structured connectors. Never blocks the add.
  try {
    await enqueueJob(detectPlatform, { competitorId: competitor.id });
  } catch (e) {
    console.error("Failed to trigger platform detection", {
      competitorId: competitor.id,
      error: String(e),
    });
  }

  // Same seeding as the manual-add path (one helper, so the two can no longer
  // drift — this path was still missing the sitemap anchor).
  const orgRow = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
    columns: { defaultSources: true },
  });
  const monitorRows = await seedCompetitorMonitors({
    competitorId: competitor.id,
    plan,
    orgDefaultSources: orgRow?.defaultSources ?? null,
  });

  await db
    .update(competitorCandidates)
    .set({ status: "added", competitorId: competitor.id })
    .where(eq(competitorCandidates.id, candidate.id));

  await enqueueFirstScrapes(monitorRows);

  return c.json({ competitor, monitors: monitorRows });
});

candidatesRouter.post("/detect", aiIntensiveRateLimit, async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  // patch-28 — discovery targets a product's self-profile. "All products" refreshes every
  // non-archived SKU (bounded by the monthly quota), not just the primary. Resolve the
  // scope first so the cooldown can be keyed to this specific target.
  const scopeSel = await resolveScope(orgId, c.req.query("productId"));
  const productIds =
    scopeSel.kind === "product"
      ? [scopeSel.productId]
      : await nonArchivedProductIds(orgId);
  if (productIds.length === 0) return c.json({ error: "missing_profile" }, 400);

  const cooldownKey = `${orgId}:${scopeSel.kind === "product" ? scopeSel.productId : "all"}`;
  const last = lastDetectAt.get(cooldownKey);
  if (DETECT_RATE_LIMIT_ENABLED && last && Date.now() - last < DETECT_COOLDOWN_MS) {
    const retryInSec = Math.ceil((DETECT_COOLDOWN_MS - (Date.now() - last)) / 1000);
    return c.json({ error: "cooldown", retryInSec }, 429);
  }

  lastDetectAt.set(cooldownKey, Date.now());

  let totalDetected = 0;
  let ranAny = false;
  try {
    for (const productId of productIds) {
      // Per-tier monthly discovery quota, summed org-wide (tier-limits). On-demand only —
      // the weekly cron doesn't consume it. Re-checked each iteration so an all-products
      // refresh stops cleanly when the budget runs out.
      const quota = await assertWithinLimit(orgId, "discoveriesPerMonth");
      if (!quota.ok) {
        if (!ranAny) return c.json(tierLimitBody(quota), 429);
        break; // partial run — the detected count reflects what completed
      }

      const result = await detectCandidatesForProduct(orgId, productId);
      if (!result.ok) {
        // A single profileless SKU shouldn't abort an all-products refresh.
        if (scopeSel.kind === "product") {
          lastDetectAt.delete(cooldownKey);
          return c.json({ error: result.error }, 400);
        }
        continue;
      }

      // Record the run for staleness + the monthly quota counter (patch-22/28).
      await recordDiscoveryRun(orgId, productId);
      totalDetected += result.detected;
      ranAny = true;
    }

    if (!ranAny) {
      lastDetectAt.delete(cooldownKey);
      return c.json({ error: "missing_profile" }, 400);
    }
    return c.json({ detected: totalDetected });
  } catch (e) {
    lastDetectAt.delete(cooldownKey);
    console.error("detect-candidates failed", { orgId, error: String(e) });
    return c.json({ error: "detection_failed" }, 500);
  }
});

candidatesRouter.post("/:id/dismiss", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const candidate = await db.query.competitorCandidates.findFirst({
    where: and(eq(competitorCandidates.id, id), eq(competitorCandidates.orgId, orgId)),
  });
  if (!candidate) return c.json({ error: "Not found" }, 404);

  await db
    .update(competitorCandidates)
    .set({ status: "dismissed" })
    .where(eq(competitorCandidates.id, candidate.id));

  return c.json({ ok: true });
});

// Bulk dismiss (quick triage): "Dismiss all" / threshold clear in discovery. Only
// touches candidates still `new` so a stale id can't un-add a tracked competitor.
candidatesRouter.post("/dismiss", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const body = await c.req.json().catch(() => null);
  const parsed = IdsBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);
  }

  const rows = await db
    .update(competitorCandidates)
    .set({ status: "dismissed" })
    .where(
      and(
        eq(competitorCandidates.orgId, orgId),
        eq(competitorCandidates.status, "new"),
        inArray(competitorCandidates.id, parsed.data.ids),
      ),
    )
    .returning({ id: competitorCandidates.id });

  return c.json({ dismissed: rows.length });
});

// Undo (quick triage): send dismissed candidates back to the review queue. Scoped to
// `dismissed` so it can never resurrect an `added` candidate as `new`.
candidatesRouter.post("/restore", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const body = await c.req.json().catch(() => null);
  const parsed = IdsBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);
  }

  const rows = await db
    .update(competitorCandidates)
    .set({ status: "new" })
    .where(
      and(
        eq(competitorCandidates.orgId, orgId),
        eq(competitorCandidates.status, "dismissed"),
        inArray(competitorCandidates.id, parsed.data.ids),
      ),
    )
    .returning({ id: competitorCandidates.id });

  return c.json({ restored: rows.length });
});

// Permanent delete (discovery → Dismissed tab): destroy the candidate row outright.
// Org-scoped and irreversible, unlike dismiss (a status flip). A later detection run
// may re-surface the same URL — that's intended ("remove from my list now"), not a ban.
candidatesRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const rows = await db
    .delete(competitorCandidates)
    .where(and(eq(competitorCandidates.id, id), eq(competitorCandidates.orgId, orgId)))
    .returning({ id: competitorCandidates.id });

  if (rows.length === 0) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});
