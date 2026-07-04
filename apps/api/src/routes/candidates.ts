import { Hono } from "hono";
import { z } from "zod";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { tasks } from "@trigger.dev/sdk/v3";
import {
  competitorCandidates,
  competitors,
  discoveryRuns,
  monitors,
  organizations,
  products,
  selfProfileLastEditedAt,
} from "@outrival/db";
import { DetectionConfigSchema, resolveDetectionConfig } from "@outrival/shared";
import { db } from "../lib/db";
import { authMiddleware } from "../middleware/auth";
import { aiIntensiveRateLimit } from "../middleware/ai-intensive-rate-limit";
import { ensureUserOrg } from "../lib/org";
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
} from "../lib/plan";
import { detectCandidatesForProduct } from "../lib/detect-candidates";

type Variables = { user: { id: string } };

export const candidatesRouter = new Hono<{ Variables: Variables }>();

candidatesRouter.use("*", authMiddleware);

// Per-org 30-min cooldown on the paid Exa discovery call. NOTE: lastDetectAt below is
// an in-memory Map, so this cooldown is single-instance only (multi-replica TODO).
const DETECT_RATE_LIMIT_ENABLED = true;
const DETECT_COOLDOWN_MS = 30 * 60 * 1000;
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
      where: and(eq(products.id, raw), eq(products.orgId, orgId)),
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

function deriveCompetitorName(url: string, title: string | null): string {
  if (title && title.trim().length > 0) return title.trim().slice(0, 100);
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host;
  } catch {
    return url;
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

  const counts = { new: 0, dismissed: 0 };
  for (const r of countRows) {
    if (r.status === "new") counts.new = r.n;
    else if (r.status === "dismissed") counts.dismissed = r.n;
  }

  return c.json({ candidates: rows, counts });
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
  if (productIds.length === 0) {
    return c.json({ staleness: "never_run", needsRediscovery: true });
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
    return c.json({ staleness: "never_run", needsRediscovery: true });
  }
  if (anyStale) {
    return c.json({
      staleness: "outdated",
      needsRediscovery: true,
      lastDiscoveryAt: latest,
      reason: staleReason,
    });
  }
  return c.json({
    staleness: "fresh",
    needsRediscovery: false,
    lastDiscoveryAt: latest,
    reason: "profile_unchanged_recent_run",
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
    await tasks.trigger("detect-platform", { competitorId: competitor.id });
  } catch (e) {
    console.error("Failed to trigger platform detection", {
      competitorId: competitor.id,
      error: String(e),
    });
  }

  // Stamp scrapeStartedAt on seed so the detail page shows the first scrape as
  // in-progress (isServerScraping derives "running" from scrapeStartedAt > lastRunAt).
  // Without it a freshly-added competitor looks idle while its first scrape runs.
  const scrapeStartedAt = new Date();
  const monitorRows = await db
    .insert(monitors)
    .values([
      { competitorId: competitor.id, sourceType: "homepage", frequency: "daily", scrapeStartedAt },
      { competitorId: competitor.id, sourceType: "pricing", frequency: "daily", scrapeStartedAt },
      { competitorId: competitor.id, sourceType: "blog", frequency: "weekly", scrapeStartedAt },
      // Internal news/funding anchor (weekly) — see competitors.ts POST. Google
      // News RSS by brand → diff surfaces company-level events.
      { competitorId: competitor.id, sourceType: "news", frequency: "weekly", scrapeStartedAt },
    ])
    .returning();

  await db
    .update(competitorCandidates)
    .set({ status: "added" })
    .where(eq(competitorCandidates.id, candidate.id));

  for (const m of monitorRows) {
    try {
      await tasks.trigger("scrape-monitor", { monitorId: m.id, force: true });
    } catch (e) {
      console.error("Failed to trigger initial scrape", { monitorId: m.id, error: String(e) });
    }
  }

  return c.json({ competitor, monitors: monitorRows });
});

candidatesRouter.post("/detect", aiIntensiveRateLimit, async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const last = lastDetectAt.get(orgId);
  if (DETECT_RATE_LIMIT_ENABLED && last && Date.now() - last < DETECT_COOLDOWN_MS) {
    const retryInSec = Math.ceil((DETECT_COOLDOWN_MS - (Date.now() - last)) / 1000);
    return c.json({ error: "cooldown", retryInSec }, 429);
  }

  // patch-28 — discovery targets a product's self-profile. "All products" refreshes every
  // non-archived SKU (bounded by the monthly quota), not just the primary.
  const scopeSel = await resolveScope(orgId, c.req.query("productId"));
  const productIds =
    scopeSel.kind === "product"
      ? [scopeSel.productId]
      : await nonArchivedProductIds(orgId);
  if (productIds.length === 0) return c.json({ error: "missing_profile" }, 400);

  lastDetectAt.set(orgId, Date.now());

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
          lastDetectAt.delete(orgId);
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
      lastDetectAt.delete(orgId);
      return c.json({ error: "missing_profile" }, 400);
    }
    return c.json({ detected: totalDetected });
  } catch (e) {
    lastDetectAt.delete(orgId);
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
