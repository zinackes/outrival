import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import { tasks } from "@trigger.dev/sdk/v3";
import {
  competitors,
  monitors,
  organizations,
  jobPostings,
  selfProductChanges,
  forcedRescanLog,
  type SelfProfile,
  type SelfProfileField,
} from "@outrival/db";
import { normalizeHostname, validatePublicUrl, forcedRescansPerDay } from "@outrival/shared";
import { db } from "../lib/db";
import { authMiddleware } from "../middleware/auth";
import { aiIntensiveRateLimit } from "../middleware/ai-intensive-rate-limit";
import { ensureUserOrg } from "../lib/org";
import { getOrgPlan, countUserForcedRescansToday, rescanLimitBody } from "../lib/plan";
import { ensurePrimaryProductForSelf } from "../lib/products";
import { analyticsQuery, sql } from "../lib/analytics-safe";

type Variables = { user: { id: string } };

export const myProductRouter = new Hono<{ Variables: Variables }>();

myProductRouter.use("*", authMiddleware);

/** The org's self-competitor (its own product), or null if not created yet. With
 * multi-product (patch-28) an org can have several self-competitors; this returns the
 * oldest (the original / primary product's anchor) so the behaviour stays stable for
 * mono-product orgs. Phase 2 scopes My Product by the selected product. */
async function getSelf(orgId: string) {
  return db.query.competitors.findFirst({
    where: and(eq(competitors.orgId, orgId), eq(competitors.type, "self")),
    orderBy: (t, { asc }) => asc(t.createdAt),
  });
}

/**
 * The org's self-competitor, lazily creating a bare one (no monitors) if it doesn't
 * exist yet. Orgs onboarded before patch-15 have no self; this lets them attach a
 * product URL / repo from My Product without re-onboarding. The caller seeds monitors.
 */
async function ensureSelf(orgId: string) {
  const existing = await getSelf(orgId);
  if (existing) return existing;

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
  });
  const pp = org?.productProfile;
  const seed = <T,>(value: T | null | undefined): SelfProfileField<T> | undefined =>
    value == null || (typeof value === "string" && value.trim() === "")
      ? undefined
      : { value, isFromAutoDetect: true, lastEditedByUserAt: null };
  const selfProfile: SelfProfile = {
    category: seed(pp?.category),
    audience: seed(pp?.audience),
    valueProp: seed(pp?.valueProp),
  };

  const [created] = await db
    .insert(competitors)
    .values({
      orgId,
      name: normalizeHostname(org?.productUrl) ?? "My product",
      url: org?.productUrl ?? null,
      category: pp?.category ?? null,
      type: "self",
      isUserProduct: true,
      selfProfile,
    })
    .returning();
  if (!created) return null;
  // patch-28 — wrap the freshly created self-competitor in a primary product.
  await ensurePrimaryProductForSelf(orgId, created.id, created.name);
  return created;
}

/** Mark a profile field as user-edited (sticky against future auto-detection). */
function editedField<T>(value: T): SelfProfileField<T> {
  return { value, isFromAutoDetect: false, lastEditedByUserAt: new Date().toISOString() };
}

/** Flag monitors as scraping so the page derives "scanning…" (see isScanning) and
 * survives a refresh. Clears any prior failure so the state flips straight to live. */
async function markScanning(monitorIds: string[]) {
  if (monitorIds.length === 0) return;
  await db
    .update(monitors)
    .set({ scrapeStartedAt: new Date(), lastFailedAt: null, lastError: null })
    .where(inArray(monitors.id, monitorIds));
}

const PricingTierSchema = z.object({
  plan_name: z.string().min(1).max(80),
  price: z.number().min(0).max(1_000_000),
  currency: z.string().max(8),
  billing_period: z.string().max(20),
});

