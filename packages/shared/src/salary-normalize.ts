/**
 * Salary normalisation for hiring salary bands (Hiring Intelligence v2 P3).
 *
 * PURE. No I/O, no AI, no currency conversion, ever.
 *
 * THE CONVENTIONS, stated once here because every number downstream inherits them:
 *
 *  1. **The canonical base is ANNUAL.** A yearly figure is taken as-is, a monthly
 *     one is multiplied by 12. Hourly and daily rates are EXCLUDED outright — they
 *     are how contractors and shift roles are priced, and annualising them means
 *     inventing an hours-per-year figure the posting never stated. Mixing them into
 *     a band does not make it noisier, it makes it wrong.
 *
 *  2. **Currencies are never converted.** Bands are computed PER CURRENCY, and a
 *     posting with no currency is excluded rather than assumed. An FX rate is a
 *     time-varying number we do not capture, so a "median" spanning EUR and USD
 *     would move when the euro moves and read as a pay change.
 *
 *  3. **The number a posting contributes is the MIDPOINT of its range**, (min+max)/2.
 *     A posting that discloses only one bound contributes that bound. Using the
 *     minimum would track the cheapest thing they will pay rather than the offer;
 *     using the maximum would track their ceiling. The midpoint is the only choice
 *     that reads the same whether a company publishes wide or narrow ranges.
 *
 *  4. **An unknown period is inferred only when it cannot be ambiguous.** With no
 *     period stated, an amount at or above ANNUAL_INFERENCE_FLOOR can only be a
 *     yearly figure (no monthly salary is 20 000 in a currency where 20 000 is a
 *     plausible annual one). Below it, the posting is EXCLUDED — the same rule P2
 *     applies to geography: an unresolved value is dropped, never guessed.
 */

/** Pay periods an ATS can state. Only the first two annualise (see convention 1). */
export const SALARY_PERIODS = ["yearly", "monthly", "hourly", "daily"] as const;
export type SalaryPeriod = (typeof SALARY_PERIODS)[number];

export function isSalaryPeriod(x: unknown): x is SalaryPeriod {
  return typeof x === "string" && (SALARY_PERIODS as readonly string[]).includes(x);
}

/**
 * With no period stated, an amount at or above this can only be annual. Deliberately
 * currency-agnostic: it is a floor on AMBIGUITY, not on money. In a currency where a
 * monthly salary reaches 20 000 (JPY, INR, HUF), an annual one is an order of
 * magnitude higher still, so the reading stays unambiguous in the direction that
 * matters — a monthly figure never gets read as annual.
 */
export const ANNUAL_INFERENCE_FLOOR = 20_000;

/**
 * Below this, an annualised figure is not compensation in any currency on earth
 * (the weakest ones price salaries in millions, not hundreds). It catches the
 * "€0 – €1" placeholder ranges some boards emit and the stray "401" a loose parse
 * picks up, without pretending to know what a real salary looks like per currency.
 */
const MIN_PLAUSIBLE_ANNUAL = 1_000;

export interface SalaryInput {
  min: number | null;
  max: number | null;
  /** ISO-4217-ish code as the ATS gave it; case-insensitive, required. */
  currency: string | null;
  /** Stated pay period, or null when the provider exposes none. */
  period: string | null;
}

export interface NormalizedAnnualSalary {
  /** Midpoint of the range, annualised, rounded to the unit. */
  annualMidpoint: number;
  /** Upper-cased currency — the band key, never converted. */
  currency: string;
  /** How the period was settled: stated by the ATS, or inferred by amount. */
  periodSource: "stated" | "inferred";
}

/**
 * Turn one posting's disclosed compensation into the single annual number that
 * feeds a percentile, or null when it must not feed one.
 *
 * Null (i.e. EXCLUDED, and each of these is a deliberate exclusion rather than a
 * failure to parse):
 *   - no amount, or no currency
 *   - an hourly or daily rate
 *   - no stated period and an amount too small to disambiguate
 *   - a range that cannot be one: a non-positive bound, or max below min
 *   - an annualised result below MIN_PLAUSIBLE_ANNUAL
 */
