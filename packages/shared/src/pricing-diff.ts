// Pricing Intelligence v2 — Phase 1: the batch→batch plan diff, promoted from a
// display-only read (apps/api signal-facts) to a DETERMINISTIC generator of typed
// pricing changes. Pure and side-effect free: two pricing_history batches in,
// a ranked list of typed changes out, each carrying its severity from the locked
// table (roadmap card "Pricing — Intelligence v2"). The AI never decides WHAT
// moved or HOW MUCH it matters — it only narrates a fact established here
// (classify-structured pattern). Emission guards (never on backfill, never on a
// coverage-regression-guarded batch, never on a first scrape) live with the
// caller (apps/workers extract-pricing), not here.

import { normalizePlanKey } from "./pricing";

export type PricingChangeType =
  | "price_changed"
  | "plan_added"
  | "plan_removed"
  | "period_added"
  | "rate_changed"
  | "included_quantity_changed"
  | "trial_changed"
  | "free_plan_changed"
  // Phase 2 — the features × plans matrix (see entitlement-diff.ts). Entitlement
  // changes cap at HIGH by design: repackaging never bypasses moderation.
  | "entitlement_moved"
  | "entitlement_limit_changed"
  | "entitlement_added"
  | "entitlement_removed";

export type PricingChangeSeverity = "low" | "medium" | "high" | "critical";

/**
 * One batch row, in the exact snake_case shape of pricing_history (the shape
 * extract-pricing inserts and getPreviousPricing reads back), so the worker can
 * feed both sides without mapping. Trial / free-plan facts are page-level stamps
 * repeated on every row of a batch; the differ reads the first non-null stamp.
 */
export interface PricingBatchRow {
  plan_name: string;
  price: number | null;
  currency: string | null;
  billing_period: string;
  unit?: string | null;
  included_quantity?: number | null;
  /** 1/true = struck-through promo price (Black Friday). Excluded from price and
   * rate comparisons on EITHER side: a promo row is not a list price, and using
   * one as the baseline would read the post-promo return to normal as a hike. */
  promotional?: number | boolean | null;
  has_trial?: number | null;
  trial_days?: number | null;
  trial_requires_card?: number | null;
  has_free_plan?: number | null;
}

export interface PricingChange {
  type: PricingChangeType;
  severity: PricingChangeSeverity;
  /** null on page-level facts (trial_changed, free_plan_changed). */
  planName: string | null;
  billingPeriod: string | null;
  unit: string | null;
  currency: string | null;
  /** Numeric sides where the change is numeric (price, rate, quantity, days). */
  previousValue: number | null;
  currentValue: number | null;
  /** Signed percentage, 1-decimal, for price/rate/quantity moves. */
  pctChange: number | null;
  direction: "up" | "down" | null;
  /** Exact, row-derived strings for signals.human_change_before/_after
   * ("Pro — $79/mo" → "Pro — $59/mo"). */
  humanBefore: string | null;
  humanAfter: string | null;
  /** One self-contained fact line ("Pro: $79/mo → $59/mo (−25.3%)") — what the
   * synthetic change's diffText is rendered from. */
  summary: string;
}

// Severity table — locked in the roadmap card. Exported so the eval/test layer
// pins the exact boundaries instead of re-deriving them.
export const PRICE_CHANGE_LOW_PCT = 3; // |Δ| below → low
export const PRICE_UNDERCUT_CRITICAL_PCT = 15; // a DROP beyond → critical (undercut)

const SEVERITY_RANK: Record<PricingChangeSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/** Order a merged change list most-severe-first — the order diffPricingBatches
 * returns, needed again when a caller concatenates the batch diff with the
 * entitlement diff before planning one signal. Stable within a band. */
export function sortPricingChanges(changes: PricingChange[]): PricingChange[] {
  return [...changes].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

export function maxPricingChangeSeverity(
  changes: PricingChange[],
): PricingChangeSeverity | null {
  let max: PricingChangeSeverity | null = null;
  for (const c of changes) {
    if (max === null || SEVERITY_RANK[c.severity] < SEVERITY_RANK[max]) max = c.severity;
  }
  return max;
}

// ---------------------------------------------------------------------------
// Formatting — exact, English, price-token-bearing (the severity guard demotes a
// pricing critical whose diff carries no price token, so the rendered lines must
// keep the "$79/mo" shape).
// ---------------------------------------------------------------------------

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  $: "$",
  "€": "€",
  "£": "£",
  "¥": "¥",
};

