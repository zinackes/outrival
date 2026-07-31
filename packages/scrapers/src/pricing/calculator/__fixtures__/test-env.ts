/**
 * Env for the live-browser probe test, in its own module so it lands BEFORE the
 * modules that read it.
 *
 * ES imports are evaluated before the importing module's body, so setting these
 * inside probe.test.ts would run AFTER lib/rate-limit.ts had already captured the
 * crawl gap at module load: every probe of a local fixture would pay the 2s
 * courtesy delay meant for real domains, and the file's runtime would triple for
 * nothing (which is how it started timing out under a parallel monorepo run).
 */
process.env.SCRAPE_MIN_DOMAIN_GAP_MS = "0";
process.env.PRICING_PROBE_PACE_MIN_MS = "0";
process.env.PRICING_PROBE_PACE_MAX_MS = "10";
process.env.PRICING_PROBE_SETTLE_POLL_MS = "60";
// Above the fixtures' own 120ms debounce: the floor is what stops a fast poller
// from reading the previous answer twice and calling it settled.
process.env.PRICING_PROBE_SETTLE_MIN_MS = "300";
process.env.PRICING_PROBE_SETTLE_MAX_MS = "4000";
