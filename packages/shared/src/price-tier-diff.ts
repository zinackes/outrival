// Pricing Intelligence v2 — Phase 3: the volume-ladder diff, sibling of
// diffPricingBatches and diffEntitlements. Pure: two price_tiers batches in,
// typed PricingChange entries out, ready to merge into the same deterministic
// pricing signal (apps/workers lib/pricing-signals). Emission guards live with
// the caller, identical to P1 and P2: never on backfill, never on a first
// capture, never from a guarded extraction.
//
// The move this exists to catch is the one nobody announces: a boundary that
// slides. "First 10,000 requests at $0.10" becoming "first 5,000 at $0.10" is a
// price rise with no price change — every published number is identical and the
// bill doubles for anyone in the band that vanished. It reads HIGH.

import type { PricingChange, PricingChangeSeverity } from "./pricing-diff";
import { formatPrice, PRICE_UNDERCUT_CRITICAL_PCT } from "./pricing-diff";
import { normalizePlanKey } from "./pricing";

/** One published band, in the snake_case shape of price_tiers (what the worker
 * inserts and reads back — both sides feed in without mapping). */
export interface TierBandRow {
  plan_name: string;
  unit?: string | null;
  from_qty: number;
  to_qty?: number | null;
  unit_price?: number | null;
  flat_fee?: number | null;
}

const pct = (prev: number, next: number): number =>
  Math.round(((next - prev) / prev) * 1000) / 10;

const signedPct = (value: number): string =>
  `${value > 0 ? "+" : "−"}${Math.abs(value)}%`;

const approxEqual = (a: number, b: number): boolean =>
  Math.abs(a - b) <= Math.max(Math.abs(a), Math.abs(b)) * 1e-6;

/** "10k", "1.5M", "750" — a boundary reads as the page prints it, not as
 * 10,000.00. */
