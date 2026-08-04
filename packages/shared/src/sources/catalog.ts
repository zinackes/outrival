import { SOURCE_TYPES, type SourceType } from "../constants/sources";

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
 * Seeded automatically at competitor creation and scraped on their own cadence.
 * Shown READ-ONLY ("Monitored automatically — can't be turned off"): no toggle, no
 * frequency, no URL. They cost the user nothing and carry no decision.
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
