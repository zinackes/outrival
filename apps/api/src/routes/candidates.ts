import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import { tasks } from "@trigger.dev/sdk/v3";
import { competitorCandidates, competitors, monitors } from "@outrival/db";
import { db } from "../lib/db";
import { authMiddleware } from "../middleware/auth";
import { ensureUserOrg } from "../lib/org";
import { checkCompetitorQuota, getOrgPlan } from "../lib/plan";

type Variables = { user: { id: string } };

export const candidatesRouter = new Hono<{ Variables: Variables }>();

candidatesRouter.use("*", authMiddleware);

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
