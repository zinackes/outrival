/**
 * What a metered plan costs at a volume (Pricing Intelligence P3).
 *
 * Pure arithmetic over the ladder a competitor publishes — zero AI, zero I/O.
 * This is the function that lets a usage-based competitor enter a price
 * comparison at all: a rate ($0.10/request) and a subscription ($99/mo) are not
 * the same kind of number, but "what you pay at 10,000 requests a month" is.
 *
 * The vocabulary is the one the billing engines share (Stripe, Lago, Metronome):
 *
 *   standard    qty x unit_price
 *   graduated   each band's own rate applies to the units inside it (a sum)
 *   volume      the reached band's rate applies to ALL units
 *   package     priced in blocks — ceil(qty / block) x block price
 *   percentage  a share of transacted value — NOT modelled here (see below)
 *
 * `percentage` is excluded on purpose: its meter is money, not a countable unit,
 * so a "cost at 10,000 units" for it would be a number with no meaning. It is
 * surfaced as a badge and never enters a band.
 *
 * BAND ARITHMETIC. A band's `toQty` is the last quantity it covers (null = the
 * unbounded last band), and the units it prices are those above the PREVIOUS
 * band's `toQty`. `fromQty` is what the page prints ("0–10k", "10,001–50,000")
 * and is kept for display and for the diff; the maths runs on `toQty` alone, so
 * the two notations a page may use for the same ladder compute identically
 * instead of leaving a one-unit hole between bands.
 */

export const RATE_STRUCTURES = [
  "standard",
  "graduated",
  "volume",
  "package",
  "percentage",
] as const;
export type RateStructure = (typeof RATE_STRUCTURES)[number];

export function isRateStructure(value: unknown): value is RateStructure {
  return typeof value === "string" && (RATE_STRUCTURES as readonly string[]).includes(value);
}

/** One published volume band. */
export interface CostTier {
  fromQty: number;
  /** Last quantity the band covers; null = unbounded (the final band). */
  toQty: number | null;
  unitPrice: number | null;
  /** Charged once on entering the band (stair-step ladders). */
  flatFee: number | null;
}

export interface CostModelInput {
  rateStructure: RateStructure | null;
  /** The published ladder, when the page has one. */
  tiers?: CostTier[] | null;
  /** Monthly floor: what the plan bills before a single unit is consumed. Not
   * additive — the bill is max(usage, minimum). */
  minimumAmount?: number | null;
  /** The plain per-unit rate, used by `standard` and as the fallback when a
   * ladder is absent (a `usage` row's price). For `package`, the price of ONE
   * block. */
  unitPrice?: number | null;
  /** Block size for `package` ("$5 per 1,000 emails" → 1000). */
  packageSize?: number | null;
}

// A ladder past this is not a published ladder, it is a mis-parse of a table.
export const MAX_TIERS = 12;

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * The cost of `qty` units in one month, or null when the model cannot answer:
 * a percentage plan, a missing rate, an empty ladder, or a nonsense quantity.
 * Never a zero standing in for "unknown" — a zero here would read as free.
 */
export function costAtVolume(input: CostModelInput, qty: number): number | null {
  if (!isFiniteNumber(qty) || qty < 0) return null;

  const usage = usageCost(input, qty);
  if (usage == null) return null;

  const minimum = isFiniteNumber(input.minimumAmount) ? input.minimumAmount : 0;
  return Math.max(usage, minimum);
}

function usageCost(input: CostModelInput, qty: number): number | null {
  const tiers = normalizeLadder(input.tiers);

  switch (input.rateStructure) {
    case "percentage":
      // Its meter is money. There is no volume to price.
      return null;

    case "graduated":
      return tiers ? graduatedCost(tiers, qty) : null;

    case "volume":
      return tiers ? volumeCost(tiers, qty) : null;

    case "package": {
      const size = input.packageSize;
      const blockPrice = input.unitPrice;
      if (!isFiniteNumber(size) || size <= 0) return null;
      if (!isFiniteNumber(blockPrice) || blockPrice < 0) return null;
      return Math.ceil(qty / size) * blockPrice;
    }

    case "standard":
    case null:
    case undefined: {
      // A ladder with no structure naming it is not a model: graduated and
      // volume price the SAME bands differently, so picking one would be a
      // guess dressed as a number.
      if (tiers) return null;
      // A plain rate — a `usage` row whose page never published a ladder is
      // still a cost we can compute.
      const rate = input.unitPrice;
      if (!isFiniteNumber(rate) || rate < 0) return null;
      return qty * rate;
    }

    default:
      return null;
  }
}

