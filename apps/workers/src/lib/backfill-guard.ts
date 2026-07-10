import { checkAntiVoid } from "@outrival/scrapers/anti-void";

// ÉTAPE 3 (2026-07 audit) — anti-void parity for the archive backfill path.
//
// backfill-history already skips an archived DENY/challenge page (detectDenyPage +
// isCloudflareChallenge), but not an archive that came back near-empty for another
// reason (a Wayback redirect stub, a partial reconstruction). Seeded as a `success`
// archive snapshot it becomes a diff baseline of essentially "", so the archive→now
// diff fabricates a phantom "whole page added" change.
//
// The backfill path has no prior sizes (it's the first archive), so we use the fresh
// LIVE capture as the reference and reuse the tested absolute-emptiness fallback of
// checkAntiVoid: an absolutely-tiny archive against a substantive current page is a
// broken capture. A page that legitimately grew still carries real content (its
// extracted size clears the absolute ceiling), so genuine backfill value is kept.
export function isArchiveCaptureVoid(archiveSize: number, currentSize: number): boolean {
  return checkAntiVoid(archiveSize, [currentSize]).isVoid;
}

// Per-offset skip tally for one backfill run — feeds the outcome bucket below and
// the `detail` string, so a miss is root-causable ("Wayback had nothing" vs "every
// capture was a challenge page") instead of a silent exit.
export interface BackfillSkips {
  noCapture: number;
  tooRecent: number;
  challengeOrDeny: number;
  voidCapture: number;
  /** Reason evaluateSignificance gave for judging the lookback diff trivial. */
  trivialReason?: string;
  /** True when the lookback diff produced no textual change at all. */
  noDiff?: boolean;
}

export interface BackfillOutcome {
  outcome: "change_triggered" | "no_significant_change" | "no_archive_capture";
  detail: string | null;
}

/**
 * Map a finished backfill loop to its SLO miss bucket
 * (docs/slos/onboarding-first-signal.md — "root-cause every miss"):
 *   change_triggered      → the day-0 signal chain started (the success path)
 *   no_significant_change → archives were seeded but the past looks like the
 *                           present (no diff / trivial diff) — a coverage miss
 *   no_archive_capture    → nothing usable came out of Wayback; detail says why
 */
export function resolveBackfillOutcome(
  seeded: number,
  changeTriggered: boolean,
  skips: BackfillSkips,
): BackfillOutcome {
  if (changeTriggered) return { outcome: "change_triggered", detail: null };
  if (seeded === 0) {
    return {
      outcome: "no_archive_capture",
      detail:
        `no_capture=${skips.noCapture} too_recent=${skips.tooRecent} ` +
        `challenge_or_deny=${skips.challengeOrDeny} void=${skips.voidCapture}`,
    };
  }
  return {
    outcome: "no_significant_change",
    detail: skips.trivialReason ?? (skips.noDiff ? "no_diff" : "lookback_capture_unusable"),
  };
}