function formatAmount(value: number): string {
  // Rates keep their sub-cent precision ($0.008/call); subscriptions read whole.
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded)
    ? rounded.toLocaleString("en-US")
    : String(rounded);
}

export function formatPrice(price: number, currency: string | null): string {
  const symbol = currency ? CURRENCY_SYMBOLS[currency.toUpperCase()] : undefined;
  if (symbol) return `${symbol}${formatAmount(price)}`;
  return currency ? `${formatAmount(price)} ${currency}` : `$${formatAmount(price)}`;
}

function periodSuffix(period: string, unit: string | null | undefined): string {
  if (period === "monthly") return "/mo";
  if (period === "yearly") return "/yr";
  if (period === "one_time") return " one-time";
  if (period === "usage") return `/${unit ?? "unit"}`;
  return "";
}

function pricePhrase(row: PricingBatchRow): string | null {
  if (row.price == null) return null;
  return `${formatPrice(row.price, row.currency)}${periodSuffix(row.billing_period, row.unit)}`;
}

function planPhrase(row: PricingBatchRow): string {
  const price = pricePhrase(row);
  return price ? `${row.plan_name} — ${price}` : row.plan_name;
}

function pct(prev: number, next: number): number {
  return Math.round(((next - prev) / prev) * 1000) / 10;
}

