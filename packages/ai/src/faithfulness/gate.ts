import type { ClaimVerdict, FaithfulnessReport } from "./types";

// The publication gate, as pure predicates — so its two safety properties are
// tested invariants rather than something you have to re-read three jobs to
// confirm: it blocks on an unfaithful claim, and it NEVER blocks on a skipped
// (infrastructure-failed) verification.

const DEFAULT_MIN_RATIO = 0.9;

/** Minimum supported/total ratio a publishable output must reach. */
export function faithfulnessMinRatio(): number {
  const raw = Number(process.env.FAITHFULNESS_MIN_RATIO);
  return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : DEFAULT_MIN_RATIO;
}

/** Kill-switch. `false` → verification never runs and nothing is ever blocked. */
export function faithfulnessGateEnabled(): boolean {
  return process.env.FAITHFULNESS_GATE_ENABLED !== "false";
}

export interface GateDecision {
  blocked: boolean;
  reason: string | null;
}

/**
 * Blocked when the verified ratio falls under the threshold OR any claim was
 * ruled unfaithful. A `skipped` report (extraction/judge unavailable) never
 * blocks: an AI outage must not silence every battle card, digest and alert.
 *
 * With today's counting rules an unverifiable claim is counted as supported, so
 * the ratio only falls through unfaithful claims — the two conditions agree by
 * construction. The ratio stays the explicit, stored, auditable number.
 */
export function decideGate(
  report: Pick<FaithfulnessReport, "verdict" | "ratio" | "unfaithfulClaims">,
  minRatio: number = faithfulnessMinRatio(),
): GateDecision {
  if (report.verdict === "skipped") return { blocked: false, reason: null };

  const unfaithful = report.unfaithfulClaims;
  if (unfaithful.length > 0) {
    return {
      blocked: true,
      reason: `${unfaithful.length} claim${unfaithful.length > 1 ? "s" : ""} not supported by the source: ${summarise(unfaithful)}`,
    };
  }
  if (report.ratio < minRatio) {
    return {
      blocked: true,
      reason: `faithfulness ratio ${report.ratio.toFixed(2)} below ${minRatio}`,
    };
  }
  return { blocked: false, reason: null };
}

function summarise(claims: ClaimVerdict[]): string {
  return claims
    .slice(0, 3)
    .map((c) => `"${c.claim.text.slice(0, 120)}"`)
    .join("; ");
}
