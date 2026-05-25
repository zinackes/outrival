import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq, isNull, inArray } from "drizzle-orm";
import {
  competitors,
  monitors,
  changes,
  signals,
  jobPostings,
  reviews,
} from "@outrival/db";
import { db } from "../lib/db";
import { authMiddleware } from "../middleware/auth";
import { ensureUserOrg } from "../lib/org";
import { chQuery } from "../lib/clickhouse-safe";
import { checkCompetitorQuota, getOrgPlan } from "../lib/plan";

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

competitorsRouter.get("/", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const list = await db.query.competitors.findMany({
    where: and(eq(competitors.orgId, orgId), isNull(competitors.deletedAt)),
    orderBy: desc(competitors.createdAt),
  });
  return c.json({ competitors: list });
});

competitorsRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const competitor = await assertOwnedCompetitor(id, orgId);
  if (!competitor) return c.json({ error: "Not found" }, 404);

  const monitorList = await db.query.monitors.findMany({
    where: eq(monitors.competitorId, competitor.id),
  });

  const monitorIds = monitorList.map((m) => m.id);
  const recentChanges = monitorIds.length
    ? await db.query.changes.findMany({
        where: inArray(changes.monitorId, monitorIds),
        orderBy: desc(changes.detectedAt),
        limit: 20,
      })
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
    })
    .from(signals)
    .where(eq(signals.competitorId, competitor.id))
    .orderBy(desc(signals.createdAt))
    .limit(20);

  return c.json({ competitor, monitors: monitorList, recentChanges, recentSignals });
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
        AND recorded_at >= now() - INTERVAL 90 DAY
      ORDER BY recorded_at ASC
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
        AND recorded_at >= now() - INTERVAL 180 DAY
      ORDER BY recorded_at ASC
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
      ORDER BY recorded_at ASC
    `,
    params: { competitorId: competitor.id },
  });

  return c.json({ history: rows });
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
