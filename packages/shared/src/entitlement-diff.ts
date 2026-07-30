// Pricing Intelligence v2 — Phase 2: the entitlement (features × plans) diff,
// sibling of diffPricingBatches. Pure: two plan_entitlements batches in, typed
// PricingChange entries out, ready to merge into the same deterministic signal
// the batch diff feeds (apps/workers lib/pricing-signals). Emission guards live
// with the caller, identical to P1: never on backfill, never on a first capture,
// never from a collapse-guarded extraction.
//
// Signal trust boundary: appear / disappear / move detection only fires on
// CANONICAL slugs (entitlement-catalog). A free-text slug IS the label's exact
// wording, so a marketing rewording would read as removed + added — free-text
// rows still enter the matrix (and the UI diff) but never a signal. The one
// exception is entitlement_limit_changed: an identical slug on both sides means
// the wording did not move, so a numeric limit move on it is trustworthy
// whatever its canonicity.

import type { PricingChange, PricingChangeSeverity } from "./pricing-diff";
import { CANONICAL_ENTITLEMENT_SLUGS } from "./entitlement-catalog";
import { normalizePlanKey } from "./pricing";

/** One matrix row, in the snake_case shape of plan_entitlements (what the
 * worker inserts and reads back — both sides feed in without mapping). */
export interface EntitlementRow {
  plan_name: string;
  feature_slug: string;
  feature_label: string;
  kind: string; // boolean | config | metered
  value_num?: number | null;
  value_text?: string | null;
  unit?: string | null;
  reset_period?: string | null;
  is_canonical?: number | boolean | null;
}

// A limit that moved ≥ this |%| reads high instead of medium (locked table:
// "entitlement_limit_changed — medium/high selon %").
export const ENTITLEMENT_LIMIT_HIGH_PCT = 30;

const isCanonicalSlug = (r: EntitlementRow): boolean =>
  r.is_canonical === 1 || r.is_canonical === true || CANONICAL_ENTITLEMENT_SLUGS.has(r.feature_slug);

const pct = (prev: number, next: number): number =>
  Math.round(((next - prev) / prev) * 1000) / 10;

const signedPct = (value: number): string =>
  `${value > 0 ? "+" : "−"}${Math.abs(value)}%`;

const fmt = (n: number): string => n.toLocaleString("en-US");

/** "Starter — 5 seats" / "Pro — 30 days" — the exact human_change side. */
function limitPhrase(planName: string, value: number, row: EntitlementRow): string {
  const unit = row.unit ?? row.reset_period ?? null;
  return `${planName} — ${fmt(value)}${unit ? ` ${unit}` : ""}`;
}

interface FeatureState {
  /** Display label, from the first row carrying the slug. */
  label: string;
  /** normalized plan key → row */
  byPlan: Map<string, EntitlementRow>;
  /** Display plan names, page order. */
  planNames: string[];
  canonical: boolean;
}

function byFeature(rows: EntitlementRow[]): Map<string, FeatureState> {
  const map = new Map<string, FeatureState>();
  for (const r of rows) {
    const state = map.get(r.feature_slug) ?? {
      label: r.feature_label,
      byPlan: new Map(),
      planNames: [],
      canonical: isCanonicalSlug(r),
    };
    const planKey = normalizePlanKey(r.plan_name);
    if (!state.byPlan.has(planKey)) {
      state.byPlan.set(planKey, r);
      state.planNames.push(r.plan_name);
    }
    map.set(r.feature_slug, state);
  }
  return map;
}

const sameSet = (a: Set<string> | string[], b: Set<string> | string[]): boolean => {
  const sa = a instanceof Set ? a : new Set(a);
  const sb = b instanceof Set ? b : new Set(b);
  return sa.size === sb.size && [...sa].every((k) => sb.has(k));
};

/**
 * Diff two consecutive entitlement batches into typed, severity-carrying
 * changes. `planRank` — plan names cheapest-first, derived by the caller from
 * the CURRENT pricing batch — resolves the down/upmarket direction of a move
 * (SSO reaching a cheaper plan = downmarket). Returns [] when either side is
 * empty: a first capture (or a wiped one — the caller's collapse guard owns
 * that) is not a packaging move. Never emits `critical`.
 */
