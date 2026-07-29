import { Hono, type Context } from "hono";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
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
  user as authUser,
} from "@outrival/db";
import { computeThreatScore, getBytesFromR2, SIGNAL_CATEGORIES } from "@outrival/shared";
import { complete, withAiContext, AI_CONFIG } from "@outrival/ai";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../lib/db";
import { authMiddleware } from "../middleware/auth";
import { ensureUserOrg } from "../lib/org";
import { logApiAiRun } from "../lib/ai-runs";
import { notFound } from "../lib/errors";

type Variables = { user: { id: string } };

export const signalsRouter = new Hono<{ Variables: Variables }>();

signalsRouter.use("*", authMiddleware);

// Intel → action loop (Phase B). Triage statuses a user can set on a signal.
const ACTION_STATUSES = ["todo", "doing", "done", "dismissed"] as const;
const SEVERITIES = ["low", "medium", "high", "critical"] as const;
const CATEGORIES = SIGNAL_CATEGORIES;

// The full set of feed filters, parsed from the query string. Shared by the list,
// facets, mark-all-read and export handlers so they always agree on "the current
// scope". Multi-value filters arrive comma-separated (severity/category/competitor).
type FeedQuery = {
  productId?: string;
  competitorId?: string;
  competitors?: string[];
  categories?: string[];
  severities?: string[];
  view?: string;
  q?: string;
  unreadOnly?: boolean;
  actionStatus?: string;
  sort: "threat" | "recent";
};

function parseFeedQuery(c: Context): FeedQuery {
  const csv = (v: string | undefined) =>
    v ? v.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
  return {
    productId: c.req.query("productId") || undefined,
    competitorId: c.req.query("competitorId") || undefined,
    competitors: csv(c.req.query("competitor")),
    categories: csv(c.req.query("category")),
    severities: csv(c.req.query("severity")),
    view: c.req.query("view") || undefined,
    q: (c.req.query("q") || "").trim() || undefined,
    unreadOnly: c.req.query("unreadOnly") === "true",
    actionStatus: c.req.query("actionStatus") || undefined,
    sort: c.req.query("sort") === "recent" ? "recent" : "threat",
  };
}

// Build the WHERE conds for the feed. Base guards (org, not hidden, competitor not
// soft-deleted) + every active filter. Every query that scopes to "the feed" runs
// through this so the list, its counts, mark-all-read and export never drift apart.
// Requires an innerJoin on `competitors` (deletedAt + name search).
function feedConds(orgId: string, f: FeedQuery) {
  const conds = [
    eq(signals.orgId, orgId),
    isNull(signals.hiddenForUserAt),
    // Snoozed signals drop out of the feed until their time passes, then reappear.
    sql`(${signals.snoozedUntil} IS NULL OR ${signals.snoozedUntil} <= now())`,
    isNull(competitors.deletedAt),
  ];
  // patch-28 — scope to one product (SKU); "All products" omits it.
  if (f.productId) {
    conds.push(sql`${signals.productIds} @> ${JSON.stringify([f.productId])}::jsonb`);
  }
  if (f.competitorId) conds.push(eq(signals.competitorId, f.competitorId));
  if (f.competitors?.length) conds.push(inArray(signals.competitorId, f.competitors));
  if (f.categories?.length) {
    const cats = f.categories.filter((x): x is (typeof CATEGORIES)[number] =>
      (CATEGORIES as readonly string[]).includes(x),
    );
    if (cats.length) conds.push(inArray(signals.category, cats));
  }
  if (f.severities?.length) {
    const sevs = f.severities.filter((x): x is (typeof SEVERITIES)[number] =>
      (SEVERITIES as readonly string[]).includes(x),
    );
    if (sevs.length) conds.push(inArray(signals.severity, sevs));
  }
  // Quick view — mirrors the tabs. Raw severity (not the override) to match the
  // client's historical counts. "week" = this ISO week (Monday) in UTC.
  switch (f.view) {
    case "unread":
      conds.push(eq(signals.isRead, false));
      break;
    case "alerts":
      conds.push(inArray(signals.severity, ["critical", "high"]));
      break;
    case "critical":
      conds.push(eq(signals.severity, "critical"));
      break;
    case "actions":
      conds.push(inArray(signals.actionStatus, ["todo", "doing"]));
      break;
    case "week":
      conds.push(sql`${signals.createdAt} >= date_trunc('week', now())`);
      break;
  }
  // Legacy action-board param (competitor detail / saved views): "open" = todo|doing.
  if (f.actionStatus === "open") {
    conds.push(inArray(signals.actionStatus, ["todo", "doing"]));
  } else if ((ACTION_STATUSES as readonly string[]).includes(f.actionStatus ?? "")) {
    conds.push(eq(signals.actionStatus, f.actionStatus as (typeof ACTION_STATUSES)[number]));
  }
  if (f.unreadOnly) conds.push(eq(signals.isRead, false));
  // Search — insight OR competitor name. Escape LIKE metacharacters so a literal
  // % / _ in the query doesn't act as a wildcard (default ESCAPE '\').
  if (f.q) {
    const esc = f.q.replace(/[\\%_]/g, (ch) => `\\${ch}`);
    const like = `%${esc}%`;
    conds.push(sql`(${signals.insight} ILIKE ${like} OR ${competitors.name} ILIKE ${like})`);
  }
  return conds;
}

