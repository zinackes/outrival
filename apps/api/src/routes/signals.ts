import { Hono } from "hono";
import { and, desc, eq, sql } from "drizzle-orm";
import { signals, competitors, changes, monitors, snapshots } from "@outrival/db";
import { db } from "../lib/db";
import { authMiddleware } from "../middleware/auth";
import { ensureUserOrg } from "../lib/org";
import { notFound } from "../lib/errors";

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
      // Surfaced inline by the signal source line (patch-14). Joined through the
      // originating change → monitor; null for signals whose change/monitor was
      // since removed.
      sourceType: monitors.sourceType,
    })
    .from(signals)
    .innerJoin(competitors, eq(competitors.id, signals.competitorId))
    .leftJoin(changes, eq(changes.id, signals.changeId))
    .leftJoin(monitors, eq(monitors.id, changes.monitorId))
    .where(and(...conds))
    .orderBy(desc(signals.createdAt))
    .limit(limit);

  return c.json({ signals: rows });
});

// User-safe "Why this insight?" detail (patch-14, progressive disclosure level 2).
// Exposes ONLY what the user can consume: the plain-language before/after, the
// monitored page (live URL), and when it was detected. NEVER the R2 snapshot, the
// raw diff, or the AI classification — the admin tooling (patch-02) covers those.
signalsRouter.get("/:id/detail", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const id = c.req.param("id");

  const [row] = await db
    .select({
      id: signals.id,
      insight: signals.insight,
      severity: signals.severity,
      category: signals.category,
      detectedAt: signals.createdAt,
      humanChangeBefore: signals.humanChangeBefore,
      humanChangeAfter: signals.humanChangeAfter,
      competitorId: competitors.id,
      competitorName: competitors.name,
      sourceType: monitors.sourceType,
      // The live page the user can open. resolved_url is the exact page the
      // scraper landed on; fall back to a pinned monitor URL, then the
      // competitor homepage so the link is never dead.
      sourceUrl: sql<
        string | null
      >`COALESCE(${snapshots.resolvedUrl}, ${monitors.config}->>'url', ${competitors.url})`,
    })
    .from(signals)
    .innerJoin(competitors, eq(competitors.id, signals.competitorId))
    .leftJoin(changes, eq(changes.id, signals.changeId))
    .leftJoin(monitors, eq(monitors.id, changes.monitorId))
    .leftJoin(snapshots, eq(snapshots.id, changes.snapshotAfterId))
    .where(and(eq(signals.id, id), eq(signals.orgId, orgId)))
    .limit(1);

  if (!row) return c.json(notFound("signal"), 404);

  return c.json({
    signal: {
      id: row.id,
      insight: row.insight,
      severity: row.severity,
      category: row.category,
      detectedAt: row.detectedAt,
      humanChangeBefore: row.humanChangeBefore,
      humanChangeAfter: row.humanChangeAfter,
      sourceType: row.sourceType,
      sourceUrl: row.sourceUrl,
      competitor: { id: row.competitorId, name: row.competitorName },
    },
  });
});

signalsRouter.patch("/:id/read", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const id = c.req.param("id");

  const signal = await db.query.signals.findFirst({
    where: and(eq(signals.id, id), eq(signals.orgId, orgId)),
  });
  if (!signal) return c.json(notFound("signal"), 404);

  await db.update(signals).set({ isRead: true }).where(eq(signals.id, id));
  return c.json({ ok: true });
});