/** Bands sorted by their lower bound, or null when the ladder is unusable. */
function normalizeLadder(tiers: CostTier[] | null | undefined): CostTier[] | null {
  if (!tiers || tiers.length === 0) return null;
  return [...tiers].sort((a, b) => a.fromQty - b.fromQty);
}

/** Units the band at index `i` prices, given the sorted ladder. */
function unitsInBand(tiers: CostTier[], i: number, qty: number): number {
  const band = tiers[i]!;
  const floor = i === 0 ? 0 : (tiers[i - 1]!.toQty ?? Infinity);
  const ceiling = band.toQty ?? Infinity;
  return Math.max(0, Math.min(qty, ceiling) - floor);
}

function graduatedCost(tiers: CostTier[], qty: number): number {
  let total = 0;
  for (let i = 0; i < tiers.length; i++) {
    const units = unitsInBand(tiers, i, qty);
    const band = tiers[i]!;
    // A flat fee is charged on ENTERING the band. The first band is entered at
    // any quantity, so a "$25 platform fee + usage" ladder bills its $25 at
    // zero usage — which is what that ladder says.
    const entered = units > 0 || i === 0;
    if (entered && isFiniteNumber(band.flatFee)) total += band.flatFee;
    if (units > 0 && isFiniteNumber(band.unitPrice)) total += units * band.unitPrice;
  }
  return total;
}

/** The band a quantity lands in: the first whose ceiling still covers it. */
export function reachedTier(tiers: CostTier[], qty: number): CostTier | null {
  const ladder = normalizeLadder(tiers);
  if (!ladder) return null;
  for (const band of ladder) {
    if (band.toQty == null || qty <= band.toQty) return band;
  }
  return ladder[ladder.length - 1] ?? null;
}

function volumeCost(tiers: CostTier[], qty: number): number | null {
  const band = reachedTier(tiers, qty);
  if (!band) return null;
  const fee = isFiniteNumber(band.flatFee) ? band.flatFee : 0;
  if (!isFiniteNumber(band.unitPrice)) return fee > 0 ? fee : null;
  return qty * band.unitPrice + fee;
}

// ---------------------------------------------------------------------------
// Validation — a ladder is stored whole or not at all
// ---------------------------------------------------------------------------

export type TierValidation =
  | { ok: true; tiers: CostTier[] }
  | { ok: false; reason: string };

/**
 * Accept a published ladder only if it is one: bands ordered, non-overlapping,
 * contiguous, priced, and few enough to be a table rather than a mis-parse.
 *
 * An invalid set is rejected WHOLE, never trimmed to its valid prefix. A
 * half-read ladder computes a confidently wrong cost, and a wrong cost is worse
 * than no cost — the competitor simply stays out of the metered band, which is
 * exactly where it was before this phase.
 */
export function validateTierSet(tiers: CostTier[]): TierValidation {
  if (tiers.length === 0) return { ok: false, reason: "empty" };
  if (tiers.length > MAX_TIERS) return { ok: false, reason: `over_${MAX_TIERS}_tiers` };

  for (const t of tiers) {
    if (!isFiniteNumber(t.fromQty) || t.fromQty < 0) return { ok: false, reason: "bad_from_qty" };
    if (t.toQty != null && (!isFiniteNumber(t.toQty) || t.toQty <= t.fromQty)) {
      return { ok: false, reason: "bad_to_qty" };
    }
    if (t.unitPrice != null && (!isFiniteNumber(t.unitPrice) || t.unitPrice < 0)) {
      return { ok: false, reason: "negative_unit_price" };
    }
    if (t.flatFee != null && (!isFiniteNumber(t.flatFee) || t.flatFee < 0)) {
      return { ok: false, reason: "negative_flat_fee" };
    }
    if (t.unitPrice == null && t.flatFee == null) return { ok: false, reason: "unpriced_tier" };
  }

  const sorted = [...tiers].sort((a, b) => a.fromQty - b.fromQty);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    if (cur.fromQty <= prev.fromQty) return { ok: false, reason: "duplicate_from_qty" };
    // Only the last band may be unbounded — an open band in the middle would
    // swallow every one after it.
    if (prev.toQty == null) return { ok: false, reason: "unbounded_middle_tier" };
    if (cur.fromQty < prev.toQty) return { ok: false, reason: "overlapping_tiers" };
    // A page writes the next band starting either AT the previous ceiling
    // ("10,000–50,000") or one above it ("10,001–50,000"); anything wider is a
    // hole in the ladder, and a hole cannot be priced.
    if (cur.fromQty > prev.toQty + 1) return { ok: false, reason: "gap_between_tiers" };
  }

  return { ok: true, tiers: sorted };
}
