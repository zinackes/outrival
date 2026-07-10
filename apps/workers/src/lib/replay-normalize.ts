import type { ExtractorKind } from "@outrival/ai";

const CURRENCY_BY_SYMBOL: Record<string, string> = { "€": "EUR", $: "USD", "£": "GBP", "¥": "JPY" };

// `par\s+an\b` alongside the literal `\/an\b` so the unslashed French form
// ("par an") is recognized too, not just the abbreviated "/an".
const YEARLY_RE = /\/yr\b|year|annuel|\/an\b|par\s+an\b/i;
const MONTHLY_RE = /\/mo\b|month|mois/i;
const ONE_TIME_RE = /one[- ]?time|once|lifetime/i;

/**
 * Bridge replayExtractor's raw output (bare row array for list specs) to the
 * source schemas' object shape, filling the fields the generated specs can't
 * know (audit SCR-20). Pure; unknown-in, unknown-out — the caller still runs the
 * Zod schema + plausibility gate on the result. Non-array values (single-object
 * specs, null) pass through untouched.
 */
export function normalizeReplayOutput(kind: ExtractorKind, raw: unknown): unknown {
  if (!Array.isArray(raw)) return raw;
  if (kind === "pricing") return { plans: raw.map(normalizePricingRow) };
  if (kind === "jobs") return { jobs: raw.map(normalizeJobRow) };
  return raw;
}

/** Resolve a replayed pricing row's raw `currency` value to the 3-letter code
 *  `PricingPlanSchema` requires (non-nullable). A bare symbol maps through
 *  `CURRENCY_BY_SYMBOL`; a 3-letter code is uppercased; anything else (or
 *  missing) defaults to `"USD"` — the plausibility gate downstream still
 *  arbitrates whether the row survives at all. */
export function normalizeCurrency(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") return "USD";
  const trimmed = value.trim();
  const mapped = CURRENCY_BY_SYMBOL[trimmed];
  if (mapped) return mapped;
  if (/^[a-zA-Z]{3}$/.test(trimmed)) return trimmed.toUpperCase();
  return "USD";
}

/** Map a replayed pricing row's raw `billing_period` label (the generated spec
 *  targets a free-text selector, e.g. "/month") to the enum
 *  `PricingPlanSchema.billing_period` requires, defaulting to `"monthly"` when
 *  null/unmatched (same default as `packages/scrapers/src/pricing/harvest.ts`). */
export function normalizeBillingPeriod(
  value: unknown,
): "monthly" | "yearly" | "one_time" | "custom" | "usage" {
  if (typeof value === "string") {
    if (YEARLY_RE.test(value)) return "yearly";
    if (MONTHLY_RE.test(value)) return "monthly";
    if (ONE_TIME_RE.test(value)) return "one_time";
  }
  return "monthly";
}

function normalizePricingRow(row: unknown): Record<string, unknown> {
  const source = (row && typeof row === "object" ? row : {}) as Record<string, unknown>;
  return {
    ...source,
    currency: normalizeCurrency(source.currency),
    billing_period: normalizeBillingPeriod(source.billing_period),
  };
}

function normalizeJobRow(row: unknown): Record<string, unknown> {
  const source = (row && typeof row === "object" ? row : {}) as Record<string, unknown>;
  return {
    ...source,
    department: typeof source.department === "string" && source.department.trim() !== ""
      ? source.department
      : "Other",
    location: source.location ?? null,
  };
}
