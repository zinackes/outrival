import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { tasks } from "@trigger.dev/sdk/v3";
import {
  competitors,
  monitors,
  jobPostings,
  selfProductChanges,
  type SelfProfile,
  type SelfProfileField,
} from "@outrival/db";
import { db } from "../lib/db";
import { authMiddleware } from "../middleware/auth";
import { ensureUserOrg } from "../lib/org";
import { chQuery } from "../lib/clickhouse-safe";

type Variables = { user: { id: string } };

export const myProductRouter = new Hono<{ Variables: Variables }>();

myProductRouter.use("*", authMiddleware);

/** The org's single self-competitor (its own product), or null if not created yet. */
async function getSelf(orgId: string) {
  return db.query.competitors.findFirst({
    where: and(eq(competitors.orgId, orgId), eq(competitors.type, "self")),
  });
}

/** Mark a profile field as user-edited (sticky against future auto-detection). */
function editedField<T>(value: T): SelfProfileField<T> {
  return { value, isFromAutoDetect: false, lastEditedByUserAt: new Date().toISOString() };
}

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
    })
    .optional(),
});

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

  // Latest pricing batch from ClickHouse (best-effort: [] if CH is down/unset).
  const pricingRows = await chQuery<{
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
      ORDER BY pricing_history.recorded_at DESC
      LIMIT 40
    `,
    params: { competitorId: self.id },
  });
  const latestAt = pricingRows[0]?.recorded_at ?? null;
  const tiers = latestAt ? pricingRows.filter((r) => r.recorded_at === latestAt) : [];

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
      lastScanAt: lastScanAt > 0 ? new Date(lastScanAt).toISOString() : null,
      aiSummary: self.aiSummary,
      profile: (self.selfProfile ?? {}) as SelfProfile,
      pricing: {
        status: self.pricingStatus,
        observedRegion: self.pricingObservedRegion,
        promotional: self.pricingPromotional,
        demoUrl: self.pricingDemoUrl,
        note: self.pricingNote,
        manualOverride: self.pricingManualOverride,
        tiers,
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

// POST /api/my-product/rescan — force a fresh scrape of every self monitor now.
myProductRouter.post("/rescan", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const self = await getSelf(orgId);
  if (!self) return c.json({ error: "no_self_product" }, 404);

  const selfMonitors = await db.query.monitors.findMany({
    where: eq(monitors.competitorId, self.id),
  });
  for (const m of selfMonitors) {
    try {
      await tasks.trigger("scrape-monitor", { monitorId: m.id, force: true });
    } catch (e) {
      console.error("Failed to trigger self rescan", { monitorId: m.id, error: String(e) });
    }
  }
  return c.json({ ok: true, monitors: selfMonitors.length });
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

// POST /api/my-product/changes/:id/accept — acknowledge the change. The auto-detected
// profile already reflects the new state (the scrape pipeline keeps it current), so
// accepting just resolves the change. A major change suggests a competitor re-discovery.
myProductRouter.post("/changes/:id/accept", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const change = await resolveChange(orgId, c.req.param("id"), "accepted");
  if (!change) return c.json({ error: "Not found" }, 404);

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
