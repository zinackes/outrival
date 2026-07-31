/**
 * Which element on a calculator is the TOTAL, and what it says (P4).
 *
 * Pure, like controls.ts. The browser moves one control and serialises every
 * element whose text changed; this module decides which of them is the number a
 * buyer would read as "what I would pay", and parses it with the same money
 * grammar the rest of the pricing stack uses (`matchPrice`).
 *
 * Two refusals:
 *   - nothing priced changed → `no_total`. We moved something that isn't the
 *     quantity, or the total is drawn on a canvas. Either way there is no
 *     reading, and an unchanged element read as a total would report the same
 *     cost at every volume — a perfectly flat, perfectly wrong price curve.
 *   - the total names a YEARLY period → `total_not_monthly`. price_points stores
 *     an effective MONTHLY cost; dividing an annual figure by twelve would be a
 *     number the competitor never displayed, on a page whose own toggle could
 *     have shown us the monthly one.
 */

import { matchPrice } from "../harvest";
import { MONTHLY, YEARLY } from "../period-vocab";

export interface TotalCandidate {
  /** Document-relative CSS selector built in-page. */
  selector: string;
  before: string;
  after: string;
  /** Leafiness: a total is a leaf ("$80.00"), a card is not. */
  childCount: number;
  /** Surrounding text (the element's own + its parent's), for the period guard. */
  context: string;
}

export type TotalPick =
  | { ok: true; selector: string; currency: string; amount: number }
  | { ok: false; reason: "no_total" | "total_not_monthly" };

/** A parsed amount + currency from a total's text, or null when it holds none. */
export function parseTotal(text: string): { amount: number; currency: string } | null {
  const hit = matchPrice(text);
  if (!hit) return null;
  if (!Number.isFinite(hit.amount) || hit.amount <= 0) return null;
  return hit;
}

/**
 * True when the wording around a figure says it is an ANNUAL amount. A page that
 * says both ("$80/mo, billed annually") is read as monthly — the per-month token
 * is what the figure itself is, which is the same rule reconcileBillingPeriods
 * applies to captured plans.
 */
export function readsAsYearly(context: string): boolean {
  return YEARLY.test(context) && !MONTHLY.test(context);
}

/**
 * The element that IS the total, out of everything that moved.
 *
 * Preference order, most-decisive first: it must carry a price both before and
 * after and the amount must have CHANGED (a static "from $10" moved nothing),
 * then the leafiest element (a card containing the total also "changed"), then
 * the largest amount — on a page that shows a per-unit rate next to the bill,
 * the bill is the bigger of the two.
 */
export function pickTotal(candidates: TotalCandidate[]): TotalPick {
  const priced = candidates
    .map((c) => ({ c, before: parseTotal(c.before), after: parseTotal(c.after) }))
    .filter(
      (x): x is { c: TotalCandidate; before: { amount: number; currency: string }; after: { amount: number; currency: string } } =>
        x.before != null && x.after != null && x.before.amount !== x.after.amount,
    );
  if (priced.length === 0) return { ok: false, reason: "no_total" };

  const monthly = priced.filter((x) => !readsAsYearly(`${x.c.context} ${x.c.after}`));
  if (monthly.length === 0) return { ok: false, reason: "total_not_monthly" };

  monthly.sort((a, b) => {
    if (a.c.childCount !== b.c.childCount) return a.c.childCount - b.c.childCount;
    return b.after.amount - a.after.amount;
  });

  const top = monthly[0]!;
  return {
    ok: true,
    selector: top.c.selector,
    currency: top.after.currency,
    amount: top.after.amount,
  };
}