export function diffEntitlements(
  prev: EntitlementRow[],
  next: EntitlementRow[],
  opts?: { planRank?: string[] },
): PricingChange[] {
  if (prev.length === 0 || next.length === 0) return [];

  const rank = new Map<string, number>();
  (opts?.planRank ?? []).forEach((name, i) => rank.set(normalizePlanKey(name), i));
  const cheapestRank = (planKeys: Iterable<string>): number | null => {
    let best: number | null = null;
    for (const key of planKeys) {
      const r = rank.get(key);
      if (r !== undefined && (best === null || r < best)) best = r;
    }
    return best;
  };

  const prevFeatures = byFeature(prev);
  const nextFeatures = byFeature(next);
  const changes: PricingChange[] = [];

  const base = {
    billingPeriod: null,
    currency: null,
    pctChange: null,
    direction: null,
  } as const;

  for (const [slug, after] of nextFeatures) {
    const before = prevFeatures.get(slug);

    if (!before) {
      // New to the matrix. Canonical-only: a reworded free-text line is not news.
      if (!after.canonical) continue;
      changes.push({
        ...base,
        type: "entitlement_added",
        severity: "low",
        planName: after.planNames.join(", "),
        unit: null,
        previousValue: null,
        currentValue: null,
        humanBefore: null,
        humanAfter: `${after.label} — ${after.planNames.join(", ")}`,
        summary: `New listed feature: ${after.label} (${after.planNames.join(", ")})`,
      });
      continue;
    }

    // Present on both sides — did its plan set move? (canonical-only, same reason)
    if (
      after.canonical &&
      before.canonical &&
      !sameSet([...before.byPlan.keys()], [...after.byPlan.keys()])
    ) {
      const beforeRank = cheapestRank(before.byPlan.keys());
      const afterRank = cheapestRank(after.byPlan.keys());
      // Down = the feature now starts at a cheaper plan (more accessible);
      // up = its cheapest carrier got more expensive (gated harder). Without a
      // usable rank, a strictly larger set still reads as widening (down).
      const direction: "up" | "down" | null =
        beforeRank !== null && afterRank !== null && beforeRank !== afterRank
          ? afterRank < beforeRank
            ? "down"
            : "up"
          : after.byPlan.size > before.byPlan.size
            ? "down"
            : after.byPlan.size < before.byPlan.size
              ? "up"
              : null;
      const market =
        direction === "down" ? " (moved downmarket)" : direction === "up" ? " (moved upmarket)" : "";
      changes.push({
        ...base,
        type: "entitlement_moved",
        severity: "high",
        planName: after.planNames.join(", "),
        unit: null,
        previousValue: null,
        currentValue: null,
        direction,
        humanBefore: `${before.label} — ${before.planNames.join(", ")}`,
        humanAfter: `${after.label} — ${after.planNames.join(", ")}`,
        summary: `${after.label}: available on ${before.planNames.join(", ")} → ${after.planNames.join(", ")}${market}`,
      });
    }

    // Numeric limit moves, per plan the feature sits on both sides. Slug equality
    // is the identity here, so free-text slugs qualify too (same wording).
    for (const [planKey, afterRow] of after.byPlan) {
      const beforeRow = before.byPlan.get(planKey);
      if (
        !beforeRow ||
        beforeRow.value_num == null ||
        afterRow.value_num == null ||
        beforeRow.value_num <= 0 ||
        beforeRow.value_num === afterRow.value_num
      )
        continue;
      const limitPct = pct(beforeRow.value_num, afterRow.value_num);
      const severity: PricingChangeSeverity =
        Math.abs(limitPct) >= ENTITLEMENT_LIMIT_HIGH_PCT ? "high" : "medium";
      changes.push({
        ...base,
        type: "entitlement_limit_changed",
        severity,
        planName: afterRow.plan_name,
        unit: afterRow.unit ?? beforeRow.unit ?? null,
        previousValue: beforeRow.value_num,
        currentValue: afterRow.value_num,
        pctChange: limitPct,
        direction: limitPct > 0 ? "up" : "down",
        humanBefore: limitPhrase(afterRow.plan_name, beforeRow.value_num, beforeRow),
        humanAfter: limitPhrase(afterRow.plan_name, afterRow.value_num, afterRow),
        summary: `${afterRow.plan_name}: ${after.label} ${fmt(beforeRow.value_num)} → ${fmt(afterRow.value_num)}${
          afterRow.unit ? ` ${afterRow.unit}` : ""
        } (${signedPct(limitPct)})`,
      });
    }
  }

  // Gone from the matrix entirely (still-listed-elsewhere is a move, above).
  for (const [slug, before] of prevFeatures) {
    if (nextFeatures.has(slug) || !before.canonical) continue;
    changes.push({
      ...base,
      type: "entitlement_removed",
      severity: "medium",
      planName: before.planNames.join(", "),
      unit: null,
      previousValue: null,
      currentValue: null,
      humanBefore: `${before.label} — ${before.planNames.join(", ")}`,
      humanAfter: null,
      summary: `Listed feature removed: ${before.label} (was on ${before.planNames.join(", ")})`,
    });
  }

  return changes;
}
