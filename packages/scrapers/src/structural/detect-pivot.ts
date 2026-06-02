import { phashFromHex, hammingDistance } from "../lib/phash";

/**
 * Structural-change pre-filter (patch-23) — the cheap, deterministic first stage
 * of pivot/death/acquisition detection. It looks at the last few snapshots of a
 * competitor and decides whether the content has changed *radically and stably*
 * enough to be worth an AI profile-match check.
 *
 * Two guards against false positives:
 *  - a big text + visual change is required (a copy tweak or palette change isn't
 *    a pivot);
 *  - the change must be *consistent* across the two most recent scrapes — an A/B
 *    test or a one-off transient flips back, a real new version stays.
 *
 * PURE (only the local pHash helpers): the worker fetches the snapshot texts from
 * R2 and runs the AI verification separately (scrapers can't import @outrival/ai).
 */

const MIN_SCRAPES = Number(process.env.PIVOT_DETECTION_MIN_SCRAPES ?? 3);
const TEXT_THRESHOLD = Number(process.env.PIVOT_DETECTION_TEXT_DIFF_THRESHOLD ?? 0.8);
const PHASH_THRESHOLD = Number(process.env.PIVOT_DETECTION_PHASH_DISTANCE ?? 20);
// The two newest scrapes must be this similar for the change to count as a stable
// new version rather than an A/B test / transient.
const CONSISTENCY_MAX = 0.3;

export interface SnapshotPoint {
  /** Extracted visible text of the snapshot. */
  text: string;
  /** Stored screenshot perceptual hash (hex), or null when none was captured. */
  phashHex: string | null;
}

export interface StructuralSignal {
  textDiffRatio: number;
  /** Hamming distance of the screenshots, or null when a hash was missing. */
  phashDistance: number | null;
  consistent: boolean;
}

/**
 * Decide whether the recent snapshots (newest first, at least MIN_SCRAPES of
 * them) carry a structural-change signal. Returns null when there isn't enough
 * data or the change isn't big-and-stable enough.
 */
export function detectStructuralSignal(recent: SnapshotPoint[]): StructuralSignal | null {
  if (recent.length < MIN_SCRAPES) return null;

  const latest = recent[0];
  const previous = recent[1];
  const older = recent[recent.length - 1];
  if (!latest || !previous || !older) return null;

  const textDiffRatio = textDifference(older.text, latest.text);
  const phashDistance = phashDistanceOf(older.phashHex, latest.phashHex);

  const textSignal = textDiffRatio > TEXT_THRESHOLD;
  // pHash is optional: require a visual change when both hashes exist, but don't
  // block detection on a missing screenshot (text-only is still meaningful).
  const visualSignal = phashDistance === null ? true : phashDistance > PHASH_THRESHOLD;
  if (!textSignal || !visualSignal) return null;

  const consistent = textDifference(previous.text, latest.text) < CONSISTENCY_MAX;
  if (!consistent) return null;

  return { textDiffRatio, phashDistance, consistent };
}

/**
 * Fraction of distinct words that differ between two texts (Jaccard distance):
 * 0 = identical word set, 1 = no words in common. Robust to reordering/redesign
 * (same copy → low) and spikes to ~1 on a genuine pivot (all-new content).
 */
export function textDifference(a: string, b: string): number {
  const setA = wordSet(a);
  const setB = wordSet(b);
  if (setA.size === 0 && setB.size === 0) return 0;
  let intersection = 0;
  for (const w of setA) if (setB.has(w)) intersection++;
  const union = setA.size + setB.size - intersection;
  if (union === 0) return 0;
  return 1 - intersection / union;
}

function wordSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .filter((w) => w.length > 2),
  );
}

function phashDistanceOf(a: string | null, b: string | null): number | null {
  const ha = phashFromHex(a);
  const hb = phashFromHex(b);
  if (ha === null || hb === null) return null;
  return hammingDistance(ha, hb);
}
