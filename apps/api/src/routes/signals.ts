import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import { signals, competitors } from "@outrival/db";
import { db } from "../lib/db";
import { authMiddleware } from "../middleware/auth";
import { ensureUserOrg } from "../lib/org";

type Variables = { user: { id: string } };

export const signalsRouter = new Hono<{ Variables: Variables }>();

signalsRouter.use("*", authMiddleware);

signalsRouter.get("/", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
  const competitorIdFilter = c.req.query("competitorId");
  const severityFilter = c.req.query("severity");
  const unreadOnly = c.req.query("unreadOnly") === "true";

  const conds = [eq(signals.orgId, orgId)];
  if (competitorIdFilter) conds.push(eq(signals.competitorId, competitorIdFilter));
  if (severityFilter === "low" || severityFilter === "medium" || severityFilter === "high" || severityFilter === "critical") {
    conds.push(eq(signals.severity, severityFilter));
  }
  if (unreadOnly) conds.push(eq(signals.isRead, false));

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
      competitorId: signals.competitorId,
      competitorName: competitors.name,
      changeId: signals.changeId,
    })
    .from(signals)
    .innerJoin(competitors, eq(competitors.id, signals.competitorId))
    .where(and(...conds))
    .orderBy(desc(signals.createdAt))
    .limit(limit);

  return c.json({ signals: rows });
});

signalsRouter.patch("/:id/read", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const id = c.req.param("id");

  const signal = await db.query.signals.findFirst({
    where: and(eq(signals.id, id), eq(signals.orgId, orgId)),
  });
  if (!signal) return c.json({ error: "Not found" }, 404);

  await db.update(signals).set({ isRead: true }).where(eq(signals.id, id));
  return c.json({ ok: true });
});