const PatchSchema = z.object({
  category: z.string().max(200).optional(),
  audience: z.string().max(500).optional(),
  valueProp: z.string().max(1000).optional(),
  features: z.array(z.string().max(200)).max(40).optional(),
  techStack: z.array(z.string().max(100)).max(40).optional(),
  pricing: z
    .object({
      status: z.string().max(40).optional(),
      observedRegion: z.string().max(40).nullable().optional(),
      promotional: z.boolean().optional(),
      demoUrl: z.string().max(2000).nullable().optional(),
      note: z.string().max(1000).nullable().optional(),
      tiers: z.array(PricingTierSchema).max(20).optional(),
    })
    .optional(),
});

/** A self monitor is "scanning" when its scrape was started after the last
 * terminal event (run or failure) and hasn't blown past the poll window.
 * Mirrors isServerScraping on the competitor page so the UI behaves the same. */
const SCAN_TIMEOUT_MS = 5 * 60 * 1000;
function isScanning(m: {
  scrapeStartedAt: Date | null;
  lastRunAt: Date | null;
  lastFailedAt: Date | null;
}): boolean {
  if (!m.scrapeStartedAt) return false;
  const started = m.scrapeStartedAt.getTime();
  const lastRun = m.lastRunAt?.getTime() ?? 0;
  const lastFailed = m.lastFailedAt?.getTime() ?? 0;
  if (started <= lastRun || started <= lastFailed) return false;
  return Date.now() - started < SCAN_TIMEOUT_MS;
}

// GET /api/my-product — the enriched self profile, or { product: null }.
myProductRouter.get("/", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const self = await getSelf(orgId);
  if (!self) return c.json({ product: null });

  const selfMonitors = await db.query.monitors.findMany({
    where: eq(monitors.competitorId, self.id),
  });
  const lastScanAt = selfMonitors
    .map((m) => m.lastRunAt?.getTime() ?? 0)
    .reduce((a, b) => Math.max(a, b), 0);

  // Live scan state so the page can show "scanning…" and surface a failure
  // instead of leaving the user guessing whether a re-scan finished.
  const scanning = selfMonitors.some(isScanning);
  const failed = selfMonitors
    .filter((m) => !isScanning(m) && m.lastError && m.lastFailedAt)
    .filter((m) => (m.lastFailedAt?.getTime() ?? 0) > (m.lastRunAt?.getTime() ?? 0))
    .sort((a, b) => (b.lastFailedAt?.getTime() ?? 0) - (a.lastFailedAt?.getTime() ?? 0))[0];
  const scanError = scanning ? null : (failed?.lastError ?? null);

  const repoMonitor = selfMonitors.find((m) => m.sourceType === "github_repo");
  const repoUrl =
    repoMonitor?.config && typeof repoMonitor.config === "object" && "url" in repoMonitor.config
      ? String((repoMonitor.config as { url: unknown }).url)
      : null;

  // Latest pricing batch from analytics (best-effort: [] on error).
  const pricingRows = await analyticsQuery<{
    plan_name: string;
    price: number;
    currency: string;
    billing_period: string;
    recorded_at: string;
  }>(sql`
    SELECT plan_name, price, currency, billing_period, recorded_at::text AS recorded_at
    FROM pricing_history
    WHERE competitor_id = ${self.id}
    ORDER BY recorded_at DESC
    LIMIT 40
  `);
  const latestAt = pricingRows[0]?.recorded_at ?? null;
  const detectedTiers = latestAt ? pricingRows.filter((r) => r.recorded_at === latestAt) : [];

  // User-entered tiers (sticky) win over the auto-detected batch — and are the
  // only ones available when nothing has been scraped yet.
  const profile = (self.selfProfile ?? {}) as SelfProfile;
  const manualTiers = profile.pricingTiers;
  const tiers = manualTiers ? manualTiers.value : detectedTiers;

  const jobs = await db.query.jobPostings.findMany({
    where: and(eq(jobPostings.competitorId, self.id), eq(jobPostings.isActive, true)),
    orderBy: desc(jobPostings.detectedAt),
    limit: 50,
  });

  return c.json({
    product: {
      id: self.id,
      name: self.name,
      url: self.url,
      repoUrl,
      lastScanAt: lastScanAt > 0 ? new Date(lastScanAt).toISOString() : null,
      scanning,
      scanError,
      aiSummary: self.aiSummary,
      profile,
      pricing: {
        status: self.pricingStatus,
        observedRegion: self.pricingObservedRegion,
        promotional: self.pricingPromotional,
        demoUrl: self.pricingDemoUrl,
        note: self.pricingNote,
        manualOverride: self.pricingManualOverride,
        tiers,
        tiersManual: !!manualTiers,
        tiersEditedAt: manualTiers?.lastEditedByUserAt ?? null,
      },
      jobs: { total: jobs.length, items: jobs },
    },
  });
});

