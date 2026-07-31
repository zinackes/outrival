/**
 * Hiring-footprint detectors (Hiring Intelligence v2 P2): where a competitor hires,
 * what they open, and when they stop.
 *
 * Pure and deterministic — no AI, no I/O. The caller resolves locations (with
 * `@outrival/shared/geo`, offline) and reads the history; everything decided here
 * is decided from counts.
 *
 * All three signals are HIGH severity, and all three are "first time ever" or
 * "it stopped" claims, which are exactly the claims a thin history invents. So each
 * carries a BASELINE requirement: without enough weeks behind it, a first
 * observation is a property of when we started looking, not of the competitor. A
 * competitor onboarded on Monday must not spend Tuesday announcing that it has
 * opened its first office in six countries.
 */

import type { DepartmentBucket } from "./departments";

/**
 * Rows read back out of hiring_geo / hiring_metrics: one key, one ISO week. The
 * caller passes the competitor's history EXCLUDING the week being judged — the
 * current week is already written by the time the detectors run, and a week that
 * counts as its own history makes every country a country we have always known.
 */
export interface WeeklyKeyRow {
  key: string;
  weekStart: string;
}

/** Distinct ISO weeks present in a history slice. */
function weeksCovered(history: ReadonlyArray<WeeklyKeyRow>): number {
  return new Set(history.map((r) => r.weekStart)).size;
}

/**
 * Keys present now that appear NOWHERE in the history. `minWeeks` is the baseline:
 * below it the answer is always empty, because "never seen before" and "never
 * looked before" are indistinguishable.
 */
export function detectFirstAppearances(
  current: ReadonlyArray<string>,
  history: ReadonlyArray<WeeklyKeyRow>,
  minWeeks: number,
): string[] {
  if (weeksCovered(history) < minWeeks) return [];
  const seen = new Set(history.map((r) => r.key));
  return [...new Set(current)].filter((k) => !seen.has(k)).sort();
}

/** Weeks of prior hiring_geo history before a first-country claim is allowed. */
export const FIRST_COUNTRY_MIN_WEEKS = 2;
/** Weeks of prior hiring_metrics history before a first-department claim is allowed. */
export const NEW_DEPARTMENT_MIN_WEEKS = 3;

export interface FreezeThresholds {
  /** Share of the roles open at the window's start that must have closed. */
  closedRatio: number;
  /** Below this many roles open at the start, an emptied board is not news. */
  minOpenAtStart: number;
  /** More openings than this and they are still hiring, whatever else closed. */
  maxOpened: number;
}

export const FREEZE_DEFAULTS: FreezeThresholds = {
  closedRatio: 0.6,
  minOpenAtStart: 5,
  maxOpened: 1,
};

export interface FreezeWindow {
  /** Roles open at the start of the window. */
  openAtStart: number;
  /** Roles closed inside the window. */
  closedInWindow: number;
  /** Roles opened inside the window. */
  openedInWindow: number;
  /**
   * True when an authoritative run LATER than the last closure has run and left
   * those closures standing. This is the guard against the failure mode that would
   * otherwise dominate: an ATS answering 200 with a short list closes most of a
   * board in one run, which is the exact shape of a freeze. A real freeze survives
   * the next scrape; a glitch re-opens everything and takes `openedInWindow` with
   * it. Costs one scrape cycle of latency and buys the whole false-positive class.
   */
  confirmedByLaterRun: boolean;
  /**
   * False when the board moved inside the window (a new URL, a different ATS). The
   * postings of the old board all "close" on the switch, which looks identical to a
   * freeze and is the opposite of one.
   */
  boardStable: boolean;
}

export interface FreezeVerdict {
  openAtStart: number;
  closed: number;
  opened: number;
  /** closed / openAtStart, for the diff text. */
  closedShare: number;
}

/**
 * A board that emptied out and did not refill. Returns null — silently, no partial
 * verdicts — the moment any condition fails: this is the one signal in the set that
 * says a competitor is in trouble, and it is worth far less than nothing if it also
 * fires when their ATS hiccups.
 */
export function detectHiringFreeze(
  window: FreezeWindow,
  thresholds: FreezeThresholds = FREEZE_DEFAULTS,
): FreezeVerdict | null {
  if (!window.boardStable) return null;
  if (!window.confirmedByLaterRun) return null;
  if (window.openAtStart < thresholds.minOpenAtStart) return null;
  if (window.openedInWindow > thresholds.maxOpened) return null;
  if (window.closedInWindow < thresholds.closedRatio * window.openAtStart) return null;
  return {
    openAtStart: window.openAtStart,
    closed: window.closedInWindow,
    opened: window.openedInWindow,
    closedShare: window.closedInWindow / window.openAtStart,
  };
}

/** A posting as the geo aggregate sees it. */
export interface GeoTallyInput {
  countryCodes: string[] | null;
  geoResolution: string | null;
}

/**
 * Count open roles per hiring_geo key: one entry per ISO country code, plus the
 * reserved "remote" / "region" / "unresolved" keys for the postings that named no
 * country. A posting naming two countries counts in BOTH — the question the table
 * answers is "do they hire in X", not how the headcount divides — so the counts are
 * deliberately not a partition and must never be summed into a total.
 *
 * A posting with no resolution recorded at all (predates P2, never backfilled) is
 * counted as unresolved rather than dropped: a board half-missing from its own
 * footprint chart would read as a shrinking footprint.
 */
export function tallyHiringGeo(postings: ReadonlyArray<GeoTallyInput>): Map<string, number> {
  const counts = new Map<string, number>();
  const bump = (key: string) => counts.set(key, (counts.get(key) ?? 0) + 1);
  for (const p of postings) {
    const codes = p.countryCodes ?? [];
    if (p.geoResolution === "country" && codes.length > 0) {
      for (const cc of codes) bump(cc);
      continue;
    }
    if (p.geoResolution === "region") bump("region");
    else if (p.geoResolution === "remote") bump("remote");
    else bump("unresolved");
  }
  return counts;
}

/** Buckets with at least one open role, `unknown` excluded (a data-quality bucket). */
export function namedBuckets(counts: Map<DepartmentBucket, number>): string[] {
  return [...counts]
    .filter(([bucket, n]) => bucket !== "unknown" && n > 0)
    .map(([bucket]) => bucket)
    .sort();
}
