import {
  MONITOR_FREQUENCIES,
  SOURCE_TYPES,
  frequencyWithin,
  type MonitorFrequency,
  type SourceType,
} from "../constants/sources";
import { planIncludesFeature, planIncludesFrequency, type Plan } from "../constants/plans";

/**
 * Where every source_type lives in the product surface. The buckets below are a
 * PARTITION of SOURCE_TYPES — exhaustive and disjoint, asserted by catalog.test.ts
 * so adding an enum value fails the suite until it is placed here deliberately.
 *
 * This is the single source of truth for the competitor Sources page: a source is
 * either user-configurable, automatic-and-read-only, or hidden (with a reason).
 */

/** Groups of user-configurable sources, in display order on the Sources page. */
export const SOURCE_GROUPS = [
  "web_content",
  "pricing",
  "hiring",
  "reviews",
  "roadmap",
  "developer",
] as const;
export type SourceGroup = typeof SOURCE_GROUPS[number];

export const SOURCE_GROUP_LABELS: Record<SourceGroup, string> = {
  web_content: "Web & content",
  pricing: "Pricing",
  hiring: "Hiring",
  reviews: "Reviews",
  // Its own group rather than a line under "Web & content": a public roadmap portal
  // is the one surface that states what a competitor has COMMITTED to build, next to
  // how hard their own customers are pushing for it.
  roadmap: "Roadmap & feedback",
  // Not "Social & community": LinkedIn/X/YouTube/Reddit are all out (no scraper,
  // internal, or retired), so what actually remains here is developer + infra surface.
  developer: "Developer & infrastructure",
};

/** Sources the user turns on/off and points at a URL, grouped for the Sources page. */
export const CONFIGURABLE_SOURCES: Record<SourceGroup, readonly SourceType[]> = {
  web_content: ["homepage", "blog", "changelog"],
  pricing: ["pricing"],
  hiring: ["jobs"],
  // Reviews v2 (2026-07-15) + Shopify (2026-08-04): the legally-read review
  // surfaces. The scraped aggregators are RETIRED_SOURCES below; G2 has no
  // connected-vendor flow (its ToS review is still open), so it has no row at all
  // rather than a fake one. `shopify_reviews` covers the e-commerce SaaS whose
  // customers review them as merchants rather than on an aggregator.
  reviews: ["appstore_reviews", "shopify_reviews", "trustpilot_public"],
  // `roadmap` (pro+) reads the competitor's public Canny / ProductBoard portal.
  // Enabled through the standard route; the optional URL override points at the
  // portal itself, which is why `roadmap` gets a brand exception in validateMonitorUrl.
  roadmap: ["roadmap"],
  // `docs` (pro+) reads the competitor's own developer documentation — an OpenAPI
  // spec when they publish one, else their docs sitemap. Enabled through the standard
  // route with an optional URL override.
  developer: ["github_repo", "status", "docs"],
};

/**
 * User-selectable, but through its OWN flow ("Watch a custom page"): several per
 * competitor, quota'd by PLAN_LIMITS.customMonitorsPerCompetitor, and rejected by
 * the standard enable route. Its own group on the Sources page.
 */
export const CUSTOM_SOURCES: readonly SourceType[] = ["custom"];

/**
 * The PRODUCT view of the same catalog — the sources a product's own
 * self-competitor can be configured with. Most of the catalog is competitor
 * intelligence that makes no sense pointed at yourself: reviews are never scraped
 * for self (scrape-monitor skips their extraction), and status / docs / roadmap
 * watch surfaces the org already owns. What remains is what the self pipeline
 * actually feeds — the site itself, its pricing, its hiring, and the repo while
 * the product is still being built.
 */
export const SELF_SOURCE_GROUPS: readonly SourceGroup[] = [
  "web_content",
  "pricing",
  "hiring",
  "developer",
];

export const SELF_CONFIGURABLE_SOURCES: Partial<Record<SourceGroup, readonly SourceType[]>> = {
  web_content: CONFIGURABLE_SOURCES.web_content,
  pricing: CONFIGURABLE_SOURCES.pricing,
  hiring: CONFIGURABLE_SOURCES.hiring,
  developer: ["github_repo"],
};