// PATCH /api/my-product — manual edits. Edited fields become sticky (isFromAutoDetect
// false). Pricing edits also set pricingManualOverride so scrapes don't overwrite them.
myProductRouter.patch("/", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const body = await c.req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);
  }

  const self = await getSelf(orgId);
  if (!self) return c.json({ error: "no_self_product" }, 404);

  const profile: SelfProfile = { ...((self.selfProfile ?? {}) as SelfProfile) };
  const { category, audience, valueProp, features, techStack, pricing } = parsed.data;
  if (category !== undefined) profile.category = editedField(category);
  if (audience !== undefined) profile.audience = editedField(audience);
  if (valueProp !== undefined) profile.valueProp = editedField(valueProp);
  if (features !== undefined) profile.features = editedField(features);
  if (techStack !== undefined) profile.techStack = editedField(techStack);
  if (pricing?.tiers !== undefined) profile.pricingTiers = editedField(pricing.tiers);

  const update: Partial<typeof competitors.$inferInsert> = {
    selfProfile: profile,
    updatedAt: new Date(),
  };
  if (category !== undefined) update.category = category;
  if (pricing) {
    if (pricing.status !== undefined) update.pricingStatus = pricing.status;
    if (pricing.observedRegion !== undefined) update.pricingObservedRegion = pricing.observedRegion;
    if (pricing.promotional !== undefined) update.pricingPromotional = pricing.promotional;
    if (pricing.demoUrl !== undefined) update.pricingDemoUrl = pricing.demoUrl;
    if (pricing.note !== undefined) update.pricingNote = pricing.note;
    update.pricingManualOverride = true;
  }

  await db.update(competitors).set(update).where(eq(competitors.id, self.id));
  return c.json({ ok: true, profile });
});

// POST /api/my-product/site — go live: attach a product URL to the self-competitor
// and seed its site monitors. Used when an idea/document/developing product ships and
// starts having a real site to monitor. Idempotent: only creates missing source monitors.
const SetSiteSchema = z.object({
  url: z
    .string()
    .url()
    .refine((u) => validatePublicUrl(u).ok, { message: "URL must be a public http(s) site" }),
});

myProductRouter.post("/site", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const body = await c.req.json().catch(() => null);
  const parsed = SetSiteSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);
  }

  const self = await ensureSelf(orgId);
  if (!self) return c.json({ error: "no_self_product" }, 500);

  const url = parsed.data.url;
  const urlChanged = self.url !== url;
  // Persist on both the self-competitor (the monitored entity) and the org
  // (org.productUrl feeds competitor discovery). Name the self from its first URL.
  const competitorUpdate: { url: string; updatedAt: Date; name?: string } = {
    url,
    updatedAt: new Date(),
  };
  if (!self.url) competitorUpdate.name = normalizeHostname(url) ?? self.name;
  await db.update(competitors).set(competitorUpdate).where(eq(competitors.id, self.id));
  await db
    .update(organizations)
    .set({ productUrl: url, updatedAt: new Date() })
    .where(eq(organizations.id, orgId));

  // Seed the site monitors that don't exist yet.
  const existing = await db.query.monitors.findMany({
    where: eq(monitors.competitorId, self.id),
  });
  const have = new Set(existing.map((m) => m.sourceType));
  const wanted = (["homepage", "pricing", "jobs"] as const).filter((s) => !have.has(s));
  let seeded: typeof existing = [];
  if (wanted.length > 0) {
    const rescanDays = Number(process.env.USER_PRODUCT_RESCAN_DAYS ?? 14) || 14;
    const nextRunAt = new Date(Date.now() + rescanDays * 24 * 60 * 60 * 1000);
    seeded = await db
      .insert(monitors)
      .values(
        wanted.map((sourceType) => ({
          competitorId: self.id,
          sourceType,
          frequency: "weekly" as const,
          nextRunAt,
        })),
      )
      .returning();
  }

  // Scrape now: always the freshly seeded monitors; and when the URL actually changed,
  // the existing site monitors too — homepage/pricing/jobs derive their target from
  // competitor.url, so the new URL must be re-scraped immediately, not at the next run.
  const SITE_SOURCES = new Set(["homepage", "pricing", "jobs"]);
  const toScrape = urlChanged
    ? [...existing.filter((m) => SITE_SOURCES.has(m.sourceType)), ...seeded]
    : seeded;
  for (const m of toScrape) {
    try {
      await tasks.trigger("scrape-monitor", { monitorId: m.id, force: true });
    } catch (e) {
      console.error("Failed to trigger self scrape", { monitorId: m.id, error: String(e) });
    }
  }
  await markScanning(toScrape.map((m) => m.id));

  return c.json({ ok: true });
});

