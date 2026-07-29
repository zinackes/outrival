/**
 * Billing-period reconciliation — the single canon for what a stored price MEANS.
 *
 *   monthly  the amount charged for ONE MONTH  (whatever the commitment)
 *   yearly   the amount charged for ONE YEAR   (the annual TOTAL, never a rate)
 *
 * Pricing pages break this constantly. The dominant SaaS layout shows a big
 * "$16/mo" with "billed annually" (and often "$192/year") underneath — a MONTHLY
 * rate under a yearly term. Every extractor stage (schema.org mapper, cached
 * parser, AI floor) can read that as `yearly: 16`, and every downstream reader
 * then treats 16 as a full year: `monthlyEquivalent` divides it by 12 → $1.33/mo,
 * the price ladder ranks the competitor as 15x cheaper than it is, medians and
 * battle cards inherit the error. The displayed "$16/yr" is simply false.
 *
 * This pass repairs that AFTER extraction, deterministically and with zero AI, on
 * two independent kinds of evidence:
 *
 *   1. RATIO — the same plan carries a monthly M and a "yearly" Y with Y < M. An
 *      annual total below one month's price is arithmetically impossible, so Y is
 *      a per-month rate: Y := Y x 12.
 *   2. TEXT — the "yearly" amount appears on the page immediately followed by a
 *      per-month token ("$16/mo", "16 € par mois"). The page states the period
 *      itself; we believe it over the extractor. With an annual-commitment phrase
 *      nearby, the derived annual total (x12) is emitted as a second row, so the
 *      user gets BOTH prices.
 *
 * Only the yearly→monthly direction is repaired: it is the direction that
 * UNDERSTATES a price by 12x and poisons every average. The inverse (a yearly
 * total mislabelled monthly) is left to the plausibility gate, since flipping a
 * genuinely monthly row on a stray number match would be a fabrication.
 *
 * Pure and idempotent — a repaired pair sits at ratio 12, which no rule matches.
 */

import { MONTHLY, YEARLY, ANNUAL_COMMITMENT } from "./period-vocab";

export interface ReconcilablePlan {
  plan_name: string;
  price: number | null;
  billing_period: string;
}

const MONTHS_PER_YEAR = 12;
// A yearly already sitting at ~10-12x its monthly is a sound annual total (same
// band as ./validate-ratios). Text evidence is not consulted for those: the amount
// lookup is by NUMBER, so an unrelated "$200/mo" elsewhere on the page would
// otherwise multiply a perfectly good $200/year into $2,400.
const SOUND_ANNUAL_RATIO = 9;
// How far after an amount the period token must sit to be "about" it: "$16/mo"
// and "16 € par mois" fit easily; a sentence away does not.
const PERIOD_TAIL_CHARS = 28;
// The commitment phrase ("billed annually") is a caption under the price rather
// than part of it, so it gets a wider window — still card-sized, never page-sized.
const COMMITMENT_WINDOW_CHARS = 160;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function planKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * A regex matching the amount AS PRINTED on a page: thousands separated by a
 * comma, dot or space ("1,299" / "1 299"), and a trailing ".00"/",00" tolerated on
 * a whole number. Anchored so "16" can't match inside "160" or "1.16".
 */
function amountRegex(amount: number): RegExp {
  const [intPart = "", fracPart] = String(amount).split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, "[.,\\s]?");
  const frac = fracPart ? `[.,]${fracPart}` : "(?:[.,]0{1,2})?";
  return new RegExp(`(?<![\\d.,])${grouped}${frac}(?![\\d])`, "g");
}

interface AmountEvidence {
  /** The page prints this amount with a per-month token right after it. */
  perMonth: boolean;
  /** ...and an annual-commitment phrase sits nearby ("billed annually"). */
  annualCommitment: boolean;
}

/** What the page itself says about an amount's period. */
function readEvidence(amount: number, text: string): AmountEvidence {
  const re = amountRegex(amount);
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const end = match.index + match[0].length;
    // The commitment phrase is removed before the period test: YEARLY's
    // `\bannual(ly)?\b` branch matches "billed annually", which is the caption of
    // a per-month price, not a claim that the amount covers a year.
    const tail = text.slice(end, end + PERIOD_TAIL_CHARS).replace(ANNUAL_COMMITMENT, " ");
    // A "/yr" in the same breath means this occurrence is the annual figure —
    // not evidence of a per-month rate, whatever else the card says.
    if (!MONTHLY.test(tail) || YEARLY.test(tail)) continue;
    const window = text.slice(
      Math.max(0, match.index - COMMITMENT_WINDOW_CHARS),
      end + COMMITMENT_WINDOW_CHARS,
    );
    return { perMonth: true, annualCommitment: ANNUAL_COMMITMENT.test(window) };
  }
  return { perMonth: false, annualCommitment: false };
}

/**
 * Rewrite the plans of one extraction so every `yearly` price is a true annual
 * total. Returns a new array; rows are only ever repaired or ADDED (the derived
 * annual total of a per-month rate), never dropped.
 *
 * `pageText` is the same text the extractor read (htmlToText output). Omit it and
 * only the ratio rule applies — which is exactly what the staged-extraction
 * plausibility gate needs, since it judges a stage's output on its own.
 */
export function reconcileBillingPeriods<T extends ReconcilablePlan>(
  plans: T[],
  pageText?: string,
): T[] {
  const monthlyByPlan = new Map<string, number>();
  for (const p of plans) {
    if (p.billing_period !== "monthly" || p.price == null || p.price <= 0) continue;
    const key = planKey(p.plan_name);
    const known = monthlyByPlan.get(key);
    // Cheapest monthly row of the plan: on a card carrying both periods it is the
    // discounted one, so a per-month "yearly" figure equal to it still compares.
    if (known == null || p.price < known) monthlyByPlan.set(key, p.price);
  }

  const out: T[] = [];
  for (const plan of plans) {
    if (plan.billing_period !== "yearly" || plan.price == null || plan.price <= 0) {
      out.push(plan);
      continue;
    }

    const monthly = monthlyByPlan.get(planKey(plan.plan_name));
    // Strictly cheaper than a month: impossible for an annual total.
    const ratioSaysPerMonth = monthly != null && plan.price < monthly;
    const ratioSaysAnnual = monthly != null && plan.price >= monthly * SOUND_ANNUAL_RATIO;
    const evidence =
      pageText && !ratioSaysPerMonth && !ratioSaysAnnual
        ? readEvidence(plan.price, pageText)
        : { perMonth: false, annualCommitment: false };

    if (!ratioSaysPerMonth && !evidence.perMonth) {
      out.push(plan);
      continue;
    }

    const annualTotal = round2(plan.price * MONTHS_PER_YEAR);

    // The plan already publishes its month-to-month price, so this row IS the
    // annual variant — expressed per month. Restate it as the annual total.
    if (monthly != null) {
      out.push({ ...plan, price: annualTotal });
      continue;
    }

    // No monthly counterpart: the figure itself is the monthly rate. Keep it as
    // such, and add the annual total only when the page says the term is yearly —
    // otherwise x12 would invent a price the competitor never published.
    // (Cast: `billing_period` widens to `string` on the spread, while callers hold
    // a narrower literal union. The written value is one of that union's members.)
    out.push({ ...plan, billing_period: "monthly" } as T);
    if (evidence.annualCommitment) {
      out.push({ ...plan, price: annualTotal });
    }
  }

  return out;
}
