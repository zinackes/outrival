import { Hono } from "hono";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { captureServerEvent } from "../lib/posthog";
import {
  signals,
  competitors,
  changes,
  monitors,
  snapshots,
  qualityFeedback,
  aiQualityChecks,
  signalComments,
  signalBatches,
  users,
} from "@outrival/db";
import { computeThreatScore, getBytesFromR2 } from "@outrival/shared";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../lib/db";
import { authMiddleware } from "../middleware/auth";
import { ensureUserOrg } from "../lib/org";
import { notFound } from "../lib/errors";

type Variables = { user: { id: string } };

export const signalsRouter = new Hono<{ Variables: Variables }>();

signalsRouter.use("*", authMiddleware);

// Intel → action loop (Phase B). Triage statuses a user can set on a signal.
const ACTION_STATUSES = ["todo", "doing", "done", "dismissed"] as const;

signalsRouter.get("/", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
  const competitorIdFilter = c.req.query("competitorId");
  const severityFilter = c.req.query("severity");
  const unreadOnly = c.req.query("unreadOnly") === "true";
  // patch-28 — scope the feed to one product (SKU). Signals are tagged with the
  // products affected (signals.productIds) at creation; "All products" omits it.
  const productIdFilter = c.req.query("productId");
  // Phase B — action board: "open" = todo|doing; a specific status filters to it.
  const actionStatusFilter = c.req.query("actionStatus");
  // P0 — feed ordering. Default "threat": severity × competitor overlap × relevance,
  // so the frontal competitor moving on our turf outranks a tangential one. "recent"
  // restores the chronological feed.
  const sort = c.req.query("sort") === "recent" ? "recent" : "threat";

  // Hide signals the user marked "not useful" (patch-21). Also drop signals whose
  // competitor was soft-deleted — otherwise the feed (and the filter dropdown built
  // from it) keeps surfacing stale competitors the user no longer tracks.
  const conds = [
    eq(signals.orgId, orgId),
    isNull(signals.hiddenForUserAt),
    isNull(competitors.deletedAt),
  ];
  if (competitorIdFilter) conds.push(eq(signals.competitorId, competitorIdFilter));
  if (productIdFilter) {
    conds.push(sql`${signals.productIds} @> ${JSON.stringify([productIdFilter])}::jsonb`);
  }
  if (actionStatusFilter === "open") {
    conds.push(inArray(signals.actionStatus, ["todo", "doing"]));
  } else if ((ACTION_STATUSES as readonly string[]).includes(actionStatusFilter ?? "")) {
    conds.push(eq(signals.actionStatus, actionStatusFilter as (typeof ACTION_STATUSES)[number]));
  }
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
      // Intel → action loop (Phase B): the user's triage state on this signal.
      actionStatus: signals.actionStatus,
      actionNote: signals.actionNote,
      createdAt: signals.createdAt,
      competitorId: signals.competitorId,
      competitorName: competitors.name,
      // The competitor's site, used to render its favicon in the feed avatar
      // (falls back to the initial letter when null or the icon fails to load).
      competitorUrl: competitors.url,
      // User-assigned color identity (palette token / hex), so the feed avatar +
      // card accent can be tinted. Null = neutral.
      competitorColor: competitors.color,
      // P0 threat inputs: how much this competitor overlaps with us (0-100, nullable)
      // and the change's composite relevance (0-1, nullable). Surfaced so the client
      // can show the threat indicator without recomputing.
      overlapScore: competitors.overlapScore,
      relevanceScore: signals.relevanceScore,
      // Signal batching (patch-26): when several similar signals were grouped, the
      // feed collapses them under one card with the batch's AI summary instead of
      // N near-duplicates. Null for un-batched signals.
      batchedIntoId: signals.batchedIntoId,
      batchSummary: signalBatches.summary,
      batchCount: signalBatches.count,
      // Notification moderation transparency (patch-26): why a signal wasn't sent
      // as an immediate alert (quiet hours / cap / threshold / muted). Null = it
      // wasn't held back. Critical signals bypass moderation entirely.
      filteredReason: signals.filteredReason,
      changeId: signals.changeId,
      // Surfaced inline by the signal source line (patch-14). Joined through the
      // originating change → monitor; null for signals whose change/monitor was
      // since removed.
      sourceType: monitors.sourceType,
      // The current user's quality verdict on this signal (patch-21), so the
      // inline feedback buttons render in the right state without an extra request.
      feedbackVerdict: qualityFeedback.verdict,
      // …and its row id, so re-clicking the active thumb removes the verdict
      // (the delete path needs the id) instead of silently re-submitting it.
      feedbackId: qualityFeedback.id,
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
    .leftJoin(signalBatches, eq(signalBatches.id, signals.batchedIntoId))
    .where(and(...conds))
    // Threat ordering done in SQL so the LIMIT keeps the most threatening signals,
    // not just the most recent N. Mirrors computeThreatScore (severity uses the
    // user override when set), with createdAt as the tie-break. NULL overlap/relevance
    // fall back to the same neutral 0.5 as the shared scorer.
    .orderBy(
      ...(sort === "recent"
        ? [desc(signals.createdAt)]
        : [
            sql`(
              CASE COALESCE(${signals.severityOverride}, ${signals.severity})
                WHEN 'critical' THEN 1 WHEN 'high' THEN 0.75 WHEN 'medium' THEN 0.5 ELSE 0.25
              END
              * COALESCE(${competitors.overlapScore} / 100.0, 0.5)
              * COALESCE(${signals.relevanceScore}, 0.5)
            ) DESC`,
            desc(signals.createdAt),
          ]),
    )
    .limit(limit);

  // Attach the threat score per row (same formula as the SQL ordering) so the feed
  // can render a discreet indicator. Uses the effective severity (override wins).
  const withThreat = rows.map((r) => ({
    ...r,
    threatScore: computeThreatScore({
      severity: r.severityOverride ?? r.severity,
      overlapScore: r.overlapScore,
      relevanceScore: r.relevanceScore,
    }),
  }));

  return c.json({ signals: withThreat });
});