// Feed ordering. Unread signals form a hard top tier (isRead ASC = false first) so
// anything still needing attention outranks everything already seen. "recent" stays
// purely chronological — the escape hatch for "newest regardless", so read-state must
// not reorder it.
//
// The threat score (severity × overlap × relevance, override wins) ranks the UNREAD
// tier only. Once a signal has been seen its threat rank carries no new information,
// so the read tier reads as a chronological log: otherwise an old high-threat row that
// was already triaged pins the top of the archive forever and this morning's medium is
// buried under it, which reads as "nothing happened". Anything still needing work is
// held by actionStatus (the "actions" view), not by feed order.
function feedOrderBy(sort: "threat" | "recent") {
  if (sort === "recent") return [desc(signals.createdAt)];
  return [
    asc(signals.isRead),
    sql`(
      CASE WHEN ${signals.isRead} THEN 0 ELSE
        CASE COALESCE(${signals.severityOverride}, ${signals.severity})
          WHEN 'critical' THEN 1 WHEN 'high' THEN 0.75 WHEN 'medium' THEN 0.5 ELSE 0.25
        END
        * COALESCE(${competitors.overlapScore} / 100.0, 0.5)
        * COALESCE(${signals.relevanceScore}, 0.5)
      END
    ) DESC`,
    desc(signals.createdAt),
  ];
}

signalsRouter.get("/", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  // Pagination — offset/limit so the feed pages through the full set (the client's
  // "load more" appends pages). Limit clamped 1–200.
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 50), 1), 200);
  const offset = Math.max(Number(c.req.query("offset") ?? 0), 0);
  const f = parseFeedQuery(c);

  // Every feed filter (product/competitor/category/severity/quick-view/search) is
  // applied server-side now, so the LIMIT keeps the right window and the totals add up
  // at any scale. Hides "not useful" signals + soft-deleted competitors (feedConds).
  const conds = feedConds(orgId, f);

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
      // Full match count (window fn, evaluated before LIMIT) → the total for the
      // "X of Y" label and for knowing whether another page exists. Stripped per row.
      total: sql<number>`count(*) over()`,
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
    .orderBy(...feedOrderBy(f.sort))
    .limit(limit)
    .offset(offset);

  // total rides along on every row (window fn, pre-LIMIT). Strip it, then attach the
  // per-row threat score (same formula as the ordering) for the feed's discreet
  // indicator — read-state never touches this number, only the ordering tier.
  const total = rows.length ? Number(rows[0]!.total) : 0;
  const withThreat = rows.map(({ total: _total, ...r }) => ({
    ...r,
    threatScore: computeThreatScore({
      severity: r.severityOverride ?? r.severity,
      overlapScore: r.overlapScore,
      relevanceScore: r.relevanceScore,
    }),
  }));
  const nextOffset = offset + rows.length < total ? offset + limit : null;

  return c.json({ signals: withThreat, total, nextOffset });
});

