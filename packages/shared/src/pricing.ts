// Pricing taxonomy shared across packages (db enum values, scraper output,
// worker routing, web display). Kept here so scrapers, workers and web all
// agree on the same status strings without importing each other.

// Single source: the type is derived from the tuple so z.enum(PRICING_STATUSES)
// stays in sync with PricingStatus.
//   public         prices shown clearly
//   public_partial some tiers visible, others "Contact us"
//   gated_demo     no prices, routes to demo / sales
//   gated_signup   no prices, requires creating an account
//   dynamic        interactive calculator, not statically scrapable
//   unknown        not detected, reason uncertain
export const PRICING_STATUSES = [
  "public",
  "public_partial",
  "gated_demo",
  "gated_signup",
  "dynamic",
  "unknown",
] as const;

export type PricingStatus = (typeof PRICING_STATUSES)[number];

// ---------------------------------------------------------------------------
// billing_period taxonomy (pricing_history.billing_period is a free-text column).
//
// It names the period the `price` COVERS — never the commitment the plan is sold
// under. That distinction is the whole reason this comment exists: pricing pages
// print "$16/mo billed annually", and reading that as a $16 YEARLY price divides
// the competitor's real price by 12 everywhere downstream (monthlyEquivalent, the
// price ladder, sectoral medians, battle cards). `reconcileBillingPeriods`
// (@outrival/scrapers/pricing) enforces the canon on every extraction.
//
//   monthly | yearly | one_time  → a comparable currency amount on a price axis
//     monthly                     → the amount charged for ONE MONTH, whatever the term
//     yearly                      → the amount charged for ONE YEAR: the annual TOTAL.
//                                   A plan sold both ways is TWO rows sharing a
//                                   plan_name (monthly 20, yearly 192), so the annual
//                                   discount stays derivable (192/12 = 16 < 20)
//   custom                        → quote-based, price null ("Contact sales")
//   usage                         → a per-`unit` RATE, not a per-time subscription
//                                   ($0.10 / API call, $0.99 / resolved ticket).
//                                   Covers metered usage AND outcome-based pricing;
//                                   the `unit` distinguishes them (no separate enum).
// ---------------------------------------------------------------------------
export const BILLING_PERIOD_VALUES = [
  "monthly",
  "yearly",
  "one_time",
  "custom",
  "usage",
] as const;
export type BillingPeriodValue = (typeof BILLING_PERIOD_VALUES)[number];

// Periods whose `price` is directly comparable on a single currency axis. A usage
// rate ($0.10) must NEVER be averaged or charted against a subscription price ($99),
// so numeric readers (compare band, sectoral median, trends) filter through this;
// display readers stay period-agnostic and render usage rows with their unit.
export const COMPARABLE_PRICE_PERIODS: ReadonlySet<string> = new Set([
  "monthly",
  "yearly",
  "one_time",
]);
export function isComparablePricePeriod(
  billingPeriod: string | null | undefined,
): boolean {
  return billingPeriod != null && COMPARABLE_PRICE_PERIODS.has(billingPeriod);
}

// Plain-language label per status, for the user-facing before/after of a pricing
// repositioning signal (patch-14 "Why this insight?" panel). English only.
export const PRICING_STATUS_LABELS: Record<PricingStatus, string> = {
  public: "Public pricing",
  public_partial: "Partially public pricing",
  gated_demo: "Gated — contact sales",
  gated_signup: "Gated — sign-up required",
  dynamic: "Usage-based / calculator",
  unknown: "Pricing not detected",
};

// ---------------------------------------------------------------------------
// User-editable pricing overlay (per-plan lock).
//
// Detected pricing lives in the append-only pricing_history log — never edited.
// The user's hand-edits live on competitors.overrides as a small overlay, merged
// with the latest detected batch at read time. This keeps the time-series clean
// (charts stay "observed only") while letting the user own the displayed value.
//
// Per-plan lock: the merge key is the normalized plan name. A user can edit,
// add, or hide individual plans. Plans the user never touched keep flowing from
// the scraper (fresh on every scrape); new detected plans appear on their own;
// an edited plan whose detection diverges surfaces `drift` instead of being
// overwritten, so a manual value can't silently rot.
// ---------------------------------------------------------------------------

