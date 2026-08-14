import { logger } from "../lib/job-logger";
import { generateBattleCard } from "@outrival/queue";
import { and, eq, gte, isNull, max, ne, or, inArray, sql } from "drizzle-orm";
import {
  db,
  battleCards,
  competitors,
  organizations,
  products,
  signals,
} from "@outrival/db";
import { PLAN_LIMITS, type Plan } from "@outrival/shared";

/**
 * OUT-193 — self-updating battle cards.
 *
 * A card used to be written once and then frozen: the competitor kept shipping,
 * the card kept selling last month's competitor, and the only thing that moved it
 * was a user noticing the amber "Regenerate" and spending a daily card on it. This
 * pass closes that loop once a day: every card the competitor's feed has outdated
 * is rewritten on the new signals.
 *
 * The staleness rule is deliberately the SAME one the header shows
 * (GET /:id/battle-card/staleness), minus its two other triggers: a self-profile
 * edit and a "not useful" flag are the user's own actions, and the user is right
 * there — clicking Regenerate is one click. Only "the feed moved" is worth a
 * background AI spend.
 *
 * Cost is bounded three ways, because every refresh is a real AI generation plus a
 * headless-browser PDF render:
 *   - free orgs are skipped entirely (their whole quota is 1 card/day: refreshing
 *     one would spend the card the user wanted to write himself),
 *   - an org that has already generated a card today is skipped (they are using
 *     their quota; the cron does not compete for it),
 *   - and never more than MAX_PER_ORG cards per org per run.
 */

/** Ceiling per org per run, under the plan's own daily cap. A workspace tracking
 *  forty competitors must not turn one quiet night into forty generations. */
const MAX_PER_ORG = 3;

/** Start of the current UTC day — the window battleCardsPerDay is counted over
 *  (mirrors apps/api/src/lib/plan.ts, which owns the user-facing enforcement). */
