// Cold-start funnel milestones (F2, docs/slos/onboarding-first-signal.md): the
// landing's "first signal <10 min / digest same day" promise is measured by the
// first-signal SLO; these helpers add the intermediate `first_scrape` and
// `digest_sample` events so a miss is DIAGNOSABLE per stage (scrape → signal →
// digest), not just pass/fail. Pure — the jobs own the DB read/write.

export interface FunnelSession {
  timings: Record<string, number>;
  startedAt: Date;
}

/**
 * Stamp `key` once into `timings`. Returns the new timings object to persist, or
 * null if the milestone is already set (never overwrite — the first occurrence is
 * the true funnel event).
 */
export function stampOnce(
  timings: Record<string, number>,
  key: string,
  at: number,
): Record<string, number> | null {
  if (timings[key] != null) return null;
  return { ...timings, [key]: at };
}

/**
 * `first_scrape` is stamped from scrape-monitor, which runs for EVERY org forever —
 * so unlike `first_real_signal` (guarded by "org's first signal ever") it must be
 * recency-gated to the onboarding window. Without the gate, the first scrape of a
 * long-onboarded org would back-stamp `first_scrape = now`, poisoning the funnel
 * durations. Returns the new timings to persist, or null.
 */
export function stampFirstScrape(
  session: FunnelSession,
  now: number,
  recencyMs: number,
): Record<string, number> | null {
  if (now - session.startedAt.getTime() > recencyMs) return null;
  return stampOnce(session.timings, "first_scrape", now);
}