// POST /api/my-product/repo — attach (or update) a GitHub repo to monitor. Used at
// the developing stage when there's no live site yet. Idempotent: reuses the existing
// github_repo monitor if present, otherwise creates one.
const SetRepoSchema = z.object({ url: z.string().url() });

myProductRouter.post("/repo", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const body = await c.req.json().catch(() => null);
  const parsed = SetRepoSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);
  }

  const self = await getSelf(orgId);
  if (!self) return c.json({ error: "no_self_product" }, 404);

  const url = parsed.data.url;
  await db
    .update(organizations)
    .set({ productRepoUrl: url, updatedAt: new Date() })
    .where(eq(organizations.id, orgId));

  const existing = await db.query.monitors.findMany({
    where: eq(monitors.competitorId, self.id),
  });
  const repoMonitor = existing.find((m) => m.sourceType === "github_repo");
  let monitorId: string;
  if (repoMonitor) {
    await db.update(monitors).set({ config: { url } }).where(eq(monitors.id, repoMonitor.id));
    monitorId = repoMonitor.id;
  } else {
    const rescanDays = Number(process.env.USER_PRODUCT_RESCAN_DAYS ?? 14) || 14;
    const nextRunAt = new Date(Date.now() + rescanDays * 24 * 60 * 60 * 1000);
    const [row] = await db
      .insert(monitors)
      .values({
        competitorId: self.id,
        sourceType: "github_repo",
        frequency: "weekly",
        nextRunAt,
        config: { url },
      })
      .returning();
    if (!row) return c.json({ error: "failed_to_create_monitor" }, 500);
    monitorId = row.id;
  }

  try {
    await tasks.trigger("scrape-monitor", { monitorId, force: true });
  } catch (e) {
    console.error("Failed to trigger self repo scrape", { monitorId, error: String(e) });
  }
  await markScanning([monitorId]);

  return c.json({ ok: true });
});

// Each My Product card maps to the monitor source(s) that feed it. profile, features
// and techStack all derive from the homepage scrape (extract-self-profile), so picking
// any of them re-runs homepage exactly once (deduped); pricing has its own monitor.
const RESCAN_CATEGORY_SOURCES = {
  profile: ["homepage"],
  pricing: ["pricing"],
  features: ["homepage"],
  techStack: ["homepage"],
} as const satisfies Record<string, readonly string[]>;

const RescanSchema = z.object({
  categories: z
    .array(z.enum(["profile", "pricing", "features", "techStack"]))
    .min(1)
    .optional(),
});

// Re-scanning your own product fans out across its sources (homepage, pricing, jobs…),
// so the free cap of 1 forced re-scan/day is too tight to refresh a multi-source product
// in one go. Give the My Product re-scan a slightly higher daily ceiling on FREE only —
// paid tiers (5/20/100) already have ample room and keep their normal forcedRescansPerDay.
const FREE_MY_PRODUCT_RESCAN_LIMIT = 3;

