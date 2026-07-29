import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq, gt, isNull, ne, or, sql as dsql } from "drizzle-orm";
import { generateBattleCard } from "@outrival/queue";
import { battleCards, competitors, products, signals, selfProfileLastEditedAt } from "@outrival/db";
import { getBytesFromR2 } from "@outrival/shared";
import { db } from "../lib/db";
import { enqueueJob } from "../lib/queue";
import { analyticsQuery, sql } from "../lib/analytics-safe";
import { authMiddleware } from "../middleware/auth";
import { aiIntensiveRateLimit } from "../middleware/ai-intensive-rate-limit";
import { ensureUserOrg } from "../lib/org";
import { getOrgPlan, assertWithinLimit, tierLimitBody } from "../lib/plan";
import { competitorAnchorProduct } from "../lib/products";
import { captureServerEvent } from "../lib/posthog";

type Variables = { user: { id: string } };

export const battleCardsRouter = new Hono<{ Variables: Variables }>();

battleCardsRouter.use("*", authMiddleware);

const PatchSchema = z.object({
  content: z.object({
    their_strengths: z.array(z.string()).max(5),
    our_strengths: z.array(z.string()).max(5),
    their_weaknesses: z.array(z.string()).max(5),
    common_objections: z
      .array(z.object({ objection: z.string(), response: z.string() }))
      .max(5),
    when_we_win: z.array(z.string()).max(4),
    when_we_lose: z.array(z.string()).max(4),
  }),
});

async function assertOwnedCompetitor(competitorId: string, orgId: string) {
  return db.query.competitors.findFirst({
    where: and(
      eq(competitors.id, competitorId),
      eq(competitors.orgId, orgId),
      isNull(competitors.deletedAt),
    ),
  });
}

// patch-28 — the product (SKU) a battle-card request is scoped to: the given product
// (owned by the org), else the product this competitor is actually tracked for.
// Falling back to the org's PRIMARY here was wrong: in all-products scope the web
// sends no productId, so a competitor watched only for a secondary SKU got a card
// written from the primary product's positioning — comparing the wrong product.
// Null for a legacy org with no product row yet (cards then fall back to
// one-per-competitor). Returns the self-competitor anchor too, for staleness against
// the product's own profile.
async function resolveProduct(orgId: string, competitorId: string, given?: string) {
  if (given) {
    const p = await db.query.products.findFirst({
      where: and(eq(products.id, given), eq(products.orgId, orgId)),
      columns: { id: true, selfCompetitorId: true },
    });
    if (p) return p;
  }
  return (await competitorAnchorProduct(orgId, competitorId)) ?? undefined;
}

// The battle-card lookup for a (product, competitor) couple, falling back to
// one-per-competitor when the org has no product row (legacy / pre-migration).
function battleCardWhere(competitorId: string, productId: string | undefined) {
  return productId
    ? and(eq(battleCards.productId, productId), eq(battleCards.competitorId, competitorId))
    : eq(battleCards.competitorId, competitorId);
}

// patch-29 — org-wide battle card list, mounted at /api/battle-cards. Powers the
// dedicated /dashboard/battle-cards page and the "recent" section on the overview;
// the rail no longer links battle cards directly. Filtering by product/competitor
// is done client-side (the list per org is small).
export const battleCardsListRouter = new Hono<{ Variables: Variables }>();

battleCardsListRouter.use("*", authMiddleware);

battleCardsListRouter.get("/", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const rows = await db
    .select({
      id: battleCards.id,
      competitorId: battleCards.competitorId,
      competitorName: competitors.name,
      productId: battleCards.productId,
      productName: products.name,
      hasPdf: battleCards.pdfR2Key,
      generatedAt: battleCards.generatedAt,
      updatedAt: battleCards.updatedAt,
    })
    .from(battleCards)
    .innerJoin(competitors, eq(competitors.id, battleCards.competitorId))
    .leftJoin(products, eq(products.id, battleCards.productId))
    .where(and(eq(battleCards.orgId, orgId), isNull(competitors.deletedAt)))
    .orderBy(desc(battleCards.updatedAt));

  return c.json({
    battleCards: rows.map((r) => ({
      id: r.id,
      competitorId: r.competitorId,
      competitorName: r.competitorName,
      productId: r.productId,
      productName: r.productName,
      hasPdf: Boolean(r.hasPdf),
      generatedAt: r.generatedAt,
      updatedAt: r.updatedAt,
    })),
  });
});