export function formatQty(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${trim(value / 1_000_000)}M`;
  if (abs >= 1_000) return `${trim(value / 1_000)}k`;
  return trim(value);
}

function trim(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** "0–10k @ $0.10" · "50k+ @ $0.05" · "0–1k + $25" */
export function bandPhrase(band: TierBandRow, currency: string | null): string {
  const range =
    band.to_qty == null
      ? `${formatQty(band.from_qty)}+`
      : `${formatQty(band.from_qty)}–${formatQty(band.to_qty)}`;
  const parts: string[] = [];
  if (band.unit_price != null) parts.push(`@ ${formatPrice(band.unit_price, currency)}`);
  if (band.flat_fee != null && band.flat_fee > 0) {
    parts.push(`+ ${formatPrice(band.flat_fee, currency)}`);
  }
  return parts.length ? `${range} ${parts.join(" ")}` : range;
}

/** The whole ladder on one line, capped so a 12-band table can't run away. */
function ladderPhrase(bands: TierBandRow[], currency: string | null, max = 4): string {
  const shown = bands.slice(0, max).map((b) => bandPhrase(b, currency));
  return bands.length > max ? `${shown.join(" · ")} · +${bands.length - max} more` : shown.join(" · ");
}

interface Ladder {
  planName: string;
  unit: string | null;
  bands: TierBandRow[];
}

const ladderKey = (r: TierBandRow): string =>
  `${normalizePlanKey(r.plan_name)}|${r.unit ?? ""}`;

function byLadder(rows: TierBandRow[]): Map<string, Ladder> {
  const map = new Map<string, Ladder>();
  for (const r of rows) {
    const key = ladderKey(r);
    const existing = map.get(key);
    if (existing) existing.bands.push(r);
    else map.set(key, { planName: r.plan_name, unit: r.unit ?? null, bands: [r] });
  }
  for (const ladder of map.values()) ladder.bands.sort((a, b) => a.from_qty - b.from_qty);
  return map;
}

const sameBounds = (a: TierBandRow, b: TierBandRow): boolean =>
  approxEqual(a.from_qty, b.from_qty) &&
  ((a.to_qty == null && b.to_qty == null) ||
    (a.to_qty != null && b.to_qty != null && approxEqual(a.to_qty, b.to_qty)));

/** The first band whose bounds differ — the exact pair a human should read. */
function firstDivergence(
  prev: TierBandRow[],
  next: TierBandRow[],
): { before: TierBandRow | null; after: TierBandRow | null } | null {
  const len = Math.max(prev.length, next.length);
  for (let i = 0; i < len; i++) {
    const a = prev[i] ?? null;
    const b = next[i] ?? null;
    if (a && b && sameBounds(a, b)) continue;
    return { before: a, after: b };
  }
  return null;
}

function rateChangeSeverity(pctChange: number): PricingChangeSeverity {
  // Same table as P1: a rate is multiplied by volume, so it has no low band.
  return pctChange < -PRICE_UNDERCUT_CRITICAL_PCT ? "critical" : "medium";
}

export interface DiffPriceTiersOptions {
  /** The batch's currency — price_tiers stores the bands, pricing_history
   * stores what they are priced in, and the two are one capture. */
  currency?: string | null;
}

/**
 * Diff two consecutive price_tiers batches into typed changes. Returns [] when
 * either side is empty: a first ladder is not a ladder that moved, and a
 * capture that failed to read one must never read as a ladder withdrawn.
 */
export function diffPriceTiers(
  prev: TierBandRow[],
  next: TierBandRow[],
  options: DiffPriceTiersOptions = {},
): PricingChange[] {
  if (prev.length === 0 || next.length === 0) return [];
  const currency = options.currency ?? null;
  const changes: PricingChange[] = [];
  const prevLadders = byLadder(prev);
  const nextLadders = byLadder(next);

  for (const [key, after] of nextLadders) {
    const before = prevLadders.get(key);
    // A ladder that appears on a plan (or disappears from one) is not reported:
    // it is far more often the extractor finding the table for the first time
    // than the competitor publishing one, and a false "tiers introduced" on
    // every competitor the week this ships is exactly the noise P1 avoided.
    if (!before) continue;

    const divergence = firstDivergence(before.bands, after.bands);
    if (divergence) {
      const { before: bandBefore, after: bandAfter } = divergence;
      const prevBound = bandBefore?.to_qty ?? null;
      const nextBound = bandAfter?.to_qty ?? null;
      const pctChange =
        prevBound != null && nextBound != null && prevBound > 0 ? pct(prevBound, nextBound) : null;
      const label = after.unit ? `${after.planName} (${after.unit})` : after.planName;
      changes.push({
        type: "tier_boundary_moved",
        severity: "high",
        planName: after.planName,
        billingPeriod: "usage",
        unit: after.unit,
        currency,
        previousValue: prevBound,
        currentValue: nextBound,
        pctChange,
        direction: pctChange == null ? null : pctChange > 0 ? "up" : "down",
        humanBefore: `${label} — ${bandBefore ? bandPhrase(bandBefore, currency) : "no band"}`,
        humanAfter: `${label} — ${bandAfter ? bandPhrase(bandAfter, currency) : "no band"}`,
        summary: `${label}: volume bands moved, ${ladderPhrase(before.bands, currency)} → ${ladderPhrase(after.bands, currency)}`,
      });
    }

    // A band's own rate, on bands that still start at the same quantity — a
    // rate compared across a moved boundary would be two different bands.
    const beforeByStart = new Map(before.bands.map((b) => [b.from_qty, b]));
    for (const band of after.bands) {
      const prevBand = beforeByStart.get(band.from_qty);
      if (!prevBand) continue;
      if (prevBand.unit_price == null || band.unit_price == null) continue;
      if (prevBand.unit_price <= 0) continue;
      if (approxEqual(prevBand.unit_price, band.unit_price)) continue;
      const pctChange = pct(prevBand.unit_price, band.unit_price);
      const label = after.unit ? `${after.planName} (${after.unit})` : after.planName;
      changes.push({
        type: "rate_changed",
        severity: rateChangeSeverity(pctChange),
        planName: after.planName,
        billingPeriod: "usage",
        unit: after.unit,
        currency,
        previousValue: prevBand.unit_price,
        currentValue: band.unit_price,
        pctChange,
        direction: pctChange > 0 ? "up" : "down",
        humanBefore: `${label} — ${bandPhrase(prevBand, currency)}`,
        humanAfter: `${label} — ${bandPhrase(band, currency)}`,
        summary: `${label}: ${bandPhrase(prevBand, currency)} → ${bandPhrase(band, currency)} (${signedPct(pctChange)})`,
      });
    }
  }

  return changes;
}
