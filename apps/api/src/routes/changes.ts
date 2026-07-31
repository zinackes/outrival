import { Hono } from "hono";
import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { classifyChange } from "@outrival/queue";
import { changes, monitors, competitors, signals } from "@outrival/db";
import { db } from "../lib/db";
import { authMiddleware } from "../middleware/auth";
import { aiIntensiveRateLimit } from "../middleware/ai-intensive-rate-limit";
import { ensureUserOrg } from "../lib/org";
import { enqueueJob } from "../lib/queue";

type Variables = { user: { id: string } };

export const changesRouter = new Hono<{ Variables: Variables }>();

changesRouter.use("*", authMiddleware);

changesRouter.get("/", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
  const competitorIdFilter = c.req.query("competitorId");
  // One monitor's own history — what the per-page drawer on the Sources page
  // reads. Ownership still goes through the competitor join below, so a forged
  // id yields no rows rather than another org's changes.
  const monitorIdFilter = c.req.query("monitorId");

  const rows = await db
    .select({
      id: changes.id,
      // diff_text rows run up to 50KB; the feed preview renders at most 18
      // lines, so cap the payload (200 rows × 50KB was a ~10MB response).
      diffText: sql<string | null>`left(${changes.diffText}, 4000)`,
      summary: changes.summary,
      detectedAt: changes.detectedAt,
      monitorId: changes.monitorId,
      sourceType: monitors.sourceType,
      competitorId: competitors.id,
      competitorName: competitors.name,
      competitorUrl: competitors.url,
      // The signal a change became, when it did: the insight is the readable
      // version of the diff, so a change list can say what happened instead of
      // pointing at raw text.
      signalId: signals.id,
      signalSeverity: signals.severity,
      signalCategory: signals.category,
      signalInsight: signals.insight,
    })
    .from(changes)
    .innerJoin(monitors, eq(monitors.id, changes.monitorId))
    .innerJoin(competitors, eq(competitors.id, monitors.competitorId))
    .leftJoin(signals, eq(signals.changeId, changes.id))
    .where(
      and(
        eq(competitors.orgId, orgId),
        isNull(competitors.deletedAt),
        // Self-competitor changes live on the "My product" page, not here.
        ne(competitors.type, "self"),
        competitorIdFilter ? eq(competitors.id, competitorIdFilter) : undefined,
        monitorIdFilter ? eq(changes.monitorId, monitorIdFilter) : undefined,
      ),
    )
    .orderBy(desc(changes.detectedAt))
    .limit(limit);

  return c.json({ changes: rows });
});

changesRouter.post("/:id/classify", aiIntensiveRateLimit, async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const id = c.req.param("id");

  const owned = await db
    .select({ id: changes.id })
    .from(changes)
    .innerJoin(monitors, eq(monitors.id, changes.monitorId))
    .innerJoin(competitors, eq(competitors.id, monitors.competitorId))
    .where(
      and(
        eq(changes.id, id),
        eq(competitors.orgId, orgId),
        isNull(competitors.deletedAt),
      ),
    )
    .limit(1);

  if (owned.length === 0) {
    return c.json({ error: "Not found" }, 404);
  }

  const jobId = await enqueueJob(classifyChange, { changeId: id });
  return c.json({ runId: jobId });
});
