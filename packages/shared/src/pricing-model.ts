/**
 * Reading a captured pricing batch as a MODEL rather than a list of numbers
 * (Pricing Intelligence P3).
 *
 * Two questions the comparison layer has to answer about a competitor, both
 * pure and both derived from rows already stored:
 *
 *   - how does it charge? (the badge: flat, per seat, usage, hybrid, credits)
 *   - what does it cost to buy N of a meter from it?
 *
 * The second is what lets a usage-based competitor enter a price band at all.
 * It is computed ON READ, from the same `costAtVolume` that wrote the stored
 * price_points, so a workspace changing its reference volume gets a fresh answer
 * without a re-capture, and the on-read number can never disagree with the
 * stored one.
 */

import { costAtVolume, type CostTier, type RateStructure } from "./cost-model";
import { resolveMeterUnit } from "./unit-alias";
import { isComparablePricePeriod, monthlyEquivalent, normalizePlanKey } from "./pricing";
import type { PricingBatchRow } from "./pricing-diff";
import type { TierBandRow } from "./price-tier-diff";

/** The row shape both the worker's fresh batch and the API's stored batch
 * satisfy — pricing_history in snake_case. */
export type MeteredRow = Pick<PricingBatchRow, "plan_name" | "price" | "currency" | "billing_period"> &
  Partial<
    Pick<PricingBatchRow, "unit" | "included_quantity" | "rate_structure" | "minimum_amount" | "percentage_rate">
  >;

/**
 * The monthly subscription a metered plan sits on top of, when the batch holds
 * one under the same name — the hybrid shape the data model uses (base row +
 * usage row, one plan_name). Without it a hybrid competitor would enter the
 * comparison at its overage rate alone and read as cheaper than it bills.
 * Returns 0 when the plan has no base, so callers can always add it.
 */
export function monthlyBaseFee(planName: string, rows: readonly MeteredRow[]): number {
  const key = normalizePlanKey(planName);
  let best: number | null = null;
  for (const r of rows) {
    if (normalizePlanKey(r.plan_name) !== key) continue;
    if (!isComparablePricePeriod(r.billing_period)) continue;
    if (r.price == null || r.price <= 0) continue;
    const monthly = monthlyEquivalent({
      planName: r.plan_name,
      price: r.price,
      currency: r.currency ?? "USD",
      billingPeriod: r.billing_period,
    });
    if (monthly == null) continue;
    if (best === null || monthly < best) best = monthly;
  }
  return best ?? 0;
}

/** A row prices a meter when it is a usage rate on a unit we can normalise. */
function meterOf(row: MeteredRow): string | null {
  if (row.billing_period !== "usage") return null;
  const meter = resolveMeterUnit(row.unit);
  return meter?.canonical ? meter.unit : null;
}

/** The canonical meters this competitor publishes a rate for, deduped. */
export function meteredUnits(rows: readonly MeteredRow[]): string[] {
  const out = new Set<string>();
  for (const r of rows) {
    const meter = meterOf(r);
    if (meter) out.add(meter);
  }
  return [...out];
}

/**
 * Every meter this competitor can be compared on: the ones it publishes a rate
 * for, plus the ones we MEASURED on its calculator (P4).
 *
 * The union is the point. A calculator-priced page publishes no usage row at all
 * — that is why it needed measuring — so reading meters off the published rows
 * alone would collect the measurements and then never surface a single one.
 */
export function comparableMeters(
  rows: readonly MeteredRow[],
  measured: readonly MeasuredCost[] = [],
): string[] {
  const out = new Set<string>(meteredUnits(rows));
  for (const m of measured) out.add(m.meterUnit);
  return [...out];
}

/** How a cost at a volume was arrived at. Mirrors price_points.method. */
export type CostMethod = "computed_from_tiers" | "calculator_probe" | "published";

export interface MeterCost {
  cost: number;
  planName: string;
  currency: string | null;
  method: CostMethod;
  /** ISO timestamp of the capture a measured cost came from (null when computed
   * on read from the published ladder — that number has no moment of its own). */
  measuredAt?: string | null;
  /** True when the measured point carries a proof screenshot the UI can open. */
  hasEvidence?: boolean;
}

/**
 * A cost we MEASURED on the competitor's own calculator (P4), read back from
 * price_points. Shaped by the caller from the latest probe batch.
 */
export interface MeasuredCost {
  planName: string;
  meterUnit: string;
  referenceQty: number;
  effectiveMonthlyCost: number;
  currency: string | null;
  measuredAt: string | null;
  hasEvidence: boolean;
}