/** Flat list of every source a product's sources page shows, in display order. */
export const ALL_SELF_CONFIGURABLE_SOURCES: readonly SourceType[] = SELF_SOURCE_GROUPS.flatMap(
  (g) => SELF_CONFIGURABLE_SOURCES[g] ?? [],
);

/**
 * Seeded automatically at competitor creation, on every plan. No toggle and no URL:
 * the user neither chooses nor pays for them, so the only thing they can ever carry
 * is a cadence — and only from pro up (features.alwaysOnCadence). Below that they
 * stay exactly what they were: watched weekly, nothing to decide.
 */
export const AUTOMATIC_SOURCES: readonly SourceType[] = [
  "sitemap",
  "news",
  "subdomains",
  "youtube",
  "hackernews",
  "wellknown",
];

/**
 * Fastest cadence an always-on source may be configured at, per source.
 *
 * The ceiling is a property of the ENDPOINT, not of the plan: every one of these
 * reads a third party we neither pay nor rate-negotiate with, so "what pro is
 * entitled to" and "what this host tolerates" are two different questions and only
 * the second one belongs here. The plan answers the first (allowedFrequencies), and
 * the offered set is the intersection — see automaticFrequencyOptions.
 *
 * `realtime` is hourly (computeNextRun), so the split is between the two sources
 * that carry a same-day event and the four that cannot produce one:
 *   news / hackernews  — one cheap GET each (Google News RSS, HN Algolia). A funding
 *     round or a Show HN is worth hours, not a day: both are stale by tomorrow.
 *   sitemap / wellknown / youtube — a sitemap walk, a handful of /.well-known GETs,
 *     a channel RSS. All three move on release or upload cadence, so an hourly poll
 *     multiplies the fetch and returns the same bytes.
 *   subdomains — the one with a real third-party cost: crt.sh (a donated public CT
 *     service) plus up to 100 DNS+HEAD liveness probes per run. CT propagation is
 *     measured in hours anyway, so hourly would spend that budget for nothing.
 */
export const AUTOMATIC_SOURCE_MAX_FREQUENCY: Partial<Record<SourceType, MonitorFrequency>> = {
  news: "realtime",
  hackernews: "realtime",
  sitemap: "daily",
  wellknown: "daily",
  youtube: "daily",
  subdomains: "daily",
};

/**
 * The cadence ceiling for `source`. Weekly for anything that is not an always-on
 * source, which is the safe answer rather than a throw: the callers are a plan gate
 * and a UI, and neither should widen when the catalog gains a value nobody placed.
 */
export function automaticSourceMaxFrequency(source: SourceType): MonitorFrequency {
  return AUTOMATIC_SOURCE_MAX_FREQUENCY[source] ?? "weekly";
}

/**
 * Every cadence always-on `source` itself offers, fastest first — what the Sources
 * page draws as segments, whatever the plan. Plan-independent on purpose: a free
 * workspace sees the same two or three positions, locked, which is the upsell.
 */
export function automaticSourceFrequencies(source: SourceType): MonitorFrequency[] {
  if (!isAutomaticSource(source)) return [];
  const ceiling = automaticSourceMaxFrequency(source);
  return MONITOR_FREQUENCIES.filter((f) => frequencyWithin(f, ceiling));
}

/**
 * The cadences `plan` may actually pick for always-on `source`, fastest first —
 * empty when the plan has no say at all. The empty array is what the Sources page
 * renders locked, and what the API refuses.
 */
export function automaticFrequencyOptions(plan: Plan, source: SourceType): MonitorFrequency[] {
  if (!planIncludesFeature(plan, "alwaysOnCadence")) return [];
  return automaticSourceFrequencies(source).filter((f) => planIncludesFrequency(plan, f));
}

/**
 * Infra-only anchors: never scraped, never scheduled, isActive=false. They exist
 * solely to satisfy the snapshot → change → signal FK chain for synthetic signals.
 * Never rendered anywhere — a user row for them would describe nothing.
 */