export function normalizeAnnualSalary(input: SalaryInput): NormalizedAnnualSalary | null {
  const currency = input.currency?.trim().toUpperCase();
  if (!currency) return null;

  const min = finite(input.min);
  const max = finite(input.max);
  if (min == null && max == null) return null;
  // A bound at or below zero is a placeholder, not a floor, and an inverted range is
  // a parse artefact. Either way the posting is dropped whole: half a range read is
  // worse than no range, because it computes with confidence.
  if ((min != null && min <= 0) || (max != null && max <= 0)) return null;
  if (min != null && max != null && max < min) return null;

  const midpoint = min != null && max != null ? (min + max) / 2 : ((min ?? max) as number);

  const stated = input.period?.trim().toLowerCase();
  let multiplier: number;
  let periodSource: "stated" | "inferred";
  if (stated === "yearly") {
    multiplier = 1;
    periodSource = "stated";
  } else if (stated === "monthly") {
    multiplier = 12;
    periodSource = "stated";
  } else if (stated === "hourly" || stated === "daily") {
    // Convention 1: contractor pricing is not an FTE salary.
    return null;
  } else {
    // No period stated. Only the LOWEST disclosed bound can settle it: a range whose
    // floor is under the ambiguity threshold could be a monthly figure, whatever its
    // ceiling says.
    const lowest = Math.min(...[min, max].filter((n): n is number => n != null));
    if (lowest < ANNUAL_INFERENCE_FLOOR) return null;
    multiplier = 1;
    periodSource = "inferred";
  }

  const annualMidpoint = Math.round(midpoint * multiplier);
  if (annualMidpoint < MIN_PLAUSIBLE_ANNUAL) return null;
  return { annualMidpoint, currency, periodSource };
}

function finite(n: number | null | undefined): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/**
 * Linear-interpolated percentile over an ASCENDING array, the definition
 * `percentile_cont` uses in Postgres — so a band computed here and a band computed
 * in SQL over the same values agree. Empty input returns null rather than 0.
 */
export function percentile(sortedAsc: ReadonlyArray<number>, p: number): number | null {
  if (sortedAsc.length === 0) return null;
  if (sortedAsc.length === 1) return sortedAsc[0] as number;
  const rank = (sortedAsc.length - 1) * p;
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const loV = sortedAsc[lo] as number;
  if (lo === hi) return loV;
  const hiV = sortedAsc[hi] as number;
  return loV + (hiV - loV) * (rank - lo);
}

/** True when a posting discloses any compensation at all, whatever its shape. */
export function hasDisclosedSalary(p: { salaryMin: number | null; salaryMax: number | null }): boolean {
  return p.salaryMin != null || p.salaryMax != null;
}

export type DisclosureVerdict = "yes" | "partial" | "no";

/** Share of open roles that must carry a salary before "yes" is the honest answer. */
export const DISCLOSURE_SHARE = 0.3;
/** Below this many salaried roles, a share is an accident of a small board. */
export const DISCLOSURE_MIN_ROLES = 3;

/**
 * Does this competitor publish salaries? Read off the CURRENT stock of open roles,
 * so it answers the question a reader actually asks ("if I look at their board
 * today, will I see pay?") rather than a historical average.
 *
 * "Disclosed" here means the posting carries a figure at all — including the hourly
 * rates and currency-less amounts the BANDS exclude. Publishing pay and publishing
 * pay we can band are different claims, and this badge makes the first one.
 *
 * Lives here rather than next to the band logic because all three of the API, the
 * web app and the worker have to reach the same verdict from the same two numbers,
 * and only `@outrival/shared` is importable by all three.
 */
export function disclosureVerdict(disclosed: number, total: number): DisclosureVerdict {
  if (total <= 0 || disclosed <= 0) return "no";
  if (disclosed >= DISCLOSURE_MIN_ROLES && disclosed / total >= DISCLOSURE_SHARE) return "yes";
  return "partial";
}
