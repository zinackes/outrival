// Auto re-arm of monitors paused as unscrapable (C2).
//
// scrape-monitor.job.ts onFailure sets both markedUnscrapable:true AND
// isActive:false after 3 consecutive failures. The scheduler only enqueues
// isActive monitors, so without this a source that was merely down for ~2 days
// (3 failures across the 6h/12h/24h backoff) would be paused forever — no path
// ever flips it back. This gives a paused-unscrapable monitor exactly one probe
// per interval: the next scrape either succeeds (the success path clears
// markedUnscrapable + consecutiveFailures) or fails again and re-pauses it.

import { hasNoScraper, type SourceType } from "@outrival/shared";

const DAY_MS = 86_400_000;

export const REARM_INTERVAL_DAYS = Number(process.env.UNSCRAPABLE_REARM_DAYS ?? 7);

export interface RearmCandidate {
  id: string;
  isActive: boolean;
  markedUnscrapable: boolean;
  lastFailedAt: Date | null;
  sourceType: SourceType;
}

/**
 * Ids of paused-unscrapable monitors whose last failure is older than the
 * interval — the set to flip back to isActive so the scheduler re-probes them.
 * Pure so the threshold semantics are unit-tested; the scheduler feeds it the
 * (small) set of `isActive=false AND markedUnscrapable=true` monitors.
 */
export function rearmableMonitorIds(
  candidates: RearmCandidate[],
  now: Date,
  intervalDays: number = REARM_INTERVAL_DAYS,
): string[] {
  const cutoff = now.getTime() - intervalDays * DAY_MS;
  return candidates
    .filter(
      (m) =>
        m.markedUnscrapable &&
        !m.isActive &&
        // A monitor on a retired source has nothing to be re-probed BY: the scraper
        // registry has no binding, so it fails `No scraper for source type: …` the
        // instant it wakes and pauses again. Re-arming it every 7 days is a loop with
        // no exit (prod: two trustpilot_reviews monitors at 5 and 6 consecutive
        // failures on a source retired in July).
        !hasNoScraper(m.sourceType) &&
        m.lastFailedAt != null &&
        m.lastFailedAt.getTime() <= cutoff,
    )
    .map((m) => m.id);
}