// User-safe "Why this insight?" detail (patch-14, progressive disclosure level 2).
// Exposes ONLY what the user can consume: the plain-language before/after, the
// monitored page (live URL), and when it was detected. NEVER the R2 snapshot, the
// raw diff, or the AI classification — the admin tooling (patch-02) covers those.
signalsRouter.get("/:id/detail", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const id = c.req.param("id");

  // Second snapshots join for the BEFORE screenshot (the existing join is AFTER).
  const beforeSnap = alias(snapshots, "before_snap");

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
      // Visual diff (Phase 8): a non-null screenshot pHash means a PNG was captured
      // for that snapshot — the cheap, reliable availability proxy (no R2 HEAD).
      afterPhash: snapshots.screenshotPhash,
      beforePhash: beforeSnap.screenshotPhash,
    })
    .from(signals)
    .innerJoin(competitors, eq(competitors.id, signals.competitorId))
    .leftJoin(changes, eq(changes.id, signals.changeId))
    .leftJoin(monitors, eq(monitors.id, changes.monitorId))
    .leftJoin(snapshots, eq(snapshots.id, changes.snapshotAfterId))
    .leftJoin(beforeSnap, eq(beforeSnap.id, changes.snapshotBeforeId))
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

  const visualDiffEnabled = process.env.VISUAL_DIFF_ENABLED !== "false";

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
      // Whether a before/after homepage screenshot is available to render (visual diff).
      screenshots: {
        before: visualDiffEnabled && row.sourceType === "homepage" && !!row.beforePhash,
        after: visualDiffEnabled && row.sourceType === "homepage" && !!row.afterPhash,
      },
      competitor: { id: row.competitorId, name: row.competitorName },
    },
  });
});

// Visual diff (Phase 8): stream the before/after homepage screenshot for a signal's
// change. Org-scoped (the signal must belong to the caller's org) — the R2 key never
// leaves the server (proxy, like the admin feedback-screenshot route). Homepage-only;
// 404 when the side/snapshot/PNG is absent (before is nullable; pre-patch snapshots
// have no screenshot).
signalsRouter.get("/:id/screenshot/:side", async (c) => {
  if (process.env.VISUAL_DIFF_ENABLED === "false") return c.json(notFound("screenshot"), 404);
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const id = c.req.param("id");
  const side = c.req.param("side");
  if (side !== "before" && side !== "after") return c.json(notFound("screenshot"), 404);

  const [row] = await db
    .select({
      r2Key: snapshots.r2Key,
      sourceType: monitors.sourceType,
      phash: snapshots.screenshotPhash,
    })
    .from(signals)
    .innerJoin(changes, eq(changes.id, signals.changeId))
    .innerJoin(monitors, eq(monitors.id, changes.monitorId))
    .innerJoin(
      snapshots,
      eq(snapshots.id, side === "before" ? changes.snapshotBeforeId : changes.snapshotAfterId),
    )
    .where(and(eq(signals.id, id), eq(signals.orgId, orgId)))
    .limit(1);

  if (!row || row.sourceType !== "homepage" || !row.phash) {
    return c.json(notFound("screenshot"), 404);
  }

  try {
    const bytes = await getBytesFromR2(`${row.r2Key}.png`);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch {
    return c.json(notFound("screenshot"), 404);
  }
});

signalsRouter.patch("/:id/read", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const id = c.req.param("id");

  // Body is optional and defaults to read=true (back-compat). `read: false` lets the
  // feed revert an auto-read signal to unread.
  const body = (await c.req.json().catch(() => ({}))) as { read?: unknown };
  const read = body.read === undefined ? true : Boolean(body.read);

  const signal = await db.query.signals.findFirst({
    where: and(eq(signals.id, id), eq(signals.orgId, orgId)),
    columns: { id: true },
  });
  if (!signal) return c.json(notFound("signal"), 404);

  await db.update(signals).set({ isRead: read }).where(eq(signals.id, id));
  return c.json({ ok: true });
});