// One pricing plan, in the shape shared by the detected batch and the overlay.
// price is nullable: quote-based tiers ("Enterprise", "Contact sales") carry no
// public number but are still real plans worth showing.
export interface PricingTier {
  planName: string;
  price: number | null;
  currency: string;
  billingPeriod: string;
  // patch — dimensional pricing (2026 models). Optional so every existing
  // constructor stays valid. `unit`: what a `usage`/per-seat price applies to
  // ("API call", "resolved conversation", "credit", "seat"); null/absent = flat.
  // `includedQuantity`: units bundled into the plan (credit pack size, included
  // calls); null/absent = N/A. See docs/pricing-coverage-2026.md.
  unit?: string | null;
  includedQuantity?: number | null;
}

export type PricingPlanAction = "edit" | "add" | "hide";

// One user override, keyed by normalized plan name. `value` is required for
// edit/add (the locked plan) and absent for hide.
export interface PricingPlanOverride {
  planKey: string;
  action: PricingPlanAction;
  value?: PricingTier;
  lastEditedByUserAt: string; // ISO timestamp
}

// The competitor-level overlay (competitors.overrides jsonb). Extensible: only
// pricingPlans today, room for analyst notes etc. later without a new column.
export interface CompetitorOverrides {
  pricingPlans?: PricingPlanOverride[];
}

// A resolved plan as shown to the user, carrying its provenance so the UI can
// badge "Edited by you" / "Added" and flag drift or a vanished plan.
export interface ResolvedPricingTier extends PricingTier {
  origin: "detected" | "edited" | "added";
  locked: boolean; // a user override governs this plan
  // Present on an edited plan whose current detection disagrees with the locked
  // value: the source moved, we kept yours, here's what the source now says.
  drift?: PricingTier;
  // A locked plan the latest scrape no longer surfaces at all.
  noLongerDetected?: boolean;
}

// Merge identity for a plan. Case/whitespace-insensitive so "Pro Plan" and
// "pro  plan" collapse to the same plan across scrapes and edits.
export function normalizePlanKey(planName: string): string {
  return planName.trim().toLowerCase().replace(/\s+/g, " ");
}

function tiersDiffer(a: PricingTier, b: PricingTier): boolean {
  return (
    a.price !== b.price ||
    a.currency !== b.currency ||
    a.billingPeriod !== b.billingPeriod
  );
}

/**
 * Resolve the pricing tiers to display: the latest detected batch with the
 * user's per-plan overlay applied. Pure — the single source of truth for
 * "current pricing" across the pricing tab, battle cards, compare and Ask, so
 * an edit is reflected everywhere rather than only on the tab.
 *
 * - untouched detected plans pass through (scraper keeps them fresh),
 * - an `edit`/`add` override with a matching detected key locks that plan and
 *   surfaces `drift` when the detection diverges,
 * - a `hide` override drops the detected plan,
 * - an `add` with no detected match is appended,
 * - an `edit`/`hide` whose plan vanished from detection is kept (edit) with
 *   `noLongerDetected`, or dropped (hide).
 */
