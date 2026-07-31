import { and, eq, gte, lte, sql as dsql } from "drizzle-orm";
import { changes, jobPostings, postingFacts } from "@outrival/db";
import {
  diffEntitlements,
  diffPriceTiers,
  type EntitlementRow,
  type TierBandRow,
} from "@outrival/shared";
import { db } from "./db";
import { analyticsQuery, sql } from "./analytics-safe";

/**
 * The facts a signal is ABOUT, fetched from the rows a sibling extractor wrote.
 *
 * A signal is born from a lexical diff of the page. The structured facts of the
 * same capture (which roles opened, which plan moved from what to what) are
 * written in PARALLEL by extract-jobs / extract-pricing, and the two paths never
 * met: a careers-page signal named five departments and not one role while
 * job_postings held every title, its location, its seniority and its apply URL.
 * This joins them back together at read time.
 *
 * WHY A TIME WINDOW AND NOT A change_id. Stamping the change on the extracted
 * rows is exact, and it was the plan. Two things ruled it out for now. The API
 * already answers this same class of question with a window join over
 * `recorded_at` (routes/activity.ts, the Activity timeline), so a second, private
 * mechanism would be one more thing to keep true. More decisively, a column can
 * only be filled going forward: every signal already in the feed would show
 * nothing until fresh scrapes landed, which is precisely the backlog the reader
 * is complaining about. A window works retroactively on all of them. Revisit if
 * the attribution below ever proves too loose.
 */

/** One role, as it reads on the board. */
export interface RoleFact {
  title: string;
  department: string | null;
  location: string | null;
  seniority: string | null;
  /** The apply link. Present on the structured ATS path, null on the LLM fallback. */
  url: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
}

/** One plan, and what it was at the previous capture. */
export interface PlanFact {
  planName: string;
  billingPeriod: string;
  currency: string | null;
  price: number | null;
  previousPrice: number | null;
  /** Dimensional pricing (Pricing Intelligence P1): what a usage/per-seat price
   * applies to, and the bundled units — so a rate move or a shrunk bundle shows
   * its exact before/after, not just the unchanged headline price. */
  unit: string | null;
  includedQuantity: number | null;
  previousIncludedQuantity: number | null;
  /** added when the plan is new to this capture, removed when it is gone. */
  state: "added" | "removed" | "changed" | "unchanged";
}

/** One packaging move of the capture (P2): the exact before/after of a feature
 * across the plan matrix, derived by the SAME shared differ that emits the
 * signal — the fact block can never disagree with the signal it explains. */
export interface EntitlementFact {
  featureLabel: string;
  state: "moved" | "limit_changed" | "added" | "removed";
  /** Exact human strings ("SSO — Enterprise" → "SSO — Pro";
   * "Starter — 5 seats" → "Starter — 3 seats"). */
  before: string | null;
  after: string | null;
}

/** One volume-ladder move of the capture (P3), derived by the SAME shared
 * differ that emits the signal. A boundary that slid is a price rise with no
 * price change, so the block has to print the bands or the reader sees a
 * pricing signal over numbers that all look identical. */
export interface TierFact {
  planName: string;
  state: "boundary_moved" | "rate_changed";
  /** Exact human strings ("Scale (request) — 0–10k @ $0.10"). */
  before: string | null;
  after: string | null;
}

/** One fact mined out of a job description, with the sentence it came from. */
export interface JobFact {
  /** 'tech' | 'product_hint' | 'team_size' | 'market' | 'language' */
  kind: string;
  value: string;
  /** Verbatim from the JD — substring-verified before it was ever stored. */
  evidenceSnippet: string;
  postingTitle: string;
  /** The posting, so the wording can be read in full. */
  postingUrl: string | null;
}

export type SignalFacts =
  | {
      kind: "hiring";
      opened: RoleFact[];
      closed: RoleFact[];
      /** Totals before the cap, so a truncated list can say what it is hiding. */
      openedTotal: number;
      closedTotal: number;
      /** Roles open right now, the denominator the opened count reads against. */
      openNow: number;
    }
  | {
      kind: "pricing";
      plans: PlanFact[];
      /** Free-trial facts as of this capture. null when never assessed. */
      trial: { hasTrial: boolean; days: number | null; requiresCard: boolean | null } | null;
      /** Packaging moves of this capture; [] when the matrix didn't change
       * (or was never captured). */
      entitlements: EntitlementFact[];
      /** Volume-ladder moves of this capture; [] when no ladder was captured
       * on either side, or it stood still. */
      tiers: TierFact[];
    }
  | {
      /** The JD-mined facts this signal published (Hiring Intelligence v2 P1). */
      kind: "job_facts";
      facts: JobFact[];
    }
  | null;

