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

/**
 * The surfaces the gate can be scoped to. A closed union on purpose: an operator
 * typo in FAITHFULNESS_GATE_TASKS then leaves a surface ungated instead of
 * silently gating a different one.
 */
export type FaithfulnessTask = "battle_card" | "digest" | "signal_insight";

/**
 * OPT-IN, not opt-out. Withholding a customer-facing output is the most
 * consequential thing this code does, and the judge's false-block rate on real
 * prose is a MODEL property — unknown until `eval:faithfulness` has run against a
 * healthy pool. So the gate ships inert: it costs nothing and blocks nothing until
 * someone sets the flag deliberately, on a box where the AI pool is known good.
 * (Same safe-by-default posture as the passkeys flag.)
 *
 * The task argument is REQUIRED: plan 017 measured the judge on 14 cases, which
 * rules out a bad judge without establishing a good one, so the enablement is
 * per-surface — a false block on a weekly digest is one deferred email, a false
 * block on a critical alert is not recoverable by anyone noticing later
 * (`docs/faithfulness-rollout.md` §4). You cannot ask "is the gate on" without
 * saying what for.
 *
 * PRECEDENCE — a non-blank `FAITHFULNESS_GATE_TASKS` wins over
 * `FAITHFULNESS_GATE_ENABLED`, in BOTH directions. The legacy boolean is not an
 * additional kill switch on top of the list: `.env.example` ships it as `false`
 * in every environment, so honouring that `false` would make the new flag
 * unusable without a second, unrelated edit. The kill switch is unsetting the
 * list. A set-but-unrecognised value gates nothing — the safe reading of a typo
 * is "off", never "on everywhere".
 */
export function faithfulnessGateEnabled(task: FaithfulnessTask): boolean {
  const scoped = process.env.FAITHFULNESS_GATE_TASKS?.trim();
  if (scoped) return parseGateTasks(scoped).has(task);
  return process.env.FAITHFULNESS_GATE_ENABLED === "true";
}

function parseGateTasks(raw: string): Set<string> {
  return new Set(
    raw
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean),
  );
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