function utcDayStart(now = new Date()): Date {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export async function runRefreshStaleBattleCards() {
  // Every org that opted in and is not on free. The toggle stays visible to free
  // orgs (Settings → General) so upgrading turns it on without a second decision.
  const orgs = await db
    .select({ id: organizations.id, plan: organizations.plan })
    .from(organizations)
    .where(
      and(
        eq(organizations.battleCardAutoRefresh, true),
        ne(organizations.plan, "free"),
      ),
    );

  if (orgs.length === 0) {
    logger.log("Completed refresh-stale-battle-cards", { orgs: 0, enqueued: 0 });
    return { orgs: 0, enqueued: 0 };
  }

  const orgIds = orgs.map((o) => o.id);

  // Cards worth considering: a live competitor (a deleted one still has its card
  // row until the cascade runs) and, when the card is product-scoped, a product the
  // org still ships. Regenerating a card for an archived SKU spends a generation on
  // a page nobody can open.
  const cards = await db
    .select({
      id: battleCards.id,
      orgId: battleCards.orgId,
      competitorId: battleCards.competitorId,
      productId: battleCards.productId,
      generatedAt: battleCards.generatedAt,
      basedOnCompetitorSignalAt: battleCards.basedOnCompetitorSignalAt,
    })
    .from(battleCards)
    .innerJoin(competitors, eq(competitors.id, battleCards.competitorId))
    .leftJoin(products, eq(products.id, battleCards.productId))
    .where(
      and(
        inArray(battleCards.orgId, orgIds),
        isNull(competitors.deletedAt),
        ne(competitors.type, "self"),
        or(isNull(battleCards.productId), ne(products.status, "archived")),
      ),
    );

  if (cards.length === 0) {
    logger.log("Completed refresh-stale-battle-cards", { orgs: orgs.length, enqueued: 0 });
    return { orgs: orgs.length, enqueued: 0 };
  }

  // Latest signal per competitor, under the same filter as the staleness route: a
  // low-severity or user-dismissed signal is noise, and letting noise age a card is
  // what made the amber "Regenerate" permanent on busy feeds (2026-07-10 audit).
  const lastSignals = await db
    .select({ competitorId: signals.competitorId, at: max(signals.createdAt) })
    .from(signals)
    .where(
      and(
        inArray(
          signals.competitorId,
          cards.map((c) => c.competitorId),
        ),
        ne(signals.severity, "low"),
        or(isNull(signals.actionStatus), ne(signals.actionStatus, "dismissed")),
      ),
    )
    .groupBy(signals.competitorId);

  const lastSignalAt = new Map(lastSignals.map((r) => [r.competitorId, r.at]));

  // Cards already generated today, per org — the same count the API enforces
  // battleCardsPerDay on, so the cron can never push an org past its own cap.
  const usedToday = await db
    .select({ orgId: battleCards.orgId, n: sql<number>`count(*)::int` })
    .from(battleCards)
    .where(
      and(
        inArray(battleCards.orgId, orgIds),
        gte(battleCards.generatedAt, utcDayStart()),
      ),
    )
    .groupBy(battleCards.orgId);

  const usedByOrg = new Map(usedToday.map((r) => [r.orgId, Number(r.n)]));

  const stale: Array<{
    orgId: string;
    competitorId: string;
    productId: string | null;
    signalAt: Date;
  }> = [];

  for (const card of cards) {
    const signalAt = lastSignalAt.get(card.competitorId);
    if (!signalAt) continue;
    // Fall back to generatedAt when the snapshot column is null (cards written
    // before patch-22). The staleness ROUTE treats null as "changed" so the header
    // nudges the user; doing that here would regenerate every legacy card at once
    // on the first run, which is a stampede, not a refresh.
    const basis = card.basedOnCompetitorSignalAt ?? card.generatedAt;
    if (signalAt <= basis) continue;
    stale.push({
      orgId: card.orgId,
      competitorId: card.competitorId,
      productId: card.productId,
      signalAt,
    });
  }

  const due: Array<{
    competitorId: string;
    orgId: string;
    productId?: string;
    notifyOnComplete: true;
    auto: true;
  }> = [];
  const skippedBusy: string[] = [];

  for (const org of orgs) {
    const used = usedByOrg.get(org.id) ?? 0;
    if (used > 0) {
      // The org is spending its own quota right now. Whatever the cron picks here,
      // it takes from the user — and the user is the one who knows which card he
      // needs today. Tomorrow's run catches these.
      skippedBusy.push(org.id);
      continue;
    }
    // `used` is 0 here by the guard above, so the org's whole daily cap is free —
    // the cron still clamps to it so a plan cheaper than MAX_PER_ORG can't be
    // overrun, and to MAX_PER_ORG so a rich plan can't turn one night into forty.
    const budget = Math.min(MAX_PER_ORG, PLAN_LIMITS[org.plan as Plan].battleCardsPerDay);
    if (budget <= 0) continue;

    // Most recently moved first: with a budget smaller than the backlog, the card
    // whose competitor shipped last night beats the one whose signal is a week old.
    const mine = stale
      .filter((s) => s.orgId === org.id)
      .sort((a, b) => b.signalAt.getTime() - a.signalAt.getTime())
      .slice(0, budget);

    for (const s of mine) {
      due.push({
        competitorId: s.competitorId,
        orgId: s.orgId,
        ...(s.productId ? { productId: s.productId } : {}),
        notifyOnComplete: true,
        auto: true,
      });
    }
  }

  if (due.length > 0) {
    await generateBattleCard.enqueueMany(due.map((data) => ({ data })));
  }

  logger.log("Completed refresh-stale-battle-cards", {
    orgs: orgs.length,
    cards: cards.length,
    stale: stale.length,
    skippedBusy: skippedBusy.length,
    enqueued: due.length,
  });

  return { orgs: orgs.length, stale: stale.length, enqueued: due.length };
}