// A board can open fifty roles at once and a catalog can carry thirty plans. The
// point of the block is to name what moved, not to reproduce the page, so the
// lists are capped and the totals travel alongside.
const MAX_ROLES = 25;
const MAX_PLANS = 30;
const MAX_ENTITLEMENT_FACTS = 10;
const MAX_TIER_FACTS = 8;
// A single technology can be cited across a dozen postings; the block names the
// evidence, it does not reproduce the board.
const MAX_JOB_FACTS = 12;

// How long after a change its extraction may still land. The extractor is
// enqueued in the same scrape run, but it is the WORKER that stamps the row, and
// queue waits past an hour have been measured on prod. Six hours is far beyond
// the observed tail while staying well inside the daily-or-slower cadence of the
// sources this reads, and the next change on the same monitor closes the window
// early anyway.
const WINDOW_AHEAD_HOURS = 6;
// A small look-back: nothing should precede the change, but clock skew between
// the row that records the diff and the row that records the extraction is not
// worth losing a fact over.
const WINDOW_BEHIND_MINUTES = 5;

/**
 * The interval a change may claim extraction rows from.
 *
 * Bounded ahead by the NEXT change on the same monitor: a forced re-scan can put
 * two captures hours apart, and without that bound the earlier change would
 * happily claim the later capture's roles. With it, a row is attributed only when
 * no later change could own it.
 */
async function attributionWindow(
  monitorId: string,
  detectedAt: Date,
): Promise<{ lower: Date; upper: Date }> {
  const [next] = await db
    .select({ detectedAt: changes.detectedAt })
    .from(changes)
    .where(and(eq(changes.monitorId, monitorId), dsql`${changes.detectedAt} > ${detectedAt}`))
    .orderBy(changes.detectedAt)
    .limit(1);

  const ceiling = new Date(detectedAt.getTime() + WINDOW_AHEAD_HOURS * 3_600_000);
  const nextAt = next?.detectedAt ? new Date(next.detectedAt) : null;
  return {
    lower: new Date(detectedAt.getTime() - WINDOW_BEHIND_MINUTES * 60_000),
    upper: nextAt && nextAt < ceiling ? nextAt : ceiling,
  };
}

const toRole = (r: {
  title: string;
  department: string | null;
  location: string | null;
  seniority: string | null;
  url: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
}): RoleFact => r;

async function hiringFacts(
  competitorId: string,
  window: { lower: Date; upper: Date },
): Promise<SignalFacts> {
  const columns = {
    title: jobPostings.title,
    department: jobPostings.department,
    location: jobPostings.location,
    seniority: jobPostings.seniority,
    url: jobPostings.url,
    salaryMin: jobPostings.salaryMin,
    salaryMax: jobPostings.salaryMax,
    salaryCurrency: jobPostings.salaryCurrency,
  };

  const [opened, closed, [openNow]] = await Promise.all([
    db
      .select(columns)
      .from(jobPostings)
      .where(
        and(
          eq(jobPostings.competitorId, competitorId),
          gte(jobPostings.detectedAt, window.lower),
          lte(jobPostings.detectedAt, window.upper),
        ),
      )
      .orderBy(jobPostings.title)
      .limit(MAX_ROLES + 1),
    db
      .select(columns)
      .from(jobPostings)
      .where(
        and(
          eq(jobPostings.competitorId, competitorId),
          gte(jobPostings.closedAt, window.lower),
          lte(jobPostings.closedAt, window.upper),
        ),
      )
      .orderBy(jobPostings.title)
      .limit(MAX_ROLES + 1),
    db
      .select({ n: dsql<number>`count(*)::int` })
      .from(jobPostings)
      .where(and(eq(jobPostings.competitorId, competitorId), eq(jobPostings.isActive, true))),
  ]);

  if (opened.length === 0 && closed.length === 0) return null;
  return {
    kind: "hiring",
    opened: opened.slice(0, MAX_ROLES).map(toRole),
    closed: closed.slice(0, MAX_ROLES).map(toRole),
    openedTotal: opened.length,
    closedTotal: closed.length,
    openNow: openNow?.n ?? 0,
  };
}

