// Pricing Intelligence P3 — the rate-structure stage of extract-pricing.
//
// Turns the ladder a pricing page publishes into two stored facts: the bands
// themselves (price_tiers, the evidence) and what they COST at reference
// volumes (price_points, the number a comparison can stand on). Pure and
// AI-free — the model only reads the page, every judgement below is code.
//
// Three refusals, all deliberate:
//   - an invalid ladder is dropped WHOLE (validateTierSet), never trimmed to
//     its valid prefix: a half-read ladder computes a confidently wrong cost
//   - no cost point on a meter that does not normalise: an unknown unit
//     compared against a known one is arithmetic on two different things
//   - a worked example the page does not actually print is dropped: a
//     published figure is a claim about the competitor, so it is grounded in
//     code, exactly like an entitlement label

import {
  costAtVolume,
  validateTierSet,
  resolveMeterUnit,
  monthlyEquivalent,
  isComparablePricePeriod,
  REFERENCE_VOLUME_PRESETS,
  normalizePlanKey,
  type CostTier,
  type RateStructure,
} from "@outrival/shared";
import type { PricingPlan } from "@outrival/ai";
import { logger } from "./job-logger";
import type { PriceTierRow, PricePointRow } from "./analytics";

/** Worked examples we will believe from one plan. A page prints one or two. */
const MAX_PUBLISHED_EXAMPLES = 4;

export interface PreparedRateStructures {
  tierRows: PriceTierRow[];
  pointRows: PricePointRow[];
  dropped: { invalidLadders: number; unknownUnits: number; ungroundedExamples: number };
}

/** A plan whose price is a rate on a meter, rather than a subscription. */
function isMeteredPlan(p: PricingPlan): boolean {
  return p.billing_period === "usage" || (p.tiers?.length ?? 0) > 0;
}

function toCostTiers(raw: NonNullable<PricingPlan["tiers"]>): CostTier[] {
  return raw.map((t) => ({
    fromQty: t.from_qty,
    toQty: t.to_qty ?? null,
    unitPrice: t.unit_price ?? null,
    flatFee: t.flat_fee ?? null,
  }));
}

/**
 * The monthly subscription a metered plan sits on top of, when the batch holds
 * one under the same name — the hybrid shape the data model already uses (base
 * row + usage row, one plan_name). Without it a hybrid competitor would enter
 * the comparison at its overage rate alone and read as cheaper than it bills.
 */
function baseFeeFor(planName: string, plans: PricingPlan[]): number {
  const key = normalizePlanKey(planName);
  let best: number | null = null;
  for (const p of plans) {
    if (normalizePlanKey(p.plan_name) !== key) continue;
    if (!isComparablePricePeriod(p.billing_period)) continue;
    if (p.price == null || p.price <= 0) continue;
    const monthly = monthlyEquivalent({
      planName: p.plan_name,
      price: p.price,
      currency: p.currency,
      billingPeriod: p.billing_period,
    });
    if (monthly == null) continue;
    if (best === null || monthly < best) best = monthly;
  }
  return best ?? 0;
}

/**
 * Digits of a page, with thousands separators removed, so "$1,000" and "1000"
 * are one string to search. Deliberately loose: this is an anti-hallucination
 * floor (the figure must exist on the page at all), not a proof of meaning.
 */
function digitsOf(text: string): string {
  return text.replace(/(\d)[\s,'  ](?=\d{3}\b)/g, "$1");
}

function pageStates(haystack: string, value: number): boolean {
  const plain = String(value);
  if (haystack.includes(plain)) return true;
  // A page writing 25.00 or 25,00 for a value we read as 25.
  if (Number.isInteger(value)) {
    return haystack.includes(`${value}.00`) || haystack.includes(`${value},00`);
  }
  return haystack.includes(plain.replace(".", ","));
}

/**
 * Pure: the extracted plans of one live capture → the tier and cost-point rows
 * to store. Both carry the batch timestamp of the pricing_history rows of the
 * same run, so the three tables describe one capture.
 */
export function prepareRateStructures(args: {
  competitorId: string;
  plans: PricingPlan[];
  pageText: string;
  recordedAt: Date;
}): PreparedRateStructures {
  const tierRows: PriceTierRow[] = [];
  const pointRows: PricePointRow[] = [];
  const dropped = { invalidLadders: 0, unknownUnits: 0, ungroundedExamples: 0 };
  const pageDigits = digitsOf(args.pageText);

  for (const plan of args.plans) {
    if (!isMeteredPlan(plan)) continue;

    const meter = resolveMeterUnit(plan.unit);
    const structure = (plan.rate_structure ?? null) as RateStructure | null;

    // The ladder: stored whole or not at all.
    let tiers: CostTier[] | null = null;
    if (plan.tiers && plan.tiers.length > 0) {
      const validation = validateTierSet(toCostTiers(plan.tiers));
      if (validation.ok) {
        tiers = validation.tiers;
        for (const t of validation.tiers) {
          tierRows.push({
            competitor_id: args.competitorId,
            plan_name: plan.plan_name,
            unit: meter?.unit ?? null,
            from_qty: t.fromQty,
            to_qty: t.toQty,
            unit_price: t.unitPrice,
            flat_fee: t.flatFee,
            recorded_at: args.recordedAt,
          });
        }
      } else {
        dropped.invalidLadders++;
        logger.warn("Published tier set dropped whole", {
          competitorId: args.competitorId,
          planName: plan.plan_name,
          reason: validation.reason,
          tiers: plan.tiers.length,
        });
      }
    }

    // Cost points stand on a meter two competitors can share. An unnormalised
    // unit keeps its band evidence above but never enters a comparison.
    if (!meter?.canonical) {
      if (plan.unit) dropped.unknownUnits++;
      continue;
    }

    const base = baseFeeFor(plan.plan_name, args.plans);
    const model = {
      rateStructure: structure,
      tiers,
      minimumAmount: plan.minimum_amount ?? null,
      unitPrice: plan.price ?? null,
      packageSize: plan.included_quantity ?? null,
    };

    for (const qty of REFERENCE_VOLUME_PRESETS) {
      const usage = costAtVolume(model, qty);
      if (usage == null) continue;
      pointRows.push({
        competitor_id: args.competitorId,
        plan_name: plan.plan_name,
        meter_unit: meter.unit,
        reference_qty: qty,
        effective_monthly_cost: round2(base + usage),
        currency: plan.currency,
        method: "computed_from_tiers",
        recorded_at: args.recordedAt,
      });
    }

    // A figure the competitor published for a stated volume. Believed only if
    // BOTH its numbers appear on the page — a total we cannot find there is a
    // total the page never printed.
    for (const example of (plan.cost_examples ?? []).slice(0, MAX_PUBLISHED_EXAMPLES)) {
      if (!Number.isFinite(example.qty) || example.qty <= 0) continue;
      if (!Number.isFinite(example.cost) || example.cost < 0) continue;
      if (!pageStates(pageDigits, example.qty) || !pageStates(pageDigits, example.cost)) {
        dropped.ungroundedExamples++;
        continue;
      }
      pointRows.push({
        competitor_id: args.competitorId,
        plan_name: plan.plan_name,
        meter_unit: meter.unit,
        reference_qty: example.qty,
        effective_monthly_cost: round2(example.cost),
        currency: plan.currency,
        method: "published",
        recorded_at: args.recordedAt,
      });
    }
  }

  return { tierRows, pointRows, dropped };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