export const ANCHOR_SOURCES: readonly SourceType[] = [
  "tech_stack",
  "ai_visibility",
  "review_shift",
  "hiring_shift",
  "job_facts",
  "hiring_footprint",
  "hiring_salary",
  "comparison_page",
  "pricing_probe",
  "shipping_velocity",
  "customer_proof",
  "editorial_shift",
  "roadmap_shift",
  "integration_catalog",
  "audience_page",
];

/**
 * Retired for legal reasons (Reviews v2). Enum values kept so historical monitor
 * rows stay valid; no scraper, in no plan, never offered again.
 */
export const RETIRED_SOURCES: readonly SourceType[] = [
  "g2_reviews",
  "capterra_reviews",
  "trustpilot_reviews",
  "trustradius_reviews",
  "gartner_reviews",
  "playstore_reviews",
];

/**
 * In the enum but with NO scraper binding (getScraper throws). Offering them would
 * create monitors that fail every run and auto-pause. Phase 9 roadmap.
 */
export const UNIMPLEMENTED_SOURCES: readonly SourceType[] = ["linkedin", "twitter"];

const NO_SCRAPER_SET = new Set<SourceType>([...RETIRED_SOURCES, ...UNIMPLEMENTED_SOURCES]);

/**
 * Whether a monitor on this source can never run, because nothing is bound to it in
 * the scraper registry. A retired source leaves live monitor rows behind, and those
 * rows fail with `No scraper for source type: …`, exhaust the 3 strikes and pause —
 * at which point the unscrapable re-arm wakes them every 7 days to fail again, for
 * good. The re-arm exists for a source that was merely DOWN; this one is gone.
 */
export function hasNoScraper(source: SourceType): boolean {
  return NO_SCRAPER_SET.has(source);
}

/** Flat list of every source that gets a configurable row, in display order. */
export const ALL_CONFIGURABLE_SOURCES: readonly SourceType[] = SOURCE_GROUPS.flatMap(
  (g) => CONFIGURABLE_SOURCES[g],
);

const CONFIGURABLE_SET = new Set<SourceType>(ALL_CONFIGURABLE_SOURCES);
const AUTOMATIC_SET = new Set<SourceType>(AUTOMATIC_SOURCES);
const HIDDEN_SET = new Set<SourceType>([
  ...ANCHOR_SOURCES,
  ...RETIRED_SOURCES,
  ...UNIMPLEMENTED_SOURCES,
]);

/** Whether `source` gets a user-configurable row on the Sources page. */
export function isConfigurableSource(source: SourceType): boolean {
  return CONFIGURABLE_SET.has(source);
}

/** Whether `source` is shown read-only under "Automatic sources". */
export function isAutomaticSource(source: SourceType): boolean {
  return AUTOMATIC_SET.has(source);
}

/**
 * Whether `source` must never appear in the UI at all (anchor / retired /
 * unimplemented). Also the filter for the competitor payload's monitor list.
 */
export function isHiddenSource(source: SourceType): boolean {
  return HIDDEN_SET.has(source);
}

/** Every bucket, for the exhaustiveness assertion and for admin/debug listings. */
export const SOURCE_BUCKETS = {
  configurable: ALL_CONFIGURABLE_SOURCES,
  custom: CUSTOM_SOURCES,
  automatic: AUTOMATIC_SOURCES,
  anchor: ANCHOR_SOURCES,
  retired: RETIRED_SOURCES,
  unimplemented: UNIMPLEMENTED_SOURCES,
} as const satisfies Record<string, readonly SourceType[]>;

export type SourceBucket = keyof typeof SOURCE_BUCKETS;

/** Which bucket `source` belongs to. Total over SourceType (see catalog.test.ts). */
export function sourceBucket(source: SourceType): SourceBucket {
  for (const [bucket, list] of Object.entries(SOURCE_BUCKETS)) {
    if (list.includes(source)) return bucket as SourceBucket;
  }
  // Unreachable while the partition test passes; keeps the function total.
  throw new Error(`Source type not placed in the catalog: ${source}`);
}

/** All enum values, re-exported so the partition test has one import. */
export { SOURCE_TYPES };
