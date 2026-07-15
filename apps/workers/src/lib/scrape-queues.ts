import { queue } from "@trigger.dev/sdk/v3";

// Single bounded scraping lane.
//
// `scrape-monitor` runs on one global FIFO queue. Each run is an isolated Trigger
// machine, so this never loads our own servers — the cap just bounds proxy burst
// and Trigger cost. The collection doctrine caps the cascade at L2 (datacenter
// egress, flat-cost and fast), so there is no slow, variable-cost paid level left
// to isolate: the previous two-lane split (fast vs learned-slow L3/L4) was retired
// with the former upper tiers (IP-reputation proxy + anti-fingerprint browser).
//
// Env-tunable so concurrency can be scaled with the Trigger plan + proxy budget
// without a code change. Default preserves the previous fast-lane cap (5).

export const FAST_LANE_CONCURRENCY = Number(process.env.SCRAPE_CONCURRENCY ?? 5);

// Explicit annotation: the inferred `queue()` return type can't be named across
// the module boundary once exported (TS2742). `ReturnType<typeof queue>` keeps the
// reference local and portable.
type ScrapeQueue = ReturnType<typeof queue>;

export const scrapeMonitorQueue: ScrapeQueue = queue({
  name: "scrape-monitor",
  concurrencyLimit: FAST_LANE_CONCURRENCY,
});