battleCardsRouter.get("/:id/battle-card", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const competitor = await assertOwnedCompetitor(id, orgId);
  if (!competitor) return c.json({ error: "Not found" }, 404);

  const product = await resolveProduct(orgId, competitor.id, c.req.query("productId"));
  const card = await db.query.battleCards.findFirst({
    where: battleCardWhere(competitor.id, product?.id),
  });
  if (!card) return c.json({ error: "Not generated" }, 404);

  const evidence = await battleCardEvidence(competitor.id, card.id);
  return c.json({ battleCard: card, evidence });
});

// One short, human line per source saying WHAT we hold, not just that we hold it —
// "3 plans, $0 to $49" beats a green dot. Shown while a card is being written (so the
// wait reads as work on the user's own data) and in the empty state, where the same
// list is the argument for pressing Generate.
function money(value: number | null, currency: string | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  const symbol = currency === "USD" ? "$" : currency === "EUR" ? "€" : currency === "GBP" ? "£" : "";
  const n = Number.isInteger(value) ? String(value) : value.toFixed(2);
  return symbol ? `${symbol}${n}` : `${n}${currency ? ` ${currency}` : ""}`;
}

function pricingDetail(
  plans: number | null,
  min: number | null,
  max: number | null,
  currency: string | null,
): string | null {
  if (!plans) return null;
  const label = `${plans} plan${plans === 1 ? "" : "s"}`;
  const lo = money(min, currency);
  const hi = money(max, currency);
  if (!lo || !hi) return label;
  return lo === hi ? `${label}, ${lo}` : `${label}, ${lo} to ${hi}`;
}

// Phase 2B — provenance & freshness the UI shows above the card: the card-level
// confidence (from the systematic self-check persisted to ai_quality_checks) plus,
// per evidence source, whether it was captured, how fresh it is, and what it holds.
// All read-time, best-effort (a hiccup just yields nulls) — no migration, no stored
// duplication. `cardId` is optional: the empty state asks for the same readiness
// before any card exists, and a missing card simply has no confidence to report.
async function battleCardEvidence(competitorId: string, cardId?: string) {
  const [row] = await analyticsQuery<{
    pricing_at: string | null;
    reviews_at: string | null;
    tech_at: string | null;
    homepage_at: string | null;
    confidence: string | null;
    pricing_plans: number | null;
    pricing_min: number | null;
    pricing_max: number | null;
    pricing_currency: string | null;
    review_score: number | null;
    review_count: number | null;
    tech_count: number | null;
  }>(sql`
    WITH last_price AS (
      SELECT max(recorded_at) AS at FROM pricing_history WHERE competitor_id = ${competitorId}
    )
    SELECT
      (SELECT at AT TIME ZONE 'UTC' FROM last_price) AS pricing_at,
      (SELECT max(recorded_at) AT TIME ZONE 'UTC' FROM review_scores WHERE competitor_id = ${competitorId}) AS reviews_at,
      (SELECT max(last_detected_at) AT TIME ZONE 'UTC' FROM tech_stack_entries WHERE competitor_id = ${competitorId} AND is_active = true) AS tech_at,
      (SELECT max(s.scraped_at) AT TIME ZONE 'UTC' FROM snapshots s JOIN monitors m ON m.id = s.monitor_id WHERE m.competitor_id = ${competitorId} AND m.source_type = 'homepage') AS homepage_at,
      (SELECT confidence FROM ai_quality_checks WHERE target_type = 'battle_card' AND target_id = ${cardId ?? null} ORDER BY created_at DESC LIMIT 1) AS confidence,
      -- the latest capture only: rows land within seconds of each other, so an hour
      -- of slack keeps one scrape together without folding in the previous one.
      (SELECT count(DISTINCT plan_name)::int FROM pricing_history
         WHERE competitor_id = ${competitorId} AND recorded_at >= (SELECT at FROM last_price) - interval '1 hour') AS pricing_plans,
      (SELECT min(price) FROM pricing_history
         WHERE competitor_id = ${competitorId} AND recorded_at >= (SELECT at FROM last_price) - interval '1 hour') AS pricing_min,
      (SELECT max(price) FROM pricing_history
         WHERE competitor_id = ${competitorId} AND recorded_at >= (SELECT at FROM last_price) - interval '1 hour') AS pricing_max,
      (SELECT currency FROM pricing_history
         WHERE competitor_id = ${competitorId} AND recorded_at >= (SELECT at FROM last_price) - interval '1 hour' LIMIT 1) AS pricing_currency,
      (SELECT score FROM review_scores WHERE competitor_id = ${competitorId} ORDER BY recorded_at DESC LIMIT 1) AS review_score,
      (SELECT review_count FROM review_scores WHERE competitor_id = ${competitorId} ORDER BY recorded_at DESC LIMIT 1) AS review_count,
      (SELECT count(*)::int FROM tech_stack_entries WHERE competitor_id = ${competitorId} AND is_active = true) AS tech_count
  `);
  const conf = row?.confidence?.trim();
  const score = row?.review_score;
  const reviews = row?.review_count;
  const techCount = row?.tech_count ?? 0;
  return {
    confidence: conf === "low" || conf === "medium" || conf === "high" ? conf : null,
    sources: [
      {
        kind: "pricing",
        present: !!row?.pricing_at,
        lastVerifiedAt: row?.pricing_at ?? null,
        detail: pricingDetail(
          row?.pricing_plans ?? null,
          row?.pricing_min ?? null,
          row?.pricing_max ?? null,
          row?.pricing_currency ?? null,
        ),
      },
      {
        kind: "reviews",
        present: !!row?.reviews_at,
        lastVerifiedAt: row?.reviews_at ?? null,
        detail:
          score === null || score === undefined
            ? null
            : reviews
              ? `${score} from ${reviews} reviews`
              : `${score} average`,
      },
      {
        kind: "techStack",
        present: !!row?.tech_at,
        lastVerifiedAt: row?.tech_at ?? null,
        detail: techCount ? `${techCount} technolog${techCount === 1 ? "y" : "ies"}` : null,
      },
      {
        kind: "homepage",
        present: !!row?.homepage_at,
        lastVerifiedAt: row?.homepage_at ?? null,
        detail: null,
      },
    ],
  };
}

