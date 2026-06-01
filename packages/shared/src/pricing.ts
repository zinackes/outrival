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
