// Pricing Intelligence v2 — Phase 5: the credit burn-rate diff, sibling of
// diffPricingBatches / diffEntitlements / diffPriceTiers. Pure: two
// credit_burn_rates batches in, typed PricingChange entries out, ready to merge
// into the same deterministic signal the other three feed (apps/workers
// lib/pricing-signals). Emission guards live with the caller, identical to P1:
// never on backfill, never on a first capture, never from a collapse-guarded
// extraction.
//
// WHY THIS EXISTS. A product that sells credits has two prices, and only one of
// them is on the pricing page as a number: what a pack costs, and what an action
// SPENDS. Doubling "1 scan = 1 credit" to "1 scan = 2 credits" halves what the
// same money buys while every price column in the product keeps reading
// "unchanged". That is the move this differ is here to catch, so an increase is
// HIGH — it is a price rise nobody printed — and a decrease is medium.
//
// THE JOIN KEY IS THE PAGE'S OWN WORDING. `action` is stored verbatim because it
// is the evidence; it is matched case- and whitespace-insensitively because that
// is presentation, not substance. Anything past that (stemming, synonyms) would
// be guessing that two differently named actions are the same action, and a
// wrong match here invents a rate change out of a rewording.

import type { PricingChange, PricingChangeSeverity } from "./pricing-diff";

/** One mapping row, in the snake_case shape of credit_burn_rates (what the
 * worker inserts and reads back — both sides feed in without mapping). */
export interface CreditBurnRow {
  action: string;
  credits: number;
}

const actionKey = (action: string): string => action.trim().toLowerCase().replace(/\s+/g, " ");

const pct = (prev: number, next: number): number =>
  prev === 0 ? 0 : Math.round(((next - prev) / prev) * 1000) / 10;

const fmtCredits = (n: number): string => {
  const rounded = Math.round(n * 100) / 100;
  return `${rounded.toLocaleString("en-US")} credit${rounded === 1 ? "" : "s"}`;
};

/** "OCR — 5 credits" — the exact human_change side, and the fact line's tail. */
const phrase = (action: string, credits: number): string => `${action} — ${fmtCredits(credits)}`;

/**
 * Diff two consecutive burn-rate batches into typed, severity-carrying changes.
 *
 * Returns [] when either side is empty: a first capture is not a repricing, and
 * a batch that came back empty is far more likely to be a page we failed to read
 * than a product that stopped charging credits — treating it as "every action
 * removed" would fire a wall of changes off our own miss.
 */
export function diffCreditBurns(
  prev: readonly CreditBurnRow[],
  next: readonly CreditBurnRow[],
): PricingChange[] {
  if (prev.length === 0 || next.length === 0) return [];

  const before = new Map<string, CreditBurnRow>();
  for (const r of prev) if (!before.has(actionKey(r.action))) before.set(actionKey(r.action), r);
  const after = new Map<string, CreditBurnRow>();
  for (const r of next) if (!after.has(actionKey(r.action))) after.set(actionKey(r.action), r);

  const changes: PricingChange[] = [];
  const base = {
    planName: null,
    billingPeriod: null,
    currency: null,
    // The meter IS the credit here: "8 credits per OCR" is a rate on credits.
    unit: "credit",
  } as const;

  for (const [key, now] of after) {
    const was = before.get(key);
    if (!was) {
      changes.push({
        ...base,
        type: "credit_action_added",
        severity: "low",
        previousValue: null,
        currentValue: now.credits,
        pctChange: null,
        direction: null,
        humanBefore: null,
        humanAfter: phrase(now.action, now.credits),
        summary: `New credit cost published: ${phrase(now.action, now.credits)}`,
      });
      continue;
    }
    // Float equality only: a published mapping moves in whole steps, so anything
    // smaller than this is our own parse noise, not a repricing.
    if (Math.abs(now.credits - was.credits) < 1e-9) continue;

    const up = now.credits > was.credits;
    const delta = pct(was.credits, now.credits);
    const severity: PricingChangeSeverity = up ? "high" : "medium";
    changes.push({
      ...base,
      type: "credit_burn_changed",
      severity,
      previousValue: was.credits,
      currentValue: now.credits,
      pctChange: delta,
      direction: up ? "up" : "down",
      // The page's CURRENT wording on both sides: the action did not change, its
      // cost did, and showing two spellings of one action would read as two things.
      humanBefore: phrase(now.action, was.credits),
      humanAfter: phrase(now.action, now.credits),
      summary:
        `${now.action}: ${fmtCredits(was.credits)} → ${fmtCredits(now.credits)}` +
        (delta === 0 ? "" : ` (${delta > 0 ? "+" : "−"}${Math.abs(delta)}%)`) +
        (up ? " — same pack price buys less" : ""),
    });
  }

  for (const [key, was] of before) {
    if (after.has(key)) continue;
    changes.push({
      ...base,
      type: "credit_action_removed",
      severity: "low",
      previousValue: was.credits,
      currentValue: null,
      pctChange: null,
      direction: null,
      humanBefore: phrase(was.action, was.credits),
      humanAfter: null,
      summary: `Credit cost no longer published: ${phrase(was.action, was.credits)}`,
    });
  }

  return changes;
}