// Feed facets — the tab counts + the distinct categories/competitors that populate the
// filter dropdowns. Product-scoped only (independent of the active view/severity/search
// filters), so switching a tab or filter never needs a recount. One cheap aggregate +
// two distinct scans; refetched on the same cadence as the list.
signalsRouter.get("/facets", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const productId = c.req.query("productId") || undefined;

  const base = [
    eq(signals.orgId, orgId),
    isNull(signals.hiddenForUserAt),
    isNull(competitors.deletedAt),
  ];
  if (productId) {
    base.push(sql`${signals.productIds} @> ${JSON.stringify([productId])}::jsonb`);
  }

  // Three reads over the same rows with the same filter — the counts, the distinct
  // categories, the distinct competitors. They were issued one after the other, so
  // the facets bar cost three sequential round-trips to say one thing. Nothing here
  // depends on anything else here.
  const [countRows, catRows, compRows] = await Promise.all([
    db
      .select({
        all: sql<number>`count(*)`,
        unread: sql<number>`count(*) filter (where ${signals.isRead} = false)`,
        alerts: sql<number>`count(*) filter (where ${signals.severity} in ('critical','high'))`,
        critical: sql<number>`count(*) filter (where ${signals.severity} = 'critical')`,
        week: sql<number>`count(*) filter (where ${signals.createdAt} >= date_trunc('week', now()))`,
        actions: sql<number>`count(*) filter (where ${signals.actionStatus} in ('todo','doing'))`,
      })
      .from(signals)
      .innerJoin(competitors, eq(competitors.id, signals.competitorId))
      .where(and(...base)),

    db
      .selectDistinct({ category: signals.category })
      .from(signals)
      .innerJoin(competitors, eq(competitors.id, signals.competitorId))
      .where(and(...base)),

    db
      .selectDistinct({ id: signals.competitorId, name: competitors.name })
      .from(signals)
      .innerJoin(competitors, eq(competitors.id, signals.competitorId))
      .where(and(...base))
      .orderBy(competitors.name),
  ]);
  const counts = countRows[0];

  return c.json({
    counts: {
      all: Number(counts?.all ?? 0),
      unread: Number(counts?.unread ?? 0),
      alerts: Number(counts?.alerts ?? 0),
      week: Number(counts?.week ?? 0),
      critical: Number(counts?.critical ?? 0),
      actions: Number(counts?.actions ?? 0),
    },
    categories: catRows.map((r) => r.category).sort(),
    competitors: compRows,
  });
});

// AI feed brief — a 2-3 sentence executive read of the org's last week of signals.
// In-memory cache (per org+product, 30 min TTL) bounds the model spend to ~2/hour/org
// regardless of how many page loads hit it; `?refresh=1` forces a fresh synthesis.
const briefCache = new Map<
  string,
  { brief: string | null; count: number; at: number }
>();
const BRIEF_TTL_MS = 30 * 60 * 1000;

signalsRouter.get("/brief", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const productId = c.req.query("productId") || undefined;
  const refresh = c.req.query("refresh") === "1";
  const cacheKey = `${orgId}:${productId ?? ""}`;

  if (!refresh) {
    const hit = briefCache.get(cacheKey);
    if (hit && Date.now() - hit.at < BRIEF_TTL_MS) {
      return c.json({ brief: hit.brief, count: hit.count });
    }
  }

  // Last week of signals for this scope — same base guards as the feed (not hidden,
  // competitor not soft-deleted), most recent first, capped.
  const conds = [
    eq(signals.orgId, orgId),
    isNull(signals.hiddenForUserAt),
    isNull(competitors.deletedAt),
    sql`${signals.createdAt} >= now() - interval '7 days'`,
  ];
  if (productId) {
    conds.push(sql`${signals.productIds} @> ${JSON.stringify([productId])}::jsonb`);
  }

  const rows = await db
    .select({
      severity: signals.severity,
      category: signals.category,
      insight: signals.insight,
      competitorName: competitors.name,
    })
    .from(signals)
    .innerJoin(competitors, eq(competitors.id, signals.competitorId))
    .where(and(...conds))
    .orderBy(desc(signals.createdAt))
    .limit(40);

  // Below a handful of signals the feed already reads at a glance — skip the spend.
  if (rows.length < 3) {
    briefCache.set(cacheKey, { brief: null, count: rows.length, at: Date.now() });
    return c.json({ brief: null, count: rows.length });
  }

  const lines = rows
    .map((r) => `- [${r.severity}] ${r.competitorName} (${r.category}): ${r.insight}`)
    .join("\n");
  const prompt = `You are a competitive-intelligence analyst briefing a busy founder who has a few minutes.
Below are the ${rows.length} most recent competitor signals from the past week (most recent first).
Write a 2-3 sentence executive brief: the through-line across these moves, who is most active, and the single thing that most deserves attention this week. Be specific and concrete (name competitors and categories). No preamble, no bullet points, no markdown, no headings. Write in English.

<signals>
${lines.slice(0, 6000)}
</signals>`;

  // withAiContext spans the call AND its log so the tokens/model complete()
  // marks reach the row (Bun drops the lazy child-frame enterWith).
  return withAiContext(async () => {
    try {
      const raw = await complete(AI_CONFIG.insights, { prompt, maxTokens: 240 });
      const brief = raw.trim() || null;
      await logApiAiRun("signals_brief", AI_CONFIG.insights.model, "success", { orgId });
      briefCache.set(cacheKey, { brief, count: rows.length, at: Date.now() });
      return c.json({ brief, count: rows.length });
    } catch {
      await logApiAiRun("signals_brief", AI_CONFIG.insights.model, "error", { orgId });
      return c.json({ brief: null, count: rows.length });
    }
  });
});

