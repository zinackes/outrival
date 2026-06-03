import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import { tasks } from "@trigger.dev/sdk/v3";
import {
  competitorCandidates,
  competitors,
  discoveryRuns,
  monitors,
  organizations,
  selfProfileLastEditedAt,
} from "@outrival/db";
import { DetectionConfigSchema, resolveDetectionConfig } from "@outrival/shared";
import { db } from "../lib/db";
import { authMiddleware } from "../middleware/auth";
import { aiIntensiveRateLimit } from "../middleware/ai-intensive-rate-limit";
import { ensureUserOrg } from "../lib/org";
import { associateCompetitorWithPrimaryProduct } from "../lib/products";
import { checkCompetitorQuota, getOrgPlan } from "../lib/plan";
import { detectCandidatesForOrg } from "../lib/detect-candidates";

type Variables = { user: { id: string } };

export const candidatesRouter = new Hono<{ Variables: Variables }>();

candidatesRouter.use("*", authMiddleware);

// TEMP: rate limit désactivé pour les tests — repasser à true pour réactiver
const DETECT_RATE_LIMIT_ENABLED = false;
const DETECT_COOLDOWN_MS = 30 * 60 * 1000;
const lastDetectAt = new Map<string, number>();

const ConfigBodySchema = DetectionConfigSchema.extend({
  excludedDomains: z.array(z.string()).max(50),
  keywords: z.string().max(200),
});

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

// Latest moment the user hand-edited their self-product profile (patch-22): drives
// discovery staleness — editing the profile makes a past discovery worth re-running.
async function selfProfileEditedAt(orgId: string): Promise<Date | null> {
  const self = await db.query.competitors.findFirst({
    where: and(
      eq(competitors.orgId, orgId),
      eq(competitors.type, "self"),
      isNull(competitors.deletedAt),
    ),
  });
  return self ? (selfProfileLastEditedAt(self.selfProfile) ?? self.updatedAt) : null;
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

  const where =
    statusParam === "new" || statusParam === "dismissed" || statusParam === "added"
      ? and(
          eq(competitorCandidates.orgId, orgId),
          eq(competitorCandidates.status, statusParam),
        )
      : eq(competitorCandidates.orgId, orgId);

  const rows = await db.query.competitorCandidates.findMany({
    where,
    orderBy: desc(competitorCandidates.firstSeenAt),
    limit: 100,
  });

  return c.json({ candidates: rows });
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

  const lastRun = await db.query.discoveryRuns.findFirst({
    where: eq(discoveryRuns.orgId, orgId),
    orderBy: desc(discoveryRuns.lastDiscoveryAt),
  });
  if (!lastRun) {
    return c.json({ staleness: "never_run", needsRediscovery: true });
  }

  const daysSince = (Date.now() - lastRun.lastDiscoveryAt.getTime()) / 86400000;
  const profileAt = await selfProfileEditedAt(orgId);
  const profileChanged =
    !!profileAt &&
    (!lastRun.basedOnProfileUpdateAt || profileAt > lastRun.basedOnProfileUpdateAt);

  if (daysSince < 7 && !profileChanged) {
    return c.json({
      staleness: "fresh",
      needsRediscovery: false,
      lastDiscoveryAt: lastRun.lastDiscoveryAt,
      reason: "profile_unchanged_recent_run",
    });
  }

  return c.json({
    staleness: "outdated",
    needsRediscovery: true,
    lastDiscoveryAt: lastRun.lastDiscoveryAt,
    reason: profileChanged ? "profile_changed" : "stale_run",
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

  // patch-28 — tag this competitor into the org's primary product (shared).
  await associateCompetitorWithPrimaryProduct(orgId, competitor.id);

  const monitorRows = await db
    .insert(monitors)
    .values([
      { competitorId: competitor.id, sourceType: "homepage", frequency: "daily" },
      { competitorId: competitor.id, sourceType: "pricing", frequency: "daily" },
      { competitorId: competitor.id, sourceType: "blog", frequency: "weekly" },
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
  lastDetectAt.set(orgId, Date.now());

  try {
    const result = await detectCandidatesForOrg(orgId);
    if (!result.ok) {
      lastDetectAt.delete(orgId);
      return c.json({ error: result.error }, 400);
    }

    // Record the run for staleness (patch-22): snapshot the profile edit it was based
    // on so a later profile edit (or 7+ days) marks the next discovery worth running.
    const profileAt = await selfProfileEditedAt(orgId);
    const existingRun = await db.query.discoveryRuns.findFirst({
      where: eq(discoveryRuns.orgId, orgId),
    });
    if (existingRun) {
      await db
        .update(discoveryRuns)
        .set({ lastDiscoveryAt: new Date(), basedOnProfileUpdateAt: profileAt })
        .where(eq(discoveryRuns.id, existingRun.id));
    } else {
      await db
        .insert(discoveryRuns)
        .values({ orgId, lastDiscoveryAt: new Date(), basedOnProfileUpdateAt: profileAt });
    }

    return c.json({ detected: result.detected });
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