function signedPct(value: number): string {
  return `${value > 0 ? "+" : "−"}${Math.abs(value)}%`;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

const rowKey = (r: PricingBatchRow): string =>
  `${normalizePlanKey(r.plan_name)}|${r.billing_period}`;

const isPromo = (r: PricingBatchRow): boolean =>
  r.promotional === 1 || r.promotional === true;

// Relative tolerance: absorbs float representation jitter without eating a real
// sub-cent rate move ($0.100 → $0.101 must register on a usage rate).
const approxEqual = (a: number, b: number): boolean =>
  Math.abs(a - b) <= Math.max(Math.abs(a), Math.abs(b)) * 1e-6;

const sameCurrency = (a: PricingBatchRow, b: PricingBatchRow): boolean =>
  (a.currency ?? "").toUpperCase() === (b.currency ?? "").toUpperCase();

function byKey(rows: PricingBatchRow[]): Map<string, PricingBatchRow> {
  const map = new Map<string, PricingBatchRow>();
  // First row wins on a duplicate key — batches are deduped upstream
  // (extract-pricing dedupePlans), so a dup here is theoretical.
  for (const r of rows) if (!map.has(rowKey(r))) map.set(rowKey(r), r);
  return map;
}

interface PlanGroup {
  name: string;
  periods: Set<string>;
  rows: PricingBatchRow[];
}

function byPlan(rows: PricingBatchRow[]): Map<string, PlanGroup> {
  const map = new Map<string, PlanGroup>();
  for (const r of rows) {
    const key = normalizePlanKey(r.plan_name);
    const group = map.get(key) ?? { name: r.plan_name, periods: new Set(), rows: [] };
    group.periods.add(r.billing_period);
    group.rows.push(r);
    map.set(key, group);
  }
  return map;
}

/** The row that best names a plan to a human: a priced monthly first, then any
 * priced row, then whatever is left (a quote-based "Contact sales" tier). */
function representativeRow(group: PlanGroup): PricingBatchRow {
  const priced = group.rows.filter((r) => r.price != null && r.price > 0);
  const monthly = priced.find((r) => r.billing_period === "monthly");
  return monthly ?? priced[0] ?? group.rows[0]!;
}

function priceChangeSeverity(pctChange: number): PricingChangeSeverity {
  if (pctChange < -PRICE_UNDERCUT_CRITICAL_PCT) return "critical";
  if (Math.abs(pctChange) < PRICE_CHANGE_LOW_PCT) return "low";
  return "medium";
}

function rateChangeSeverity(pctChange: number): PricingChangeSeverity {
  // The card's table gives rates no low band: a rate is multiplied by volume, so
  // even a small move is worth a digest line. A >15% drop is an undercut.
  return pctChange < -PRICE_UNDERCUT_CRITICAL_PCT ? "critical" : "medium";
}

interface TrialStamp {
  hasTrial: boolean;
  days: number | null;
  requiresCard: boolean | null;
}

/** Page-level trial facts of a batch, from the first row that carries the stamp.
 * null = the batch predates trial detection → no comparison possible. */
function trialStamp(rows: PricingBatchRow[]): TrialStamp | null {
  const stamped = rows.find((r) => r.has_trial != null);
  if (!stamped) return null;
  return {
    hasTrial: stamped.has_trial === 1,
    days: stamped.trial_days ?? null,
    requiresCard:
      stamped.trial_requires_card == null ? null : stamped.trial_requires_card === 1,
  };
}

function trialPhrase(t: TrialStamp): string {
  if (!t.hasTrial) return "No free trial";
  const base = t.days != null ? `${t.days}-day free trial` : "Free trial";
  if (t.requiresCard === false) return `${base}, no credit card required`;
  if (t.requiresCard === true) return `${base}, credit card required`;
  return base;
}

/** null = the batch predates free-plan detection. */
function freePlanStamp(rows: PricingBatchRow[]): boolean | null {
  const stamped = rows.find((r) => r.has_free_plan != null);
  return stamped ? stamped.has_free_plan === 1 : null;
}

// ---------------------------------------------------------------------------
// The diff
// ---------------------------------------------------------------------------

/**
 * Diff two consecutive pricing_history batches into typed, severity-carrying
 * changes, most severe first. Returns [] when either side is empty — a first
 * scrape or a failed capture is not a pricing move.
 */
export function diffPricingBatches(
  prev: PricingBatchRow[],
  next: PricingBatchRow[],
): PricingChange[] {
  if (prev.length === 0 || next.length === 0) return [];

  const changes: PricingChange[] = [];
  const prevRows = byKey(prev);
  const nextRows = byKey(next);
  const prevPlans = byPlan(prev);
  const nextPlans = byPlan(next);

  // Plans appearing / disappearing (name-level, whatever the periods).
  for (const [planKey, group] of nextPlans) {
    if (prevPlans.has(planKey)) continue;
    const row = representativeRow(group);
    changes.push({
      type: "plan_added",
      severity: "high",
      planName: row.plan_name,
      billingPeriod: row.billing_period,
      unit: row.unit ?? null,
      currency: row.currency,
      previousValue: null,
      currentValue: row.price,
      pctChange: null,
      direction: null,
      humanBefore: null,
      humanAfter: planPhrase(row),
      summary: `New plan: ${planPhrase(row)}`,
    });
  }
  for (const [planKey, group] of prevPlans) {
    if (nextPlans.has(planKey)) continue;
    const row = representativeRow(group);
    changes.push({
      type: "plan_removed",
      severity: "high",
      planName: row.plan_name,
      billingPeriod: row.billing_period,
      unit: row.unit ?? null,
      currency: row.currency,
      previousValue: row.price,
      currentValue: null,
      pctChange: null,
      direction: null,
      humanBefore: planPhrase(row),
      humanAfter: null,
      summary: `Plan removed: ${planPhrase(row)}`,
    });
  }

  // A new billing period on a plan present on both sides (yearly appearing, a
  // usage overage introduced on a subscription plan…).
  for (const [planKey, group] of nextPlans) {
    const before = prevPlans.get(planKey);
    if (!before) continue;
    for (const period of group.periods) {
      if (before.periods.has(period)) continue;
      const row = group.rows.find((r) => r.billing_period === period)!;
      changes.push({
        type: "period_added",
        severity: "medium",
        planName: row.plan_name,
        billingPeriod: period,
        unit: row.unit ?? null,
        currency: row.currency,
        previousValue: null,
        currentValue: row.price,
        pctChange: null,
        direction: null,
        humanBefore: null,
        humanAfter: planPhrase(row),
        summary: `${row.plan_name}: ${period === "usage" ? "usage-based" : period} billing added${
          pricePhrase(row) ? ` (${pricePhrase(row)})` : ""
        }`,
      });
    }
  }

  // Row-level comparisons on shared (plan, period) keys.
  for (const [key, nextRow] of nextRows) {
    const prevRow = prevRows.get(key);
    if (!prevRow) continue;

    // Price / rate move. Promo rows are no baseline and no news (see
    // PricingBatchRow.promotional); a currency swap is not a comparable move.
    const comparable =
      !isPromo(prevRow) &&
      !isPromo(nextRow) &&
      prevRow.price != null &&
      nextRow.price != null &&
      prevRow.price > 0 &&
      sameCurrency(prevRow, nextRow);
    if (comparable && !approxEqual(prevRow.price!, nextRow.price!)) {
      const isRate = nextRow.billing_period === "usage";
      const sameUnit =
        (prevRow.unit ?? null) === (nextRow.unit ?? null) || !isRate;
      if (sameUnit) {
        const pctChange = pct(prevRow.price!, nextRow.price!);
        changes.push({
          type: isRate ? "rate_changed" : "price_changed",
          severity: isRate ? rateChangeSeverity(pctChange) : priceChangeSeverity(pctChange),
          planName: nextRow.plan_name,
          billingPeriod: nextRow.billing_period,
          unit: nextRow.unit ?? null,
          currency: nextRow.currency,
          previousValue: prevRow.price!,
          currentValue: nextRow.price!,
          pctChange,
          direction: pctChange > 0 ? "up" : "down",
          humanBefore: planPhrase(prevRow),
          humanAfter: planPhrase(nextRow),
          summary: `${nextRow.plan_name}: ${pricePhrase(prevRow)} → ${pricePhrase(nextRow)} (${signedPct(pctChange)})`,
        });
      }
    }

    // Included quantity (the SaaS shrinkflation axis): same plan and period, the
    // bundled units moved. High only when the price stood still and the bundle
    // shrank — a smaller bundle at the same price IS a hidden price increase.
    if (
      prevRow.included_quantity != null &&
      nextRow.included_quantity != null &&
      prevRow.included_quantity > 0 &&
      prevRow.included_quantity !== nextRow.included_quantity
    ) {
      const priceUnchanged =
        (prevRow.price == null && nextRow.price == null) ||
        (prevRow.price != null &&
          nextRow.price != null &&
          approxEqual(prevRow.price, nextRow.price));
      const shrank = nextRow.included_quantity < prevRow.included_quantity;
      const qtyPct = pct(prevRow.included_quantity, nextRow.included_quantity);
      const unitLabel = nextRow.unit ?? prevRow.unit ?? "units";
      const fmt = (n: number) => n.toLocaleString("en-US");
      changes.push({
        type: "included_quantity_changed",
        severity: priceUnchanged && shrank ? "high" : "medium",
        planName: nextRow.plan_name,
        billingPeriod: nextRow.billing_period,
        unit: unitLabel,
        currency: nextRow.currency,
        previousValue: prevRow.included_quantity,
        currentValue: nextRow.included_quantity,
        pctChange: qtyPct,
        direction: shrank ? "down" : "up",
        humanBefore: `${nextRow.plan_name} — ${fmt(prevRow.included_quantity)} ${unitLabel} included`,
        humanAfter: `${nextRow.plan_name} — ${fmt(nextRow.included_quantity)} ${unitLabel} included${
          priceUnchanged ? ", price unchanged" : ""
        }`,
        summary: `${nextRow.plan_name}: ${fmt(prevRow.included_quantity)} → ${fmt(nextRow.included_quantity)} ${unitLabel} included (${signedPct(qtyPct)}${priceUnchanged ? ", price unchanged" : ""})`,
      });
    }
  }

  // Page-level facts. Only comparable when BOTH batches carry the stamp — a
  // batch predating the detectors must not read as "trial removed".
  const prevTrial = trialStamp(prev);
  const nextTrial = trialStamp(next);
  if (prevTrial && nextTrial) {
    const flipped = prevTrial.hasTrial !== nextTrial.hasTrial;
    const daysMoved =
      prevTrial.hasTrial &&
      nextTrial.hasTrial &&
      prevTrial.days != null &&
      nextTrial.days != null &&
      prevTrial.days !== nextTrial.days;
    const cardMoved =
      prevTrial.hasTrial &&
      nextTrial.hasTrial &&
      prevTrial.requiresCard != null &&
      nextTrial.requiresCard != null &&
      prevTrial.requiresCard !== nextTrial.requiresCard;
    if (flipped || daysMoved || cardMoved) {
      changes.push({
        type: "trial_changed",
        severity: "medium",
        planName: null,
        billingPeriod: null,
        unit: null,
        currency: null,
        previousValue: prevTrial.days,
        currentValue: nextTrial.days,
        pctChange: null,
        direction: null,
        humanBefore: trialPhrase(prevTrial),
        humanAfter: trialPhrase(nextTrial),
        summary: `Free trial: ${trialPhrase(prevTrial)} → ${trialPhrase(nextTrial)}`,
      });
    }
  }

  const prevFree = freePlanStamp(prev);
  const nextFree = freePlanStamp(next);
  if (prevFree != null && nextFree != null && prevFree !== nextFree) {
    changes.push({
      type: "free_plan_changed",
      severity: "high",
      planName: null,
      billingPeriod: null,
      unit: null,
      currency: null,
      previousValue: null,
      currentValue: null,
      pctChange: null,
      direction: nextFree ? "up" : "down",
      humanBefore: prevFree ? "Free plan available" : "No free plan",
      humanAfter: nextFree ? "Free plan available" : "No free plan",
      summary: nextFree ? "A permanent free plan appeared" : "The permanent free plan disappeared",
    });
  }

  changes.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  return changes;
}