// Mark all read — full scope, server-side. Two paths on one endpoint:
//  • body.ids → set exactly those signals' read state (org-guarded). Used for the
//    toast Undo, so it reverts precisely the rows the bulk flip touched.
//  • no ids → mark EVERY unread signal matching the current feed filters (query string)
//    read, and return the flipped ids (capped) so the client can offer that Undo.
signalsRouter.post("/mark-all-read", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const body = (await c.req.json().catch(() => ({}))) as { ids?: unknown; read?: unknown };

  if (Array.isArray(body.ids)) {
    const ids = body.ids.filter((x): x is string => typeof x === "string").slice(0, 2000);
    if (!ids.length) return c.json({ ok: true, count: 0 });
    const read = body.read === undefined ? true : Boolean(body.read);
    const updated = await db
      .update(signals)
      .set({ isRead: read })
      .where(and(eq(signals.orgId, orgId), inArray(signals.id, ids)))
      .returning({ id: signals.id });
    return c.json({ ok: true, count: updated.length });
  }

  const f = parseFeedQuery(c);
  const conds = feedConds(orgId, f);
  // Subquery (needs the competitors join for the guards/search) → UPDATE by id IN (…).
  const matching = db
    .select({ id: signals.id })
    .from(signals)
    .innerJoin(competitors, eq(competitors.id, signals.competitorId))
    .where(and(...conds, eq(signals.isRead, false)));
  const updated = await db
    .update(signals)
    .set({ isRead: true })
    .where(inArray(signals.id, matching))
    .returning({ id: signals.id });
  const ids = updated.map((u) => u.id);
  return c.json({ ok: true, count: ids.length, ids: ids.length <= 2000 ? ids : undefined });
});