/**
 * The facts a `job_facts` signal published, joined on the same read-time window
 * every other block here uses. `signalled_at` is stamped by the miner at the
 * instant it wrote the change, so the window that finds the change's siblings
 * finds exactly the facts it was about — including the older postings a
 * corroborated technology was cited in, which is the whole point of the block.
 */
async function jobFactsFacts(
  competitorId: string,
  window: { lower: Date; upper: Date },
): Promise<SignalFacts> {
  const rows = await db
    .select({
      kind: postingFacts.kind,
      value: postingFacts.value,
      evidenceSnippet: postingFacts.evidenceSnippet,
      postingTitle: jobPostings.title,
      postingUrl: jobPostings.url,
    })
    .from(postingFacts)
    .innerJoin(jobPostings, eq(jobPostings.id, postingFacts.postingId))
    .where(
      and(
        eq(postingFacts.competitorId, competitorId),
        gte(postingFacts.signalledAt, window.lower),
        lte(postingFacts.signalledAt, window.upper),
      ),
    )
    .orderBy(postingFacts.kind, jobPostings.title)
    .limit(MAX_JOB_FACTS);

  if (rows.length === 0) return null;
  return { kind: "job_facts", facts: rows };
}

interface PlanRow {
  side: "current" | "previous";
  planName: string;
  price: number | null;
  currency: string | null;
  billingPeriod: string;
  unit: string | null;
  includedQuantity: number | null;
  hasTrial: number | null;
  trialDays: number | null;
  trialRequiresCard: number | null;
}

const planKey = (p: { planName: string; billingPeriod: string }) =>
  `${p.planName} ${p.billingPeriod}`;

async function pricingFacts(
  competitorId: string,
  window: { lower: Date; upper: Date },
): Promise<SignalFacts> {
  // Both batches in one read: the latest inside the window, and the one strictly
  // before it whatever its age (the previous capture is the baseline even when it
  // predates the window).
  const rows = await analyticsQuery<PlanRow>(sql`
    WITH cur AS (
      SELECT max(recorded_at) AS ts FROM pricing_history
      WHERE competitor_id = ${competitorId} AND origin = 'live'
        AND recorded_at >= ${window.lower} AND recorded_at <= ${window.upper}
    ), prev AS (
      SELECT max(ph.recorded_at) AS ts FROM pricing_history ph, cur
      WHERE ph.competitor_id = ${competitorId} AND ph.origin = 'live'
        AND ph.recorded_at < cur.ts
    )
    SELECT 'current' AS side, ph.plan_name AS "planName", ph.price,
           ph.currency, ph.billing_period AS "billingPeriod",
           ph.unit, ph.included_quantity AS "includedQuantity",
           ph.has_trial AS "hasTrial", ph.trial_days AS "trialDays",
           ph.trial_requires_card AS "trialRequiresCard"
    FROM pricing_history ph, cur
    WHERE ph.competitor_id = ${competitorId} AND ph.recorded_at = cur.ts
    UNION ALL
    SELECT 'previous', ph.plan_name, ph.price, ph.currency, ph.billing_period,
           ph.unit, ph.included_quantity,
           ph.has_trial, ph.trial_days, ph.trial_requires_card
    FROM pricing_history ph, prev
    WHERE ph.competitor_id = ${competitorId} AND ph.recorded_at = prev.ts
  `);

  const current = rows.filter((r) => r.side === "current");
  if (current.length === 0) return null;
  const previous = rows.filter((r) => r.side === "previous");
  const prevByKey = new Map(previous.map((p) => [planKey(p), p]));
  const curKeys = new Set(current.map(planKey));

  // With no prior batch this is the first capture: every plan is simply present,
  // none of it is news. Claiming thirty plans were "added" would read as a launch.
  const isFirst = previous.length === 0;

  const plans: PlanFact[] = current.map((p) => {
    const before = prevByKey.get(planKey(p));
    // A plan "changed" when its price moved OR its bundled quantity did — a
    // shrunk bundle at a flat price (shrinkflation) must lead like a price cut.
    const quantityMoved =
      before != null &&
      before.includedQuantity !== null &&
      p.includedQuantity !== null &&
      before.includedQuantity !== p.includedQuantity;
    const state: PlanFact["state"] = isFirst
      ? "unchanged"
      : !before
        ? "added"
        : before.price !== p.price || quantityMoved
          ? "changed"
          : "unchanged";
    return {
      planName: p.planName,
      billingPeriod: p.billingPeriod,
      currency: p.currency,
      price: p.price,
      previousPrice: before?.price ?? null,
      unit: p.unit,
      includedQuantity: p.includedQuantity,
      previousIncludedQuantity: before?.includedQuantity ?? null,
      state,
    };
  });

  if (!isFirst) {
    for (const p of previous) {
      if (curKeys.has(planKey(p))) continue;
      plans.push({
        planName: p.planName,
        billingPeriod: p.billingPeriod,
        currency: p.currency,
        price: null,
        previousPrice: p.price,
        unit: p.unit,
        includedQuantity: null,
        previousIncludedQuantity: p.includedQuantity,
        state: "removed",
      });
    }
  }

  // What moved leads; the rest keeps the page's own order behind it.
  const rank: Record<PlanFact["state"], number> = {
    changed: 0,
    added: 1,
    removed: 2,
    unchanged: 3,
  };
  plans.sort((a, b) => rank[a.state] - rank[b.state]);

  // Trial facts are stamped page-level onto every row of the batch, so any row
  // carries them. null hasTrial means the capture predates the detection.
  const stamp = current[0]!;
  return {
    kind: "pricing",
    plans: plans.slice(0, MAX_PLANS),
    entitlements: await entitlementFacts(competitorId, window),
    tiers: await tierFacts(competitorId, window, stampCurrency(current)),
    trial:
      stamp.hasTrial === null
        ? null
        : {
            hasTrial: stamp.hasTrial === 1,
            days: stamp.trialDays,
            requiresCard: stamp.trialRequiresCard === null ? null : stamp.trialRequiresCard === 1,
          },
  };
}

