/**
 * Pricing Intelligence P4 — what a measured calculator reading is allowed to be.
 *
 * The probe (@outrival/scrapers pricing/calculator) drives a competitor's own
 * public pricing calculator and reads the total it displays. That number is
 * evidence of a price nobody publishes as a list — and it is also the least
 * certain number in the whole pricing stack: it comes from a UI, at one moment,
 * through selectors we inferred. So everything that decides whether a reading is
 * BELIEVED lives here, pure and testable, away from the browser.
 *
 * The rule the module exists to enforce: a run is stored whole or dropped whole.
 * A partially-believed series computes a confidently wrong cost curve, and a
 * wrong cost is worse than no cost — the competitor simply stays where it was
 * before this phase, priced from its published ladder (or not at all).
 */

import { formatPrice, type PricingChange } from "./pricing-diff";
import { meterUnitLabel } from "./unit-alias";

/** One volume the probe was asked to measure, and what the page then showed. */
export interface ProbeReading {
  qty: number;
  /** The monthly cost read off the page/endpoint. */
  cost: number;
  currency: string;
  /**
   * The SECOND reading of the same quantity, taken after moving the control
   * away and back. A calculator that answers differently to the same question
   * is not a calculator we can quote.
   */
  recheck?: number | null;
}

/** A cost nobody charges monthly — past this the reading is a mis-parse (an
 * account number, a phone number, a year concatenated into the total). */
export const MAX_PROBE_MONTHLY_COST = 10_000_000;

/** Relative tolerance on the double reading, and on the monotonicity test. Both
 * absorb rounding and cent-level jitter, nothing more. */
export const PROBE_EPSILON = 0.005; // 0.5%

export type ProbeRejection =
  | "empty"
  | "currency_mismatch"
  | "non_positive_cost"
  | "implausible_cost"
  | "non_monotonic"
  | "reread_mismatch"
  | "duplicate_qty";

export type ProbeValidation =
  | { ok: true; readings: ProbeReading[]; currency: string }
  | { ok: false; reason: ProbeRejection; detail: string };

const near = (a: number, b: number): boolean =>
  Math.abs(a - b) <= Math.max(Math.abs(a), Math.abs(b), 1) * PROBE_EPSILON;

/**
 * Accept a measured series only if it behaves like a price list: one currency,
 * positive and plausible amounts, never cheaper for more units, and repeatable.
 *
 * Monotonicity tolerates EQUALITY (a flat included band, or a plan whose monthly
 * minimum swallows the usage at low volumes) but never a decrease: a total that
 * falls as the quantity rises means the control we moved was not the meter, or
 * the number we read was not the total.
 *
 * One failed check drops the whole run — see the module header.
 */
export function validateProbeSeries(readings: ProbeReading[]): ProbeValidation {
  if (readings.length === 0) return { ok: false, reason: "empty", detail: "no readings" };

  const currency = readings[0]!.currency;
  const seen = new Set<number>();
  for (const r of readings) {
    if (r.currency !== currency) {
      return {
        ok: false,
        reason: "currency_mismatch",
        detail: `${currency} vs ${r.currency} at ${r.qty}`,
      };
    }
    if (!Number.isFinite(r.cost) || r.cost <= 0) {
      return { ok: false, reason: "non_positive_cost", detail: `${r.cost} at ${r.qty}` };
    }
    if (r.cost > MAX_PROBE_MONTHLY_COST) {
      return { ok: false, reason: "implausible_cost", detail: `${r.cost} at ${r.qty}` };
    }
    if (r.recheck != null && !near(r.cost, r.recheck)) {
      return {
        ok: false,
        reason: "reread_mismatch",
        detail: `${r.cost} then ${r.recheck} at ${r.qty}`,
      };
    }
    if (seen.has(r.qty)) {
      return { ok: false, reason: "duplicate_qty", detail: `${r.qty} measured twice` };
    }
    seen.add(r.qty);
  }

  const sorted = [...readings].sort((a, b) => a.qty - b.qty);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    if (cur.cost < prev.cost && !near(cur.cost, prev.cost)) {
      return {
        ok: false,
        reason: "non_monotonic",
        detail: `${prev.cost} at ${prev.qty} → ${cur.cost} at ${cur.qty}`,
      };
    }
  }

  return { ok: true, readings: sorted, currency };
}

