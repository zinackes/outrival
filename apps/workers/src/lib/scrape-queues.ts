import { queue } from "@trigger.dev/sdk/v3";

// Two-lane scraping queues (optimization-audit-2026-06, scalability finding).
//
// `scrape-monitor` ran on a single global FIFO queue at concurrency 5. Each run is
// an isolated Trigger machine, so this never loaded our own servers — but a single
// lane means one org's slow, expensive scrapes (L3 residential / L4 Camoufox, which
// can take 60-90s behind anti-bot) fill the 5 slots and starve every other org's
// cheap fast scrapes behind them (head-of-line blocking).
//
// We split into two BOUNDED lanes instead. Cheap scrapes (L0 fetch / L1 Patchright
// / L2 datacenter — the common case) stay on the fast lane; monitors that have
// LEARNED they need a slow paid level (requiresLevel >= SLOW_LANE_MIN_LEVEL) are
// routed to a small isolated lane at enqueue time. The expensive scrapes can no
// longer monopolise the fast lane. Total concurrency stays explicit and bounded
// (FAST + SLOW), with no per-key multiplication — unlike `concurrencyKey`, which
// creates one full-limit queue per key value and would blow up the proxy burst.
//
// Both env-tunable so concurrency can be scaled with the Trigger plan + proxy
// budget without a code change. Defaults preserve the previous fast-lane cap (5).

export const FAST_LANE_CONCURRENCY = Number(process.env.SCRAPE_CONCURRENCY ?? 5);
export const SLOW_LANE_CONCURRENCY = Number(process.env.SCRAPE_SLOW_CONCURRENCY ?? 2);

// A monitor whose learned cascade level is >= this is routed to the slow lane.
// 3 = residential (pay-per-GB), 4 = Camoufox — the variable-cost + slow levels.
// L2 (datacenter) is flat-cost and fast enough to stay in the fast lane.
export const SLOW_LANE_MIN_LEVEL = 3;

export const SCRAPE_SLOW_QUEUE_NAME = "scrape-monitor-slow";

// Explicit annotation: the inferred `queue()` return type can't be named across
// the module boundary once exported (TS2742). `ReturnType<typeof queue>` keeps the
// reference local and portable.
type ScrapeQueue = ReturnType<typeof queue>;

export const scrapeMonitorQueue: ScrapeQueue = queue({
  name: "scrape-monitor",
  concurrencyLimit: FAST_LANE_CONCURRENCY,
});

export const scrapeMonitorSlowQueue: ScrapeQueue = queue({
  name: SCRAPE_SLOW_QUEUE_NAME,
  concurrencyLimit: SLOW_LANE_CONCURRENCY,
});
