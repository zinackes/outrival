// Pricing Intelligence P2 — the entitlement stage of extract-pricing.
//
// Runs in the SAME job, on live runs only, and is an ADDITIVE output by
// contract: whatever fails here, the pricing run stays a success and the plan
// rows write normally (the caller wraps captureEntitlements in try/catch).
//
// Ladder (staged-extraction philosophy, no cached-selector stage in v1):
//   1. deterministic <table> parse, anchored on the extracted plan names — 0 AI
//   2. AI sister task (extract-entitlements) — the one extra call per changed
//      scrape the roadmap card budgets
// then prepareEntitlements applies the CODE-side guards on either source:
//   - substring check: a feature_label absent from the page text is dropped
//     (anti-hallucination is deterministic, posting_facts pattern — never only
//     a prompt instruction)
//   - caps: ~15 features × 6 plans, page order, logged when truncated
//   - collapse guard: a rich prior matrix extracting to <30% of itself is a
//     FAILED extraction — nothing written, no signal (pricing-guard)
//   - slug resolution via the shared catalog; the diff then only trusts
//     canonical slugs for appear/disappear/move (see entitlement-diff)

import {
  resolveFeatureSlug,
  normalizeFeatureLabel,
  diffEntitlements,
  monthlyEquivalent,
  type PricingChange,
} from "@outrival/shared";
import { parseEntitlementTable, type ParsedEntitlement } from "@outrival/scrapers/pricing";
import { extractEntitlements, AI_CONFIG, type PricingPlan } from "@outrival/ai";
import { logger } from "./job-logger";
import { loggedAi, type PlanEntitlementRow } from "./analytics";
import { isSuspectedEntitlementCollapse } from "./pricing-guard";

export const MAX_ENTITLEMENT_FEATURES = 15;
export const MAX_ENTITLEMENT_PLANS = 6;

export interface PreparedEntitlements {
  rows: PlanEntitlementRow[];
  changes: PricingChange[];
  /** Set when the collapse guard blocked the batch (nothing written). */
  skipped: "entitlement_collapse_guard" | null;
  dropped: { substring: number; featureCap: number; planCap: number };
}

/** Plan names cheapest-first from the current batch — resolves the down/upmarket
 * direction of an entitlement move. Quote-based tiers (no price) rank last. */
export function rankPlansByPrice(plans: PricingPlan[]): string[] {
  const best = new Map<string, number>();
  for (const p of plans) {
    if (p.price == null || p.price <= 0) continue;
    const monthly = monthlyEquivalent({
      planName: p.plan_name,
      price: p.price,
      currency: p.currency,
      billingPeriod: p.billing_period,
    });
    if (monthly == null) continue;
    const prior = best.get(p.plan_name);
    if (prior === undefined || monthly < prior) best.set(p.plan_name, monthly);
  }
  const ranked = [...best.entries()].sort((a, b) => a[1] - b[1]).map(([name]) => name);
  const unpriced = [...new Set(plans.map((p) => p.plan_name))].filter((n) => !best.has(n));
  return [...ranked, ...unpriced];
}

/**
 * Pure: raw extracted entitlements (either ladder stage) + the page text +
 * the prior batch → the rows to insert and the typed changes to signal.
 */