/** The currency the bands are priced in — price_tiers stores the ladder,
 * pricing_history stores what it costs in, and the two are one capture. */
function stampCurrency(current: PlanRow[]): string | null {
  return current.find((p) => p.currency)?.currency ?? null;
}

interface TierBatchRow extends TierBandRow {
  side: "current" | "previous";
}

/**
 * The volume-ladder moves of the capture: the latest price_tiers batch inside
 * the window vs the one strictly before it, re-diffed at read time like the
 * entitlement block. A ladder captured on only one side stays silent — the
 * differ's own rule, so the block cannot claim a ladder appeared when it was
 * the extractor that finally read one.
 */
async function tierFacts(
  competitorId: string,
  window: { lower: Date; upper: Date },
  currency: string | null,
): Promise<TierFact[]> {
  const rows = await analyticsQuery<TierBatchRow>(sql`
    WITH cur AS (
      SELECT max(recorded_at) AS ts FROM price_tiers
      WHERE competitor_id = ${competitorId} AND origin = 'live'
        AND recorded_at >= ${window.lower} AND recorded_at <= ${window.upper}
    ), prev AS (
      SELECT max(pt.recorded_at) AS ts FROM price_tiers pt, cur
      WHERE pt.competitor_id = ${competitorId} AND pt.origin = 'live'
        AND pt.recorded_at < cur.ts
    )
    SELECT 'current' AS side, pt.plan_name, pt.unit, pt.from_qty, pt.to_qty,
           pt.unit_price, pt.flat_fee
    FROM price_tiers pt, cur
    WHERE pt.competitor_id = ${competitorId} AND pt.recorded_at = cur.ts
    UNION ALL
    SELECT 'previous', pt.plan_name, pt.unit, pt.from_qty, pt.to_qty,
           pt.unit_price, pt.flat_fee
    FROM price_tiers pt, prev
    WHERE pt.competitor_id = ${competitorId} AND pt.recorded_at = prev.ts
  `);

  const current = rows.filter((r) => r.side === "current");
  const previous = rows.filter((r) => r.side === "previous");
  if (current.length === 0 || previous.length === 0) return [];

  return diffPriceTiers(previous, current, { currency })
    .slice(0, MAX_TIER_FACTS)
    .map((c) => ({
      planName: c.planName ?? "",
      state: c.type === "tier_boundary_moved" ? ("boundary_moved" as const) : ("rate_changed" as const),
      before: c.humanBefore,
      after: c.humanAfter,
    }));
}

