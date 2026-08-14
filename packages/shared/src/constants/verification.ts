// How the double capture is phrased, everywhere it is phrased (Véracité
// Intelligence v2 P4). The badge makes the same claim in the signal dialog, the
// feed, the weekly digest and a Slack alert, and the only number in it is the
// interval between the two captures — one function so the four surfaces can't
// round it differently, or drift apart the day one of them is edited.

/** The `signal_verifications.outcome` value that is a claim worth showing a reader. */
export const VERIFIED_OUTCOME = "confirmed";

/**
 * "47 min", "3 h" — the measurement behind "verified twice".
 *
 * Returns null under a minute, which covers both "the two check timestamps aren't
 * both recorded" and a clock that ran backwards; the badge then states the claim
 * without a number rather than printing "0 min apart". The independent capture is
 * scheduled after the quick one, so a sub-minute gap is a broken measurement, not a
 * fast one.
 */
export function verificationGapLabel(
  gapMinutes: number | null | undefined,
): string | null {
  if (gapMinutes == null || !Number.isFinite(gapMinutes) || gapMinutes < 1) return null;
  // Under an hour and a half the minutes ARE the point — "47 min apart" is a
  // measurement a reader can weigh. Past that they stop being readable at a glance.
  if (gapMinutes < 90) return `${Math.round(gapMinutes)} min`;
  return `${Math.round(gapMinutes / 60)} h`;
}

/**
 * Minutes between the quick check and the independent one, from the two raw
 * timestamps. Null unless both are present.
 */
export function verificationGapMinutes(
  quickCheckAt: string | Date | null | undefined,
  independentCheckAt: string | Date | null | undefined,
): number | null {
  if (!quickCheckAt || !independentCheckAt) return null;
  const a = new Date(quickCheckAt).getTime();
  const b = new Date(independentCheckAt).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 60_000);
}
