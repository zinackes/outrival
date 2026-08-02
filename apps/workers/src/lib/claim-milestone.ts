/**
 * Whether a quantified homepage claim just crossed a round number.
 *
 * "10,000+ customers" becoming "12,000+ customers" and becoming "15,000+
 * customers" are the same kind of drift. Crossing 10,000 is the one a company
 * writes a press release about, and it is the one a reader wants pulled out of a
 * homepage diff — so the crossing is marked on the change, and the fact block
 * reads the mark rather than re-deriving it from numbers that have since moved.
 *
 * PURE. Percentages are excluded: a "99.9% uptime" claim passing 1,000 is not a
 * thing that can happen, and "satisfaction crossed 100" would be a parse bug
 * announcing itself as news.
 */

/** The round numbers a count-shaped claim is read against. */
const MILESTONES = [1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9];

export function crossesRoundMilestone(
  previous: number,
  current: number,
  unit: string | null,
): number | null {
  if (unit === "%") return null;
  if (!Number.isFinite(previous) || !Number.isFinite(current)) return null;
  const low = Math.min(previous, current);
  const high = Math.max(previous, current);
  // Strictly above the low bound and at-or-below the high one, so a claim that
  // lands exactly ON the round number counts as having reached it, and a claim
  // sitting there already does not re-announce it on the next capture.
  const crossed = MILESTONES.filter((m) => m > low && m <= high);
  return crossed.length > 0 ? (crossed[crossed.length - 1] as number) : null;
}