interface EntitlementBatchRow extends EntitlementRow {
  side: "current" | "previous";
}

/**
 * The packaging moves of the capture: the latest entitlement batch inside the
 * window vs the one strictly before it, re-diffed by the shared differ at read
 * time (retroactive, like every fact here — no change_id stamp to backfill).
 * Free-text label rewordings stay silent by the differ's own canonical-only
 * rule, so the block never claims a feature was "removed" over a copy edit.
 */
async function entitlementFacts(
  competitorId: string,
  window: { lower: Date; upper: Date },
): Promise<EntitlementFact[]> {
  const rows = await analyticsQuery<EntitlementBatchRow>(sql`
    WITH cur AS (
      SELECT max(recorded_at) AS ts FROM plan_entitlements
      WHERE competitor_id = ${competitorId}
        AND recorded_at >= ${window.lower} AND recorded_at <= ${window.upper}
    ), prev AS (
      SELECT max(pe.recorded_at) AS ts FROM plan_entitlements pe, cur
      WHERE pe.competitor_id = ${competitorId} AND pe.recorded_at < cur.ts
    )
    SELECT 'current' AS side, pe.plan_name, pe.feature_slug, pe.feature_label,
           pe.kind, pe.value_num, pe.value_text, pe.unit, pe.reset_period,
           pe.is_canonical
    FROM plan_entitlements pe, cur
    WHERE pe.competitor_id = ${competitorId} AND pe.recorded_at = cur.ts
    UNION ALL
    SELECT 'previous', pe.plan_name, pe.feature_slug, pe.feature_label,
           pe.kind, pe.value_num, pe.value_text, pe.unit, pe.reset_period,
           pe.is_canonical
    FROM plan_entitlements pe, prev
    WHERE pe.competitor_id = ${competitorId} AND pe.recorded_at = prev.ts
  `);

  const current = rows.filter((r) => r.side === "current");
  const previous = rows.filter((r) => r.side === "previous");
  if (current.length === 0 || previous.length === 0) return [];

  // moved/added/removed human strings lead with the feature ("SSO — Pro");
  // limit_changed leads with the PLAN ("Starter — 5 seats"), so its feature
  // label is recovered from the current batch row the change was derived from.
  const label = (c: {
    type: string;
    planName: string | null;
    currentValue: number | null;
    humanBefore: string | null;
    humanAfter: string | null;
  }): string => {
    if (c.type === "entitlement_limit_changed") {
      const hit = current.find(
        (r) => r.plan_name === c.planName && r.value_num === c.currentValue,
      );
      if (hit) return hit.feature_label;
    }
    return (c.humanAfter ?? c.humanBefore ?? "").split(" — ")[0] ?? "";
  };

  return diffEntitlements(previous, current)
    .slice(0, MAX_ENTITLEMENT_FACTS)
    .map((c) => ({
      featureLabel: label(c),
      state:
        c.type === "entitlement_moved"
          ? ("moved" as const)
          : c.type === "entitlement_limit_changed"
            ? ("limit_changed" as const)
            : c.type === "entitlement_added"
              ? ("added" as const)
              : ("removed" as const),
      before: c.humanBefore,
      after: c.humanAfter,
    }));
}

/**
 * The structured facts behind one signal, or null when its source has none.
 *
 * Best-effort by construction: a signal must still render if these reads fail,
 * so every caller treats null as "nothing to add" rather than an error. Only
 * jobs, pricing and the JD-mined job_facts anchor are wired up. Reviews and tech
 * stack already carry a
 * before/after pair from their deterministic detectors, so they are the smaller
 * gap; see docs/signal-evidence-audit.md wave 2.
 */
export async function buildSignalFacts(args: {
  monitorId: string | null;
  competitorId: string;
  sourceType: string | null;
  detectedAt: Date | string | null;
}): Promise<SignalFacts> {
  const { monitorId, competitorId, sourceType, detectedAt } = args;
  if (!monitorId || !detectedAt) return null;
  if (sourceType !== "jobs" && sourceType !== "pricing" && sourceType !== "job_facts") {
    return null;
  }

  try {
    const window = await attributionWindow(monitorId, new Date(detectedAt));
    if (sourceType === "jobs") return await hiringFacts(competitorId, window);
    if (sourceType === "job_facts") return await jobFactsFacts(competitorId, window);
    return await pricingFacts(competitorId, window);
  } catch {
    return null;
  }
}