// ---------------------------------------------------------------------------
// Probe-to-probe movement
// ---------------------------------------------------------------------------

/**
 * What backs a measured cost. `screenshot` is the frame the amount was read off;
 * `api_response` is the page's own pricing request replayed at that volume, kept
 * whole (request URL, response body, the path the amount came from) and only ever
 * used after that endpoint agreed with a screenshot-backed reading.
 */
export type EvidenceKind = "screenshot" | "api_response";

/** A stored measured point, in the shape both sides of the comparison use. */
export interface MeasuredPoint {
  planName: string;
  meterUnit: string;
  referenceQty: number;
  effectiveMonthlyCost: number;
  currency: string | null;
}

/** Below this, a measured move is jitter (a rounding change, a cent of FX). */
export const PROBE_SIGNAL_MIN_PCT = 5;
/** At or past this, the move is worth interrupting someone for. */
export const PROBE_SIGNAL_HIGH_PCT = 15;

const pointKey = (p: MeasuredPoint): string =>
  `${p.planName}|${p.meterUnit}|${p.referenceQty}`;

const pct = (prev: number, next: number): number =>
  Math.round(((next - prev) / prev) * 1000) / 10;

const signedPct = (value: number): string =>
  `${value > 0 ? "+" : "−"}${Math.abs(value)}%`;

/**
 * What moved between two probe runs, at EQUAL quantities only — comparing a cost
 * at 10k against a cost at 100k would report the ladder as a price change.
 *
 * Capped at HIGH by construction. A measured reading is one observation of a UI
 * we drove, and critical is the band that bypasses every moderation layer and
 * emails someone within minutes; a published rate earns that, a probe does not.
 * (The double-capture confirmation that could raise the bar is Veracity's job.)
 */
export function diffProbePoints(
  previous: MeasuredPoint[],
  current: MeasuredPoint[],
): PricingChange[] {
  if (previous.length === 0 || current.length === 0) return [];
  const before = new Map(previous.map((p) => [pointKey(p), p]));
  const changes: PricingChange[] = [];

  for (const now of current) {
    const then = before.get(pointKey(now));
    if (!then) continue;
    if (then.effectiveMonthlyCost <= 0) continue;
    const change = pct(then.effectiveMonthlyCost, now.effectiveMonthlyCost);
    if (Math.abs(change) < PROBE_SIGNAL_MIN_PCT) continue;

    const volume = `${now.referenceQty.toLocaleString("en-US")} ${meterUnitLabel(
      now.meterUnit,
      now.referenceQty,
    )}`;
    const label = `${now.planName} at ${volume}`;
    changes.push({
      type: "rate_changed",
      severity: Math.abs(change) >= PROBE_SIGNAL_HIGH_PCT ? "high" : "medium",
      planName: now.planName,
      billingPeriod: "usage",
      unit: now.meterUnit,
      currency: now.currency,
      previousValue: then.effectiveMonthlyCost,
      currentValue: now.effectiveMonthlyCost,
      pctChange: change,
      direction: change > 0 ? "up" : "down",
      // The exact measured amounts, so the signal reads "$80.00 at 100k requests
      // → $64.00 at 100k requests" rather than a percentage nobody can check.
      humanBefore: `${formatPrice(then.effectiveMonthlyCost, then.currency)} at ${volume}`,
      humanAfter: `${formatPrice(now.effectiveMonthlyCost, now.currency)} at ${volume}`,
      summary: `${label}: ${formatPrice(then.effectiveMonthlyCost, then.currency)} → ${formatPrice(
        now.effectiveMonthlyCost,
        now.currency,
      )} (${signedPct(change)}), measured on their own calculator`,
    });
  }

  return changes;
}