// CSV export — full scope, server-side, so the export reflects every matching signal,
// not just the loaded pages. Same filters + ordering as the list; capped at 10k rows.
signalsRouter.get("/export", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const f = parseFeedQuery(c);
  const conds = feedConds(orgId, f);

  const rows = await db
    .select({
      createdAt: signals.createdAt,
      severity: sql<string>`COALESCE(${signals.severityOverride}, ${signals.severity})`,
      category: signals.category,
      competitorName: competitors.name,
      insight: signals.insight,
      soWhat: signals.soWhat,
      recommendedAction: signals.recommendedAction,
      isRead: signals.isRead,
    })
    .from(signals)
    .innerJoin(competitors, eq(competitors.id, signals.competitorId))
    .where(and(...conds))
    .orderBy(...feedOrderBy(f.sort))
    .limit(10_000);

  const escape = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = [
    "Date",
    "Severity",
    "Category",
    "Competitor",
    "Insight",
    "So what",
    "Recommended action",
    "Read",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
        r.severity,
        r.category,
        r.competitorName,
        r.insight,
        r.soWhat ?? "",
        r.recommendedAction ?? "",
        r.isRead ? "yes" : "no",
      ]
        .map(escape)
        .join(","),
    );
  }
  const date = new Date().toISOString().slice(0, 10);
  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="outrival-signals-${date}.csv"`,
    },
  });
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
        // A snapshot's PNG is written once under a timestamped R2 key and never
        // rewritten, so re-opening a signal should never re-download it. Was
        // max-age=86400, which made the browser refetch a byte-identical image
        // a day later — on a slow first paint that is the cost paid twice.
        "Cache-Control": "private, max-age=31536000, immutable",
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

// Snooze a signal out of the feed until a future moment (or null to un-snooze). It
// reappears on the next poll once the time passes — no cron needed (the feed filters
// `snoozed_until <= now()`). Org-scoped like the other per-signal mutations.
signalsRouter.patch("/:id/snooze", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const id = c.req.param("id");

  const body = (await c.req.json().catch(() => ({}))) as { until?: unknown };
  let snoozedUntil: Date | null = null;
  if (body.until !== null && body.until !== undefined) {
    if (typeof body.until !== "string") return c.json({ error: "invalid_until" }, 400);
    const d = new Date(body.until);
    if (Number.isNaN(d.getTime()) || d.getTime() <= Date.now()) {
      return c.json({ error: "invalid_until" }, 400);
    }
    snoozedUntil = d;
  }

  const signal = await db.query.signals.findFirst({
    where: and(eq(signals.id, id), eq(signals.orgId, orgId)),
    columns: { id: true },
  });
  if (!signal) return c.json(notFound("signal"), 404);

  await db.update(signals).set({ snoozedUntil }).where(eq(signals.id, id));
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

  // The author's identity mark comes from the Better Auth row (the only place a
  // real photo exists — Google OAuth fills `image`; every other account has
  // none). Email rides along as the seed for the generated fallback avatar, so
  // a comment's mark matches the one in the topbar exactly. Left join: an app
  // user whose auth row is gone still renders, just without a photo.
  const rows = await db
    .select({
      id: signalComments.id,
      userId: signalComments.userId,
      authorName: signalComments.authorName,
      body: signalComments.body,
      parentId: signalComments.parentId,
      editedAt: signalComments.editedAt,
      createdAt: signalComments.createdAt,
      authorEmail: users.email,
      authorImage: authUser.image,
    })
    .from(signalComments)
    .leftJoin(users, eq(users.id, signalComments.userId))
    .leftJoin(authUser, eq(authUser.email, users.email))
    .where(eq(signalComments.signalId, id))
    .orderBy(signalComments.createdAt);

  return c.json({ comments: rows.map((r) => ({ ...r, mine: r.userId === user.id })) });
});

signalsRouter.post("/:id/comments", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const id = c.req.param("id");
  if (!(await ownsSignal(id, orgId))) return c.json(notFound("signal"), 404);

  const body = (await c.req.json().catch(() => ({}))) as {
    body?: unknown;
    parentId?: unknown;
  };
  const text = typeof body.body === "string" ? body.body.trim().slice(0, 2000) : "";
  if (!text) return c.json({ error: "body_required" }, 400);

  // Single-level threading: a reply must name a ROOT comment on THIS signal.
  // Replying to a reply is refused rather than silently flattened, so the depth
  // the client renders is the depth the data can hold.
  let parentId: string | null = null;
  if (typeof body.parentId === "string" && body.parentId) {
    const parent = await db.query.signalComments.findFirst({
      where: and(
        eq(signalComments.id, body.parentId),
        eq(signalComments.signalId, id),
        eq(signalComments.orgId, orgId),
      ),
      columns: { id: true, parentId: true },
    });
    if (!parent) return c.json({ error: "parent_not_found" }, 400);
    if (parent.parentId) return c.json({ error: "parent_is_reply" }, 400);
    parentId = parent.id;
  }

  const u = await db.query.users.findFirst({
    where: eq(users.id, user.id),
    columns: { name: true, email: true },
  });
  const authorName = u?.name ?? u?.email ?? "You";
  const me = u?.email
    ? await db.query.user.findFirst({
        where: eq(authUser.email, u.email),
        columns: { image: true },
      })
    : null;

  const [row] = await db
    .insert(signalComments)
    .values({ signalId: id, orgId, userId: user.id, authorName, body: text, parentId })
    .returning({
      id: signalComments.id,
      userId: signalComments.userId,
      authorName: signalComments.authorName,
      body: signalComments.body,
      parentId: signalComments.parentId,
      editedAt: signalComments.editedAt,
      createdAt: signalComments.createdAt,
    });

  void captureServerEvent(user.id, "signal_comment_posted", { signalId: id, orgId });

  return c.json(
    {
      comment: {
        ...row,
        mine: true,
        authorEmail: u?.email ?? null,
        authorImage: me?.image ?? null,
      },
    },
    201,
  );
});

// Edit one's own comment. `edited_at` is stamped so the thread never rewrites
// what someone read yesterday without saying so.
signalsRouter.patch("/:id/comments/:commentId", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const commentId = c.req.param("commentId");
  const body = (await c.req.json().catch(() => ({}))) as { body?: unknown };
  const text = typeof body.body === "string" ? body.body.trim().slice(0, 2000) : "";
  if (!text) return c.json({ error: "body_required" }, 400);

  const [row] = await db
    .update(signalComments)
    .set({ body: text, editedAt: new Date() })
    .where(
      and(
        eq(signalComments.id, commentId),
        eq(signalComments.orgId, orgId),
        eq(signalComments.userId, user.id),
      ),
    )
    .returning({
      id: signalComments.id,
      body: signalComments.body,
      editedAt: signalComments.editedAt,
    });

  if (!row) return c.json(notFound("comment"), 404);
  return c.json({ comment: row });
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
