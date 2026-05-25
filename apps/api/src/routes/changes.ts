import { Hono } from "hono";
import { and, desc, eq, isNull } from "drizzle-orm";
import { changes, monitors, competitors } from "@outrival/db";
import { db } from "../lib/db";
import { authMiddleware } from "../middleware/auth";
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
        competitorIdFilter ? eq(competitors.id, competitorIdFilter) : undefined,
      ),
    )
    .orderBy(desc(changes.detectedAt))
    .limit(limit);

  return c.json({ changes: rows });
});