// POST /api/my-product/rescan — force a fresh scrape now. No body (or no categories) →
// every self monitor. With categories → only the monitors feeding the picked cards.
myProductRouter.post("/rescan", aiIntensiveRateLimit, async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const body = await c.req.json().catch(() => null);
  const parsed = RescanSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);
  }

  const self = await getSelf(orgId);
  if (!self) return c.json({ error: "no_self_product" }, 404);

  const selfMonitors = await db.query.monitors.findMany({
    where: eq(monitors.competitorId, self.id),
  });

  const categories = parsed.data.categories;
  const wantedSources = categories
    ? new Set<string>(categories.flatMap((cat) => RESCAN_CATEGORY_SOURCES[cat]))
    : null;
  const toScrape = wantedSources
    ? selfMonitors.filter((m) => wantedSources.has(m.sourceType))
    : selfMonitors;

  // patch-27 — re-scanning your own product is a manual re-scrape, so each already-run
  // source draws from the per-tier forced-rescan daily cap (logged → shows up in usage).
  // A source's first scrape (never run) is the initial fetch, not a re-scan, so it stays
  // unmetered. We meter up to the remaining budget and skip the rest rather than failing
  // the whole action — a partial refresh + nudge beats a hard wall.
  const plan = await getOrgPlan(orgId);
  const limit =
    plan === "free"
      ? Math.max(forcedRescansPerDay(plan), FREE_MY_PRODUCT_RESCAN_LIMIT)
      : forcedRescansPerDay(plan);
  let usageToday = await countUserForcedRescansToday(user.id);

  const scrapedIds: string[] = [];
  let limitReached = false;
  for (const m of toScrape) {
    const isRescan = m.lastRunAt !== null;
    let logId: string | undefined;
    if (isRescan) {
      if (usageToday >= limit) {
        limitReached = true;
        break;
      }
      const [log] = await db
        .insert(forcedRescanLog)
        .values({ userId: user.id, orgId, monitorId: m.id })
        .returning({ id: forcedRescanLog.id });
      logId = log!.id;
      usageToday++;
    }
    try {
      const handle = await tasks.trigger("scrape-monitor", {
        monitorId: m.id,
        force: true,
        ...(logId
          ? { triggeredBy: "user_forced_rescan" as const, userId: user.id, forcedRescanLogId: logId }
          : {}),
      });
      if (logId) {
        await db.update(forcedRescanLog).set({ taskId: handle.id }).where(eq(forcedRescanLog.id, logId));
      }
      scrapedIds.push(m.id);
    } catch (e) {
      console.error("Failed to trigger self rescan", { monitorId: m.id, error: String(e) });
    }
  }
  await markScanning(scrapedIds);

  // Nothing ran because the cap was already spent → surface the same 429 as elsewhere.
  if (limitReached && scrapedIds.length === 0) {
    return c.json(rescanLimitBody(plan, limit), 429);
  }
  return c.json({ ok: true, monitors: scrapedIds.length, limitReached, dailyLimit: limit });
});

// GET /api/my-product/changes?status=pending — detected changes awaiting review.
myProductRouter.get("/changes", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const statusParam = c.req.query("status");

  const validStatus =
    statusParam === "pending" ||
    statusParam === "accepted" ||
    statusParam === "modified" ||
    statusParam === "ignored"
      ? statusParam
      : null;

  const where = validStatus
    ? and(eq(selfProductChanges.orgId, orgId), eq(selfProductChanges.status, validStatus))
    : eq(selfProductChanges.orgId, orgId);

  const rows = await db.query.selfProductChanges.findMany({
    where,
    orderBy: desc(selfProductChanges.detectedAt),
    limit: 100,
  });
  return c.json({ changes: rows });
});