// The readiness list before a card exists — same shape as the one returned with a
// card, minus the confidence (there is nothing to score yet). The empty state uses it
// to say what the card will be written from, and the build view to show that evidence
// landing. Its own route because GET /battle-card 404s when no card is stored.
battleCardsRouter.get("/:id/battle-card/evidence", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const competitor = await assertOwnedCompetitor(id, orgId);
  if (!competitor) return c.json({ error: "Not found" }, 404);

  const product = await resolveProduct(orgId, c.req.query("productId"));
  const card = await db.query.battleCards.findFirst({
    where: battleCardWhere(competitor.id, product?.id),
    columns: { id: true },
  });

  return c.json({ evidence: await battleCardEvidence(competitor.id, card?.id) });
});

// Whether the battle card is worth regenerating (patch-22 intelligent rate limiting):
// stale when the user's self-profile changed, a new competitor signal landed since the
// card was generated, or the user flagged it "not useful" (patch-21). Drives the
// greyed-out "already up to date" vs amber "Regenerate" button; never blocking.
battleCardsRouter.get("/:id/battle-card/staleness", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const competitor = await assertOwnedCompetitor(id, orgId);
  if (!competitor) return c.json({ error: "Not found" }, 404);

  const product = await resolveProduct(orgId, competitor.id, c.req.query("productId"));
  const card = await db.query.battleCards.findFirst({
    where: battleCardWhere(competitor.id, product?.id),
  });
  if (!card) {
    return c.json({ staleness: "never_generated", needsRegeneration: true, since: null });
  }

  // The user's last edit comes from this product's self-competitor (patch-28) — the
  // same anchor the job snapshots basedOnUserUpdateAt from. Falls back to any self
  // for a legacy org with no product row.
  const self = product?.selfCompetitorId
    ? await db.query.competitors.findFirst({
        where: eq(competitors.id, product.selfCompetitorId),
      })
    : await db.query.competitors.findFirst({
        where: and(
          eq(competitors.orgId, orgId),
          eq(competitors.type, "self"),
          isNull(competitors.deletedAt),
        ),
        orderBy: (t, { asc }) => asc(t.createdAt),
      });
  const userLastChange = selfProfileLastEditedAt(self?.selfProfile) ?? self?.updatedAt ?? null;

  // Only signals worth regenerating for: with the raw "any newer signal" rule, a
  // noisy feed kept the amber "Regenerate" on permanently (2026-07-10 audit) and
  // nudged users to burn their daily card quota on noise. Low severity and
  // signals the user dismissed as noise don't age a card.
  const lastSignal = await db.query.signals.findFirst({
    where: and(
      eq(signals.competitorId, competitor.id),
      ne(signals.severity, "low"),
      or(isNull(signals.actionStatus), ne(signals.actionStatus, "dismissed")),
    ),
    orderBy: desc(signals.createdAt),
  });
  const competitorLastChange = lastSignal?.createdAt ?? null;

  const userChanged =
    !!userLastChange && (!card.basedOnUserUpdateAt || userLastChange > card.basedOnUserUpdateAt);
  const competitorChanged =
    !!competitorLastChange &&
    (!card.basedOnCompetitorSignalAt || competitorLastChange > card.basedOnCompetitorSignalAt);
  const flagged = !!card.flaggedForRegenerationAt;
  const needsRegeneration = userChanged || competitorChanged || flagged;

  // What actually moved since the card was written. "Regenerate" on its own asks the
  // user to spend a daily card on faith; naming the signals (and which categories they
  // landed in) lets them decide, and links them into the feed to check first. Same
  // filter as the staleness rule above, so the count can never contradict the verdict.
  const basis = card.basedOnCompetitorSignalAt ?? card.generatedAt;
  const sinceRows = await db
    .select({ category: signals.category, n: dsql<number>`count(*)::int` })
    .from(signals)
    .where(
      and(
        eq(signals.competitorId, competitor.id),
        gt(signals.createdAt, basis),
        ne(signals.severity, "low"),
        or(isNull(signals.actionStatus), ne(signals.actionStatus, "dismissed")),
      ),
    )
    .groupBy(signals.category);

  const byCategory = sinceRows
    .map((r) => ({ category: r.category, count: Number(r.n) }))
    .sort((a, b) => b.count - a.count);

  return c.json({
    staleness: needsRegeneration ? "outdated" : "fresh",
    needsRegeneration,
    lastGeneratedAt: card.generatedAt,
    reason: { userChanged, competitorChanged, flagged },
    since: {
      total: byCategory.reduce((sum, r) => sum + r.count, 0),
      byCategory,
    },
  });
});