// Intel → action loop (Phase B). Set/clear a signal's triage status + optional note.
// status null untriages it. Org-scoped.
signalsRouter.patch("/:id/action", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const id = c.req.param("id");

  const body = (await c.req.json().catch(() => ({}))) as { status?: unknown; note?: unknown };
  const status = body.status ?? null;
  if (status !== null && !(ACTION_STATUSES as readonly string[]).includes(status as string)) {
    return c.json({ error: "invalid_status" }, 400);
  }
  const note = typeof body.note === "string" ? body.note.slice(0, 2000) : null;

  const signal = await db.query.signals.findFirst({
    where: and(eq(signals.id, id), eq(signals.orgId, orgId)),
    columns: { id: true },
  });
  if (!signal) return c.json(notFound("signal"), 404);

  await db
    .update(signals)
    .set({
      actionStatus: status as (typeof ACTION_STATUSES)[number] | null,
      actionNote: note,
      actionUpdatedAt: new Date(),
    })
    .where(eq(signals.id, id));

  if (status) {
    void captureServerEvent(user.id, "signal_action_updated", {
      signalId: id,
      actionStatus: status,
      orgId,
    });
  }

  return c.json({ ok: true });
});

// ── Signal comments (Phase C) ──────────────────────────────────────────────────
// Org-scoped thread on a signal. Single-user today; `mine` lets the client show a
// delete affordance only on the caller's own comments. See docs/distribution-team.md.

async function ownsSignal(id: string, orgId: string): Promise<boolean> {
  const sig = await db.query.signals.findFirst({
    where: and(eq(signals.id, id), eq(signals.orgId, orgId)),
    columns: { id: true },
  });
  return Boolean(sig);
}

signalsRouter.get("/:id/comments", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const id = c.req.param("id");
  if (!(await ownsSignal(id, orgId))) return c.json(notFound("signal"), 404);

  const rows = await db
    .select({
      id: signalComments.id,
      userId: signalComments.userId,
      authorName: signalComments.authorName,
      body: signalComments.body,
      createdAt: signalComments.createdAt,
    })
    .from(signalComments)
    .where(eq(signalComments.signalId, id))
    .orderBy(signalComments.createdAt);

  return c.json({ comments: rows.map((r) => ({ ...r, mine: r.userId === user.id })) });
});

signalsRouter.post("/:id/comments", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const id = c.req.param("id");
  if (!(await ownsSignal(id, orgId))) return c.json(notFound("signal"), 404);

  const body = (await c.req.json().catch(() => ({}))) as { body?: unknown };
  const text = typeof body.body === "string" ? body.body.trim().slice(0, 2000) : "";
  if (!text) return c.json({ error: "body_required" }, 400);

  const u = await db.query.users.findFirst({
    where: eq(users.id, user.id),
    columns: { name: true, email: true },
  });
  const authorName = u?.name ?? u?.email ?? "You";

  const [row] = await db
    .insert(signalComments)
    .values({ signalId: id, orgId, userId: user.id, authorName, body: text })
    .returning({
      id: signalComments.id,
      userId: signalComments.userId,
      authorName: signalComments.authorName,
      body: signalComments.body,
      createdAt: signalComments.createdAt,
    });

  void captureServerEvent(user.id, "signal_comment_posted", { signalId: id, orgId });

  return c.json({ comment: { ...row, mine: true } }, 201);
});

signalsRouter.delete("/:id/comments/:commentId", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const commentId = c.req.param("commentId");
  // A user can delete only their own comment (within their org).
  await db
    .delete(signalComments)
    .where(
      and(
        eq(signalComments.id, commentId),
        eq(signalComments.orgId, orgId),
        eq(signalComments.userId, user.id),
      ),
    );
  return c.json({ ok: true });
});