export function resolveCurrentPricing(
  detected: PricingTier[],
  overrides: CompetitorOverrides | null | undefined,
): ResolvedPricingTier[] {
  const plans = overrides?.pricingPlans ?? [];
  const byKey = new Map<string, PricingPlanOverride>();
  for (const ov of plans) byKey.set(ov.planKey, ov);

  const consumed = new Set<string>();
  const result: ResolvedPricingTier[] = [];

  for (const tier of detected) {
    const key = normalizePlanKey(tier.planName);
    const ov = byKey.get(key);
    if (!ov) {
      result.push({ ...tier, origin: "detected", locked: false });
      continue;
    }
    consumed.add(key);
    if (ov.action === "hide") continue;
    if (ov.value) {
      result.push({
        ...ov.value,
        origin: ov.action === "add" ? "added" : "edited",
        locked: true,
        drift: tiersDiffer(ov.value, tier) ? tier : undefined,
      });
    } else {
      // Malformed edit (no value) — fall back to the detected plan untouched.
      result.push({ ...tier, origin: "detected", locked: false });
    }
  }

  // Overrides with no detected counterpart: user-added plans, or edits/hides on
  // plans the source no longer shows.
  for (const ov of plans) {
    if (consumed.has(ov.planKey)) continue;
    if (ov.action === "hide") continue;
    if (!ov.value) continue;
    result.push({
      ...ov.value,
      origin: ov.action === "add" ? "added" : "edited",
      locked: true,
      noLongerDetected: ov.action === "edit" ? true : undefined,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Price position (products portfolio + product Pricing tab).
//
// "Where does my entry price sit against the rivals I track" needs one number
// per product, drawn the same way on both sides of the comparison — otherwise
// the gap is an artefact of how each side was picked. These two helpers are that
// rule, kept here so the API and the web never derive it twice.
// ---------------------------------------------------------------------------

// A buyer compares monthly list prices first, so that is the axis we read. Only
// when a product publishes no monthly tier do we fall back, and the period is
// returned with the price so a caller never charts $49/month against $490/year.
const ENTRY_PERIOD_ORDER = ["monthly", "yearly", "one_time"] as const;

export interface EntryPrice {
  planName: string;
  price: number;
  currency: string;
  billingPeriod: string;
}

/**
 * The cheapest PAID tier of a pricing table, or null when nothing qualifies.
 *
 * Free tiers (price 0) and quote-based tiers (price null) are excluded on
 * purpose: neither is a price a buyer can compare, and counting a $0 plan as the
 * entry point would report every freemium product as infinitely undercutting.
 * Usage rates are excluded too, by never being in ENTRY_PERIOD_ORDER, since a
 * per-call rate does not belong on a subscription axis.
 */
export function entryPrice(tiers: PricingTier[]): EntryPrice | null {
  for (const period of ENTRY_PERIOD_ORDER) {
    let best: EntryPrice | null = null;
    for (const t of tiers) {
      if (t.billingPeriod !== period) continue;
      if (t.price === null || t.price === undefined || t.price <= 0) continue;
      if (best === null || t.price < best.price) {
        best = {
          planName: t.planName,
          price: t.price,
          currency: t.currency,
          billingPeriod: t.billingPeriod,
        };
      }
    }
    if (best) return best;
  }
  return null;
}

/**
 * An entry price read on the monthly axis, or null when it cannot be.
 *
 * A yearly plan lands on a monthly axis divided by 12 (arithmetic, not a guess),
 * but a one-time price is not a rate at all and a usage rate is priced per unit,
 * so neither has a monthly equivalent. Same rule as the compare lens
 * (apps/web/src/components/dashboard/compare/derive.ts), so one pricing table
 * reads the same on the products ladder and on the comparison grid.
 */
export function monthlyEquivalent(entry: EntryPrice): number | null {
  if (entry.billingPeriod === "monthly") return entry.price;
  if (entry.billingPeriod === "yearly") return entry.price / 12;
  return null;
}

/**
 * Median of a price sample, or null when the sample is empty.
 *
 * The median, not the mean: one $2,000 enterprise list price would drag an
 * average far above anything a buyer actually chooses between, and the whole
 * point of the number is to say what the middle of the market asks. Callers must
 * pass one currency and one billing period (see entryPrice).
 */
export function priceMedian(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

// ---------------------------------------------------------------------------
// Ladder comparability (competitor Pricing tab).
//
// Ranking two pricing tables against each other only means something when both
// are ladders of the SAME kind of offer, read on the SAME billing axis. These
// two helpers are the gate, kept pure and here so the tab and any later reader
// (battle cards, digests) never re-derive it differently.
// ---------------------------------------------------------------------------

/**
 * The billing axes a ladder can be price-ranked on, in the order a buyer reads
 * them. `usage` is absent on purpose: a per-unit rate is not a rung.
 */
export type LadderAxis = "monthly" | "yearly" | "one_time";

const LADDER_AXES: readonly LadderAxis[] = ["monthly", "yearly", "one_time"];

/**
 * The axes both tables can actually be ranked on, in preference order.
 *
 * Takes the billing periods of each side's PRICED rows (a quote-based row has no
 * number, so it belongs to no axis and is ranked last on whichever axis wins).
 * An empty result means the two tables share no axis at all — a monthly SaaS
 * ladder against a one-off service menu — and no per-rung % is defensible.
 *
 * Mixing axes is what made a $1,000 one-time audit sort BELOW a $2,292/mo
 * retainer and get labelled the competitor's "Entry" tier.
 */
export function sharedLadderAxes(
  oursPricedPeriods: readonly string[],
  theirsPricedPeriods: readonly string[],
): LadderAxis[] {
  const ours = new Set(oursPricedPeriods);
  const theirs = new Set(theirsPricedPeriods);
  return LADDER_AXES.filter((axis) => ours.has(axis) && theirs.has(axis));
}

// Words a plan name carries when it names a RUNG rather than a product. Broad on
// purpose: one hit anywhere in the table is enough to accept it as a ladder, so a
// miss costs a suppressed comparison while a false hit costs a misleading one.
const TIER_WORD =
  /\b(free|freemium|trial|starter|start|basic|lite|essentials?|standard|plus|pro|professional|premium|growth|grow|scale|business|teams?|advanced|ultimate|enterprise|custom|individual|personal|solo|agency|unlimited|hobby|core|max|mvp|dedicated|community|developer|launch|company|organization|tier)\b/i;

// A plan name that is really a column header the extractor mistook for a plan.
const EXTRACTION_ARTIFACT = /^(from|up to|starting at|prices?|from price|monthly|yearly)$/i;

/**
 * Whether a pricing table lists individual ITEMS rather than tiers of one offer.
 *
 * Real cases this catches in production: 12 trading cards, 14 domain TLDs, a
 * hardware catalogue, a menu of separately-sold APIs, and `From` / `Up to`
 * captured as plan names. None of them has a "tier 2", so aligning them against
 * a SaaS ladder by price rank produces pairs that are arithmetic, not meaning.
 *
 * Three signals, any one of which is decisive:
 *  - a plan named like a table header (extraction artifact);
 *  - three or more plans and not ONE of them names a rung;
 *  - two or more distinct `Section · Plan` prefixes, which is our extractor
 *    saying the page priced several separate products.
 */
export function looksLikeCatalog(planNames: readonly string[]): boolean {
  const names = planNames.map((n) => n.trim()).filter(Boolean);
  if (names.length < 2) return false;
  if (names.some((n) => EXTRACTION_ARTIFACT.test(n))) return true;
  if (names.length >= 3 && !names.some((n) => TIER_WORD.test(n))) return true;
  const prefixes = new Set<string>();
  for (const n of names) {
    const i = n.indexOf(" · ");
    if (i > 0) prefixes.add(n.slice(0, i).toLowerCase());
  }
  return prefixes.size >= 2;
}

export type PricingRepositioningType =
  | "pricing_gated" // pulled public prices behind a gate
  | "pricing_public" // exposed previously gated prices
  | "pricing_usage_based"; // switched to a calculator / usage-based model

export interface PricingRepositioning {
  type: PricingRepositioningType;
  severity: "high" | "medium";
}

const GATED: ReadonlySet<PricingStatus> = new Set(["gated_demo", "gated_signup"]);
const VISIBLE: ReadonlySet<PricingStatus> = new Set(["public", "public_partial"]);

/**
 * Compare two consecutive pricing statuses and return the strategic
 * repositioning they represent, or null if the transition is not meaningful.
 *
 * Transitions involving `unknown` are never significant: a status flipping to
 * or from `unknown` usually means a flaky scrape, not a real pricing move, and
 * we must not emit a signal on noise.
 */
export function detectPricingRepositioning(
  previous: PricingStatus,
  current: PricingStatus,
): PricingRepositioning | null {
  if (previous === current) return null;
  if (previous === "unknown" || current === "unknown") return null;

  // Visible → gated: removing public prices, likely an enterprise reposition.
  if (VISIBLE.has(previous) && GATED.has(current)) {
    return { type: "pricing_gated", severity: "high" };
  }

  // Gated → visible: opening prices up, likely a self-serve reposition.
  if (GATED.has(previous) && VISIBLE.has(current)) {
    return { type: "pricing_public", severity: "medium" };
  }

  // Static → dynamic: introduction of usage-based / calculator pricing.
  if (VISIBLE.has(previous) && current === "dynamic") {
    return { type: "pricing_usage_based", severity: "medium" };
  }

  return null;
}
