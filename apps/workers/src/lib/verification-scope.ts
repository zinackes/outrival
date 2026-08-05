/**
 * Who gets double-captured before their signal exists (Véracité Intelligence v2 P2).
 *
 * Pure decision, no DB, no clock: the perimeter is a policy and has to be readable
 * as one. Everything it needs is already known at the emission boundary.
 *
 * The trade being made: a critical signal pages the customer within minutes, and the
 * cost of paging someone for a delta that was never really there is far higher than
 * the cost of that page arriving half an hour later. Below critical the trade
 * inverts, so nothing below it is ever delayed.
 */

/**
 * Sources whose HIGH severity is worth the same treatment as a critical. Not "the
 * sources that matter" but the sources that MOVE: a pricing page and a homepage are
 * where A/B tests, staged rollouts and geo variants live, and the market runs 5-6
 * pricing tests a year at 2-4 weeks apiece. Any single fetch of one of those has a
 * real chance of reading a bucket rather than a decision. A changelog or a jobs board
 * has no bucket to land in.
 */
export const VOLATILE_SOURCES: ReadonlySet<string> = new Set(["pricing", "homepage"]);

/** Minutes before the quick check. Short on purpose: its whole job is to kill the
 *  transient (a half-rendered page, an error page served for a few seconds), which
 *  is gone almost immediately or not at all. */
export const QUICK_CHECK_DELAY_MIN = Number(process.env.QUICK_CHECK_DELAY_MIN ?? 2);

/**
 * Minutes before the INDEPENDENT capture, counted from detection. This delay IS the
 * independence: a re-fetch a second later reads the same CDN object (TTLs are in
 * minutes), lands in the same A/B bucket (bucketing is usually per IP), and sees the
 * same half-finished deploy. Thirty minutes is the first point where all three have
 * plausibly turned over. To be retuned downward on real signal_verifications data.
 */
export const VERIFY_DELAY_MIN = Number(process.env.VERIFY_DELAY_MIN ?? 30);

/** Days a not_reproduced delta stays in the flap window. Two weeks covers the short
 *  end of a typical pricing test (2-4 weeks), so a test is caught while it runs. */
export const FLAP_WINDOW_DAYS = 14;

/** not_reproduced observations of one delta (or its inverse) before the page is
 *  called a test rather than a fluke. One is noise; two is a pattern. */
export const AB_TEST_MIN_OBSERVATIONS = 2;

/** Days before the same page may raise ab_test_suspected again. A test runs for
 *  weeks and flaps continuously inside it; telling the customer once is the finding,
 *  telling them every flip is the noise the whole phase exists to remove. */
export const AB_TEST_COOLDOWN_DAYS = 30;

/** Kill-switch. Off means every signal emits immediately, exactly as before P2. */
export const VERIFICATION_ENABLED = process.env.SIGNAL_VERIFICATION_ENABLED !== "false";

/** Capture methods a verification can actually redo. `feed` and `api` are captures of
 *  something that is not a page (an RSS document, a runtime endpoint), and a null is a
 *  synthetic anchor or a pre-P1 row: none of them has a page to re-fetch. */
const REPLAYABLE_METHODS: ReadonlySet<string> = new Set(["static", "rendered"]);

export type VerificationSeverity = "low" | "medium" | "high" | "critical";

export interface LiveCaptureInput {
  /** snapshots.status of the change's AFTER side. */
  snapshotStatus: string | null;
  /** snapshots.capture_method of the same row. */
  captureMethod: string | null;
  /** Whether a URL to re-fetch exists at all. */
  hasUrl: boolean;
}

export interface EmissionScopeInput extends LiveCaptureInput {
  severity: VerificationSeverity;
  sourceType: string;
  /** True when this exact delta, or its inverse, already failed to reproduce on this
   * page inside the flap window. Overrides the severity test only. */
  flapMatch: boolean;
  /** True when the change carries excerpts distinctive enough to be looked for again. */
  hasEvidence: boolean;
}

export interface EmissionScopeResult {
  verify: boolean;
  /** Why, for the log line and the tests. Never null: a decision with no reason is
   * the thing that makes this kind of gate impossible to debug in production. */
  reason:
    | "not_replayable"
    | "partial_capture"
    | "no_url"
    | "no_evidence"
    | "out_of_scope"
    | "critical"
    | "volatile_high"
    | "flap";
}

/**
 * Is the change anchored on a live page capture we could go and take again?
 *
 * A `partial` capture is excluded for the same reason P1 keeps it out of the baseline:
 * it is a capture we already know is degraded, so a second one proves nothing about
 * the first. Signals derived from aggregated data (hiring_shift, review_shift,
 * salary_band_shift, ai_visibility_shift) and every synthetic anchor fall out here by
 * construction: their snapshot has no capture_method because no page was fetched.
 * They are EXEMPT by nature, not by an exception list that would have to be kept.
 */
export function isLivePageCapture(input: LiveCaptureInput): EmissionScopeResult["reason"] | null {
  if (!REPLAYABLE_METHODS.has(input.captureMethod ?? "")) return "not_replayable";
  if (input.snapshotStatus !== "success") return "partial_capture";
  if (!input.hasUrl) return "no_url";
  return null;
}

/** Critical on any source, high on a volatile one. */
export function severityInScope(severity: VerificationSeverity, sourceType: string): boolean {
  if (severity === "critical") return true;
  return severity === "high" && VOLATILE_SOURCES.has(sourceType);
}

/**
 * The whole perimeter, in one call.
 *
 * The live-capture test comes FIRST and is never bypassed, including by the flap
 * override: a page we cannot re-fetch cannot be verified whatever it did last week,
 * and routing it into verification would strand its signal forever.
 */
export function shouldVerifyEmission(input: EmissionScopeInput): EmissionScopeResult {
  const notLive = isLivePageCapture(input);
  if (notLive) return { verify: false, reason: notLive };
  if (!input.hasEvidence) return { verify: false, reason: "no_evidence" };
  if (input.flapMatch) return { verify: true, reason: "flap" };
  if (!severityInScope(input.severity, input.sourceType)) {
    return { verify: false, reason: "out_of_scope" };
  }
  return { verify: true, reason: input.severity === "critical" ? "critical" : "volatile_high" };
}

/** Minutes between the quick check and the independent capture. The second pass is
 *  scheduled off the first one finishing, so it waits out the remainder. */
export function independentPassDelayMin(): number {
  return Math.max(VERIFY_DELAY_MIN - QUICK_CHECK_DELAY_MIN, 1);
}