export function prepareEntitlements(args: {
  competitorId: string;
  raw: ParsedEntitlement[];
  pageText: string;
  previous: PlanEntitlementRow[] | null;
  planRank: string[];
  recordedAt: Date;
}): PreparedEntitlements {
  const dropped = { substring: 0, featureCap: 0, planCap: 0 };
  const normalizedPage = normalizeFeatureLabel(args.pageText);

  // Deterministic anti-hallucination gate: the verbatim label must exist in the
  // page text (both sides normalized the same way). Table-parsed labels pass by
  // construction; this is what keeps the AI stage honest in code.
  const grounded = args.raw.filter((e) => {
    const ok = normalizedPage.includes(normalizeFeatureLabel(e.feature_label));
    if (!ok) dropped.substring++;
    return ok;
  });

  // Caps, in page order so what survives is what the page leads with.
  const seenFeatures = new Map<string, true>();
  const seenPlans = new Map<string, true>();
  const capped: ParsedEntitlement[] = [];
  for (const e of grounded) {
    const featureKey = normalizeFeatureLabel(e.feature_label);
    const planKey = e.plan_name.trim().toLowerCase();
    if (!seenFeatures.has(featureKey) && seenFeatures.size >= MAX_ENTITLEMENT_FEATURES) {
      dropped.featureCap++;
      continue;
    }
    if (!seenPlans.has(planKey) && seenPlans.size >= MAX_ENTITLEMENT_PLANS) {
      dropped.planCap++;
      continue;
    }
    seenFeatures.set(featureKey, true);
    seenPlans.set(planKey, true);
    capped.push(e);
  }

  const prevCount = args.previous?.length ?? 0;
  if (isSuspectedEntitlementCollapse({ prevCount, nextCount: capped.length })) {
    return { rows: [], changes: [], skipped: "entitlement_collapse_guard", dropped };
  }

  const rows: PlanEntitlementRow[] = capped.map((e) => {
    const { slug, isCanonical } = resolveFeatureSlug(e.feature_label);
    return {
      competitor_id: args.competitorId,
      plan_name: e.plan_name,
      feature_slug: slug,
      feature_label: e.feature_label,
      kind: e.kind,
      value_num: e.value_num ?? null,
      value_text: e.value_text ?? null,
      unit: e.unit ?? null,
      reset_period: e.reset_period ?? null,
      is_canonical: isCanonical ? 1 : 0,
      recorded_at: args.recordedAt,
    };
  });

  // PlanEntitlementRow is structurally an EntitlementRow (plus attribution).
  const changes = diffEntitlements(args.previous ?? [], rows, { planRank: args.planRank });

  return { rows, changes, skipped: null, dropped };
}

/**
 * The full stage: table-first extraction, then the AI sister, then the pure
 * guards. Returns empty on a page with no readable matrix — that is a normal
 * outcome, not an error. Throws only if the AI call itself throws (the caller
 * catches: entitlements must never fail the pricing run).
 */
export async function captureEntitlements(args: {
  competitorId: string;
  html: string;
  text: string;
  plans: PricingPlan[];
  previous: PlanEntitlementRow[] | null;
  recordedAt: Date;
}): Promise<PreparedEntitlements & { resolution: "table" | "ai" | "none" }> {
  const planNames = [...new Set(args.plans.map((p) => p.plan_name))];

  let raw = parseEntitlementTable(args.html, planNames);
  let resolution: "table" | "ai" | "none" = raw ? "table" : "none";

  if (!raw) {
    const extracted = await loggedAi(
      "extract_entitlements",
      AI_CONFIG.classification,
      () => extractEntitlements(args.text, planNames),
      { competitorId: args.competitorId },
    );
    if (extracted && extracted.entitlements.length > 0) {
      raw = extracted.entitlements.map((e) => ({
        plan_name: e.plan_name,
        feature_label: e.feature_label,
        kind: e.kind,
        value_num: e.value_num ?? null,
        value_text: e.value_text ?? null,
        unit: e.unit ?? null,
        reset_period: e.reset_period ?? null,
      }));
      resolution = "ai";
    }
  }

  if (!raw || raw.length === 0) {
    return {
      rows: [],
      changes: [],
      skipped: null,
      dropped: { substring: 0, featureCap: 0, planCap: 0 },
      resolution: "none",
    };
  }

  const prepared = prepareEntitlements({
    competitorId: args.competitorId,
    raw,
    pageText: args.text,
    previous: args.previous,
    planRank: rankPlansByPrice(args.plans),
    recordedAt: args.recordedAt,
  });

  if (prepared.skipped) {
    logger.warn("Entitlement extraction collapsed vs prior batch — keeping the prior matrix", {
      competitorId: args.competitorId,
      prevCount: args.previous?.length ?? 0,
      nextCount: prepared.rows.length,
      resolution,
    });
  } else if (
    prepared.dropped.substring + prepared.dropped.featureCap + prepared.dropped.planCap >
    0
  ) {
    logger.log("Entitlement rows dropped by guards", {
      competitorId: args.competitorId,
      ...prepared.dropped,
    });
  }

  return { ...prepared, resolution };
}
