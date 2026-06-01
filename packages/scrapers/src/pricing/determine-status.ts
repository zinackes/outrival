import type { PricingStatus } from "@outrival/shared";
import type { PricingSignals } from "./signals";

export interface StatusDecision {
  status: PricingStatus;
  reasoning: string; // kept for debug logs and findings.md
}

/**
 * Map detected signals to one of the 6 statuses. Order matters: a signup wall
 * and a calculator are stronger evidence than raw price/gated tokens, so they
 * win even when prices happen to leak through.
 */
export function determineStatus(signals: PricingSignals): StatusDecision {
  // 1. Signup wall takes priority — even if a teaser number is visible.
  if (signals.hasSignupWall && !signals.hasPriceTokens) {
    return { status: "gated_signup", reasoning: "Signup wall + no public prices" };
  }

  // 2. Calculator detected — may coexist with "starting at €X", still dynamic.
  if (signals.hasCalculator) {
    return { status: "dynamic", reasoning: "Calculator inputs detected" };
  }

  // 3. Prices + gated keywords → some tiers public, others sales-gated.
  if (signals.hasPriceTokens && signals.hasGatedKeywords) {
    return {
      status: "public_partial",
      reasoning: "Some tiers public, others gated (sales contact)",
    };
  }

  // 4. Prices only.
  if (signals.hasPriceTokens && !signals.hasGatedKeywords) {
    return { status: "public", reasoning: "Public pricing fully visible" };
  }

  // 5. Gated only.
  if (!signals.hasPriceTokens && signals.hasGatedKeywords) {
    return { status: "gated_demo", reasoning: "No prices, sales contact required" };
  }

  // 6. Nothing detected.
  return {
    status: "unknown",
    reasoning: "No price tokens, no gated keywords, no calculator",
  };
}