/**
 * The cheapest way to buy `qty` of `unit` from this competitor's published
 * plans, or null when none of them meters that unit in a way we can price.
 *
 * Cheapest, not first: a competitor with a pay-as-you-go rate AND a committed
 * plan is compared on the one a buyer at that volume would actually take.
 *
 * A MEASURED point at the same (unit, qty) WINS over the computed one, whatever
 * the amounts: the computed figure is our arithmetic over what the page printed,
 * the measured one is what the competitor's own calculator answered for that
 * volume — including the fees, floors and bundled allowances no published ladder
 * mentions. Cheapest-wins is how we choose among PUBLISHED plans; it is not a
 * tie-break between two kinds of evidence, so it is not applied across them.
 */
export function cheapestCostAtVolume(
  rows: readonly MeteredRow[],
  tiers: readonly TierBandRow[],
  unit: string,
  qty: number,
  measured: readonly MeasuredCost[] = [],
): MeterCost | null {
  const hit = measured.find((m) => m.meterUnit === unit && m.referenceQty === qty);
  if (hit) {
    return {
      cost: round2(hit.effectiveMonthlyCost),
      planName: hit.planName,
      currency: hit.currency,
      method: "calculator_probe",
      measuredAt: hit.measuredAt,
      hasEvidence: hit.hasEvidence,
    };
  }

  let best: MeterCost | null = null;

  for (const row of rows) {
    if (meterOf(row) !== unit) continue;

    const ladder = tiers.filter(
      (t) =>
        normalizePlanKey(t.plan_name) === normalizePlanKey(row.plan_name) &&
        (t.unit == null || resolveMeterUnit(t.unit)?.unit === unit),
    );

    const usage = costAtVolume(
      {
        rateStructure: (row.rate_structure ?? null) as RateStructure | null,
        tiers: ladder.length > 0 ? ladder.map(toCostTier) : null,
        minimumAmount: row.minimum_amount ?? null,
        unitPrice: row.price ?? null,
        packageSize: row.included_quantity ?? null,
      },
      qty,
    );
    if (usage == null) continue;

    const cost = round2(monthlyBaseFee(row.plan_name, rows) + usage);
    if (best === null || cost < best.cost) {
      best = {
        cost,
        planName: row.plan_name,
        currency: row.currency,
        method: "computed_from_tiers",
        measuredAt: null,
        hasEvidence: false,
      };
    }
  }

  return best;
}

function toCostTier(t: TierBandRow): CostTier {
  return {
    fromQty: t.from_qty,
    toQty: t.to_qty ?? null,
    unitPrice: t.unit_price ?? null,
    flatFee: t.flat_fee ?? null,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// ---------------------------------------------------------------------------
// The model badge
// ---------------------------------------------------------------------------

export const PRICING_MODELS = ["flat", "per_seat", "usage", "hybrid", "credits"] as const;
export type PricingModel = (typeof PRICING_MODELS)[number];

export const PRICING_MODEL_LABELS: Record<PricingModel, string> = {
  flat: "Flat",
  per_seat: "Per seat",
  usage: "Usage-based",
  hybrid: "Base + usage",
  credits: "Credits",
};

/**
 * How a competitor charges, read off its captured rows. Pure and order-defined
 * — a competitor is one thing on the badge, so the tests below are ranked
 * rather than combined:
 *
 *   credits   sells packs of a spendable unit; the meter is the pack
 *   hybrid    a subscription AND a meter — the shape that hides its real cost
 *   usage     a meter and nothing else
 *   per_seat  a subscription priced per person
 *   flat      a subscription priced per workspace
 *
 * null when nothing priced was captured: no badge is better than a wrong one.
 */
export function pricingModelOf(rows: readonly MeteredRow[]): PricingModel | null {
  let hasCredits = false;
  let hasUsage = false;
  let hasSeat = false;
  let hasSubscription = false;

  for (const r of rows) {
    const meter = resolveMeterUnit(r.unit);
    if (meter?.unit === "credit") hasCredits = true;
    if (r.billing_period === "usage") hasUsage = true;
    if (isComparablePricePeriod(r.billing_period) && r.price != null && r.price > 0) {
      hasSubscription = true;
      if (meter?.unit === "seat") hasSeat = true;
    }
  }

  if (hasCredits) return "credits";
  if (hasUsage && hasSubscription) return "hybrid";
  if (hasUsage) return "usage";
  if (hasSeat) return "per_seat";
  if (hasSubscription) return "flat";
  return null;
}