/** Resolve a pending self change to a terminal status. Returns the change or null. */
async function resolveChange(
  orgId: string,
  id: string,
  status: "accepted" | "modified" | "ignored",
) {
  const change = await db.query.selfProductChanges.findFirst({
    where: and(eq(selfProductChanges.id, id), eq(selfProductChanges.orgId, orgId)),
  });
  if (!change) return null;
  await db
    .update(selfProductChanges)
    .set({ status, resolvedAt: new Date() })
    .where(eq(selfProductChanges.id, id));
  return change;
}

// Profile fields a divergence proposal can target (recorded by extract-self-profile
// when the freshly detected value diverged from a field the user had edited).
const PROFILE_FIELD_KEYS = ["category", "audience", "valueProp", "features", "techStack"] as const;
function isProfileFieldPath(p: string): p is (typeof PROFILE_FIELD_KEYS)[number] {
  return (PROFILE_FIELD_KEYS as readonly string[]).includes(p);
}

// Optional curated value the user picked in the review sheet (granular accept or
// inline edit). When absent, accepting applies the raw detected value as-is.
const AcceptSchema = z.object({
  value: z.union([z.string(), z.array(z.string().max(200)).max(60)]).optional(),
});

/** Order-independent canonical form, to tell an as-is accept from a curated one. */
function canonProfileValue(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (Array.isArray(v)) return JSON.stringify([...v].map((x) => String(x).trim()).sort());
  return JSON.stringify(v ?? null);
}

// POST /api/my-product/changes/:id/accept — acknowledge the change. For HTML-diff
// changes the auto-detected profile already reflects the new state, so accepting just
// resolves the change. For a profile-divergence proposal (changeId null) the field was
// kept sticky, so accepting applies the value and hands it back to auto-detection —
// unless the user curated it (granular pick / edit), in which case it stays sticky so
// the next scrape won't silently overwrite their choice. A major change also suggests
// a competitor re-discovery.
myProductRouter.post("/changes/:id/accept", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const body = await c.req.json().catch(() => null);
  const parsedBody = AcceptSchema.safeParse(body ?? {});
  if (!parsedBody.success) {
    return c.json({ error: "Invalid body", issues: parsedBody.error.issues }, 400);
  }
  const override = parsedBody.data.value;

  const change = await resolveChange(orgId, c.req.param("id"), "accepted");
  if (!change) return c.json({ error: "Not found" }, 404);

  if (change.changeId === null && isProfileFieldPath(change.fieldPath) && change.newValue != null) {
    const applied = override ?? change.newValue;
    // Curated (differs from what we detected) → keep sticky so auto-detect won't
    // clobber it. Accepted as-is → hand back to auto-detection (tracks the live site).
    const isCurated =
      override !== undefined &&
      canonProfileValue(override) !== canonProfileValue(change.newValue);
    const self = await getSelf(orgId);
    if (self) {
      const profile = (self.selfProfile ?? {}) as SelfProfile;
      const nextProfile = {
        ...profile,
        [change.fieldPath]: {
          value: applied,
          isFromAutoDetect: !isCurated,
          lastEditedByUserAt: isCurated ? new Date().toISOString() : null,
        },
      } as SelfProfile;
      await db
        .update(competitors)
        .set({ selfProfile: nextProfile, updatedAt: new Date() })
        .where(eq(competitors.id, self.id));
    }
  }

  if (change.severity === "major") {
    return c.json({
      ok: true,
      suggestion: {
        action: "rediscover",
        reason:
          "Your profile changed significantly. Some of your competitors may need to be re-evaluated.",
      },
    });
  }
  return c.json({ ok: true, suggestion: null });
});

// POST /api/my-product/changes/:id/modify — the user will hand-edit instead of accepting
// the detected value as-is. Marks "modified"; the actual edit goes through PATCH /.
myProductRouter.post("/changes/:id/modify", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const change = await resolveChange(orgId, c.req.param("id"), "modified");
  if (!change) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

// POST /api/my-product/changes/:id/ignore — dismiss the change, profile untouched.
myProductRouter.post("/changes/:id/ignore", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const change = await resolveChange(orgId, c.req.param("id"), "ignored");
  if (!change) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});