battleCardsRouter.post("/:id/battle-card/generate", aiIntensiveRateLimit, async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  // Battle cards are open to every tier (decided 2026-06-04); the per-tier daily cap
  // is the cost guard, replacing the old pro+ feature gate.
  const plan = await getOrgPlan(orgId);
  const limit = await assertWithinLimit(orgId, "battleCardsPerDay", { plan });
  if (!limit.ok) return c.json(tierLimitBody(limit), 429);

  const competitor = await assertOwnedCompetitor(id, orgId);
  if (!competitor) return c.json({ error: "Not found" }, 404);

  const product = await resolveProduct(orgId, competitor.id, c.req.query("productId"));
  const jobId = await enqueueJob(generateBattleCard, {
    competitorId: competitor.id,
    orgId,
    productId: product?.id,
    // User-initiated → drop a durable "ready" notification in the bell when the job
    // lands, covering the case where they navigate away before it finishes.
    notifyOnComplete: true,
  });

  void captureServerEvent(user.id, "battle_card_generated", {
    competitorId: competitor.id,
    competitorName: competitor.name,
    productId: product?.id ?? null,
    orgId,
  });

  return c.json({ status: "generating", runId: jobId });
});

battleCardsRouter.patch("/:id/battle-card", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const competitor = await assertOwnedCompetitor(id, orgId);
  if (!competitor) return c.json({ error: "Not found" }, 404);

  const body = await c.req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);
  }

  const product = await resolveProduct(orgId, competitor.id, c.req.query("productId"));
  const existing = await db.query.battleCards.findFirst({
    where: battleCardWhere(competitor.id, product?.id),
  });
  if (!existing) return c.json({ error: "Not generated" }, 404);

  const [updated] = await db
    .update(battleCards)
    .set({ content: parsed.data.content, updatedAt: new Date() })
    .where(eq(battleCards.id, existing.id))
    .returning();

  return c.json({ battleCard: updated });
});

battleCardsRouter.get("/:id/battle-card/pdf", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const competitor = await assertOwnedCompetitor(id, orgId);
  if (!competitor) return c.json({ error: "Not found" }, 404);

  const product = await resolveProduct(orgId, competitor.id, c.req.query("productId"));
  const card = await db.query.battleCards.findFirst({
    where: battleCardWhere(competitor.id, product?.id),
  });
  if (!card?.pdfR2Key) return c.json({ error: "PDF not available" }, 404);

  const bytes = await getBytesFromR2(card.pdfR2Key);
  const filename = `battle-card-${competitor.name.replace(/[^\w-]+/g, "-").toLowerCase()}.pdf`;

  void captureServerEvent(user.id, "battle_card_pdf_downloaded", {
    competitorId: competitor.id,
    competitorName: competitor.name,
    productId: product?.id ?? null,
    orgId,
  });

  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, max-age=0",
    },
  });
});
