import { Hono } from "hono";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  signals,
  competitors,
  changes,
  monitors,
  snapshots,
  qualityFeedback,
  aiQualityChecks,
} from "@outrival/db";
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

  // Hide signals the user marked "not useful" (patch-21).
  const conds = [eq(signals.orgId, orgId), isNull(signals.hiddenForUserAt)];
  if (competitorIdFilter) conds.push(eq(signals.competitorId, competitorIdFilter));
  if (severityFilter === "low" || severityFilter === "medium" || severityFilter === "high" || severityFilter === "critical") {
    conds.push(eq(signals.severity, severityFilter));
  }
  if (unreadOnly) conds.push(eq(signals.isRead, false));

  const rows = await db
    .select({
      id: signals.id,
      severity: signals.severity,
      // User-set severity override (patch-21); the client prefers it over `severity`.
      severityOverride: signals.severityOverride,
      category: signals.category,
      insight: signals.insight,
      soWhat: signals.soWhat,
      recommendedAction: signals.recommendedAction,
      // Strategic narrative for significant structured homepage changes (patch-16);
      // null for everything else → the card falls back to just the insight title.
      narrative: signals.narrative,
      isRead: signals.isRead,
      createdAt: signals.createdAt,
      competitorId: signals.competitorId,
      competitorName: competitors.name,
      changeId: signals.changeId,
      // Surfaced inline by the signal source line (patch-14). Joined through the
      // originating change → monitor; null for signals whose change/monitor was
      // since removed.
      sourceType: monitors.sourceType,
      // The current user's quality verdict on this signal (patch-21), so the
      // inline feedback buttons render in the right state without an extra request.
      feedbackVerdict: qualityFeedback.verdict,
      // AI self-confidence + self-check flag (patch-24): drives the ConfidenceDot
      // and the "couldn't be verified" warning. One quality check per signal
      // (generate-signal is idempotent by changeId), so this join stays 1:1.
      aiConfidence: aiQualityChecks.confidence,
      aiFlagged: aiQualityChecks.flaggedForHumanReview,
      aiQualityCheckId: aiQualityChecks.id,
    })
    .from(signals)
    .innerJoin(competitors, eq(competitors.id, signals.competitorId))
    .leftJoin(changes, eq(changes.id, signals.changeId))
    .leftJoin(monitors, eq(monitors.id, changes.monitorId))
    .leftJoin(
      qualityFeedback,
      and(
        eq(qualityFeedback.targetId, signals.id),
        eq(qualityFeedback.targetType, "signal"),
        eq(qualityFeedback.userId, user.id),
      ),
    )
    .leftJoin(
      aiQualityChecks,
      and(
        eq(aiQualityChecks.targetId, signals.id),
        eq(aiQualityChecks.targetType, "signal"),
      ),
    )
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
      severityOverride: signals.severityOverride,
      category: signals.category,
      detectedAt: signals.createdAt,
      humanChangeBefore: signals.humanChangeBefore,
      humanChangeAfter: signals.humanChangeAfter,
      narrative: signals.narrative,
      // Per-change breakdown for structured homepage changes (patch-16): the typed
      // semantic changes with their significance. User-safe (no raw HTML/diff) —
      // null/empty for lexical changes and pre-patch signals.
      structuredDiff: changes.structuredDiff,
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

  // Structured per-change breakdown (patch-16/17). Only the major/minor changes
  // are worth surfacing; trivial ones (e.g. pure reorders) are dropped. metadata
  // carries patch-17 extras (claim variation, relevance score) for the panel.
  const rawChanges = Array.isArray(row.structuredDiff)
    ? (row.structuredDiff as Array<{
        kind?: string;
        field?: string;
        before?: string | null;
        after?: string | null;
        significance?: string;
        metadata?: Record<string, unknown> | null;
      }>)
    : [];
  const breakdown = rawChanges
    .filter((ch) => ch.significance !== "trivial")
    .map((ch) => ({
      kind: ch.kind ?? "",
      field: ch.field ?? "",
      before: ch.before ?? null,
      after: ch.after ?? null,
      significance: ch.significance ?? null,
      metadata: ch.metadata ?? null,
    }));

  // Composite relevance score (patch-17): the max across the change set. Shown
  // discreetly — it's mostly for calibrating thresholds during beta.
  const relevanceScore = rawChanges.reduce<number | null>((max, ch) => {
    const s = ch.metadata?.relevanceScore;
    return typeof s === "number" && (max === null || s > max) ? s : max;
  }, null);

  return c.json({
    signal: {
      id: row.id,
      insight: row.insight,
      // Prefer the user's severity override (patch-21) over the AI classification.
      severity: row.severityOverride ?? row.severity,
      category: row.category,
      detectedAt: row.detectedAt,
      humanChangeBefore: row.humanChangeBefore,
      humanChangeAfter: row.humanChangeAfter,
      narrative: row.narrative,
      changes: breakdown,
      relevanceScore,
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
