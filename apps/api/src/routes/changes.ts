import { Hono } from "hono";
import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { tasks } from "@trigger.dev/sdk/v3";
import { changes, monitors, competitors } from "@outrival/db";
import { db } from "../lib/db";
import { authMiddleware } from "../middleware/auth";
import { aiIntensiveRateLimit } from "../middleware/ai-intensive-rate-limit";
import { ensureUserOrg } from "../lib/org";

type Variables = { user: { id: string } };

export const changesRouter = new Hono<{ Variables: Variables }>();

changesRouter.use("*", authMiddleware);

changesRouter.get("/", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
  const competitorIdFilter = c.req.query("competitorId");

  const rows = await db
    .select({
      id: changes.id,
      diffText: changes.diffText,
      detectedAt: changes.detectedAt,
      monitorId: changes.monitorId,
      sourceType: monitors.sourceType,
      competitorId: competitors.id,
      competitorName: competitors.name,
      competitorUrl: competitors.url,
    })
    .from(changes)
    .innerJoin(monitors, eq(monitors.id, changes.monitorId))
    .innerJoin(competitors, eq(competitors.id, monitors.competitorId))
    .where(
      and(
        eq(competitors.orgId, orgId),
        isNull(competitors.deletedAt),
        // Self-competitor changes live on the "My product" page, not here.
        ne(competitors.type, "self"),
        competitorIdFilter ? eq(competitors.id, competitorIdFilter) : undefined,
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

  const handle = await tasks.trigger("classify-change", { changeId: id });
  return c.json({ runId: handle.id });
});
