import { Hono } from "hono";
import { and, desc, eq, isNull } from "drizzle-orm";
import { sectoralSignals } from "@outrival/db";
import { db } from "../lib/db";
import { authMiddleware } from "../middleware/auth";
import { ensureUserOrg } from "../lib/org";

type Variables = { user: { id: string } };

export const sectoralRouter = new Hono<{ Variables: Variables }>();

sectoralRouter.use("*", authMiddleware);

// Sectoral signals for the caller's org only (patch-13). Non-dismissed, newest first.
sectoralRouter.get("/", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);

  const rows = await db
    .select({
      id: sectoralSignals.id,
      category: sectoralSignals.category,
      title: sectoralSignals.title,
      insight: sectoralSignals.insight,
      evidence: sectoralSignals.evidence,
      confidence: sectoralSignals.confidence,
      periodStart: sectoralSignals.periodStart,
      periodEnd: sectoralSignals.periodEnd,
      readAt: sectoralSignals.readAt,
      createdAt: sectoralSignals.createdAt,
    })
    .from(sectoralSignals)
    .where(and(eq(sectoralSignals.orgId, orgId), isNull(sectoralSignals.dismissedAt)))
    .orderBy(desc(sectoralSignals.createdAt))
    .limit(limit);

  return c.json({ signals: rows });
});

sectoralRouter.post("/:id/read", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const id = c.req.param("id");

  const existing = await db.query.sectoralSignals.findFirst({
    where: and(eq(sectoralSignals.id, id), eq(sectoralSignals.orgId, orgId)),
  });
  if (!existing) return c.json({ error: "Not found" }, 404);

  await db
    .update(sectoralSignals)
    .set({ readAt: new Date() })
    .where(eq(sectoralSignals.id, id));
  return c.json({ ok: true });
});

sectoralRouter.post("/:id/dismiss", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const id = c.req.param("id");

  const existing = await db.query.sectoralSignals.findFirst({
    where: and(eq(sectoralSignals.id, id), eq(sectoralSignals.orgId, orgId)),
  });
  if (!existing) return c.json({ error: "Not found" }, 404);

  // Soft state — keep the row for history, just hide it from the feed.
  await db
    .update(sectoralSignals)
    .set({ dismissedAt: new Date() })
    .where(eq(sectoralSignals.id, id));
  return c.json({ ok: true });
});
