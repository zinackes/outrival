// First-signal SLO (docs/slos/onboarding-first-signal.md): SLI = share of
// onboarding completions whose org saw its first signal within 10 minutes —
// the landing's "<10 min" promise, measured. The thresholds live HERE as the
// single source shared by the ops alert (workers, evaluateFirstSignalAlerts)
// and the /admin readout (api, summarizeFirstSignalSlo) so the two can never
// silently disagree.

export const FIRST_SIGNAL_SLO_TARGET = 0.7; // 70% over 28d — ratchet in the SLO doc
export const FIRST_SIGNAL_WEEK_DEGRADED_BELOW = 0.5;
export const FIRST_SIGNAL_WEEK_MIN_SAMPLE = 5;
export const FIRST_SIGNAL_WINDOW_MIN_SAMPLE = 10;
export const FIRST_SIGNAL_CONSECUTIVE_MISSES = 3;

export interface ComplianceWindow {
  completions: number;
  within: number;
}

export interface FirstSignalSloInputs {
  /** Hit/miss of the most recent completions whose 10-min window has elapsed, newest first. */
  recent: boolean[];
  week: ComplianceWindow; // trailing 7d
  window: ComplianceWindow; // trailing 28d (the SLO window)
  /** Companion coverage metric (≤ 24h), logged but never alerted on yet. */
  coverage24h: ComplianceWindow;
}

export interface ComplianceReadout {
  completions: number;
  within: number;
  /** null when there are no completions yet — never a fake 0%. */
  pct: number | null;
}

export type FirstSignalSloStatus =
  | "healthy"
  | "degrading"
  | "budget_exhausted"
  | "insufficient_data";

export interface FirstSignalSloSummary {
  target: number;
  week: ComplianceReadout;
  window: ComplianceReadout;
  coverage24h: ComplianceReadout;
  status: FirstSignalSloStatus;
  /** The last N onboardings all missed — the "page" condition, surfaced for a badge. */
  recentAllMiss: boolean;
}

function readout(w: ComplianceWindow): ComplianceReadout {
  return {
    completions: w.completions,
    within: w.within,
    pct: w.completions > 0 ? w.within / w.completions : null,
  };
}

/**
 * Pure classification for the /admin readout, using the SAME thresholds and
 * min-sample guards as the ops alert. Status escalates worst-first:
 *   budget_exhausted  — 28d window has a real sample (≥10) and is below target
 *   degrading         — 7d window has a real sample (≥5) and is below the 50% floor
 *   insufficient_data — neither window has met its minimum sample yet
 *   healthy           — a real sample that meets target
 * A tiny sample below target must NEVER read as a breach (1-3 onboardings/day).
 */
export function summarizeFirstSignalSlo(i: FirstSignalSloInputs): FirstSignalSloSummary {
  const window = readout(i.window);
  const week = readout(i.week);
  const windowSampled = i.window.completions >= FIRST_SIGNAL_WINDOW_MIN_SAMPLE;
  const weekSampled = i.week.completions >= FIRST_SIGNAL_WEEK_MIN_SAMPLE;

  let status: FirstSignalSloStatus;
  if (windowSampled && (window.pct ?? 1) < FIRST_SIGNAL_SLO_TARGET) {
    status = "budget_exhausted";
  } else if (weekSampled && (week.pct ?? 1) < FIRST_SIGNAL_WEEK_DEGRADED_BELOW) {
    status = "degrading";
  } else if (!windowSampled && !weekSampled) {
    status = "insufficient_data";
  } else {
    status = "healthy";
  }

  const recentAllMiss =
    i.recent.length >= FIRST_SIGNAL_CONSECUTIVE_MISSES &&
    i.recent.slice(0, FIRST_SIGNAL_CONSECUTIVE_MISSES).every((hit) => !hit);

  return {
    target: FIRST_SIGNAL_SLO_TARGET,
    week,
    window,
    coverage24h: readout(i.coverage24h),
    status,
    recentAllMiss,
  };
}
