import { extractBrand } from "./url";
import { SOURCE_TYPES, type SourceType } from "./constants/sources";

// Reviews v2 (2026-07-15) + Shopify (2026-08-04): the user-selectable review sources
// read directly are App Store, via Apple's public RSS feed (competitor data, keyless,
// no scraping), and the Shopify App Store listing, a public server-rendered page that
// `apps.shopify.com/robots.txt` leaves open to us (no `User-agent: *` group at all).
// The scraped aggregators (g2/capterra/trustpilot/trustradius/gartner/playstore) are
// RETIRED for legal reasons — see sources.ts. Trustpilot survives as `trustpilot_public`
// (official-API surface: score + trend, no verbatims), which is NOT a REVIEW_SOURCE_TYPE:
// it needs no user URL (derived from the competitor domain) and no verbatim extraction.
export const REVIEW_SOURCE_TYPES = ["appstore_reviews", "shopify_reviews"] as const;
export type ReviewSourceType = (typeof REVIEW_SOURCE_TYPES)[number];

export function isReviewSource(source: SourceType): source is ReviewSourceType {
  return (REVIEW_SOURCE_TYPES as readonly string[]).includes(source);
}

/**
 * Sources whose capture is a ROTATING WINDOW rather than a document.
 *
 * A review page publishes its most RECENT reviews, so every scrape rewrites the
 * whole list and a lexical diff of two captures says the competitor deleted their
 * reviews and posted different ones. In prod that is the only thing this path ever
 * said — "removed the entire block of App Store reviews", "now includes a large
 * list of user reviews" — and one such change, classified off a blob no model could
 * read, came back announcing a 14-day free trial that did not exist. What actually
 * moves in reviews is read from the NUMBERS instead: extract-reviews writes
 * review_scores, and detect-review-theme-shifts turns a rising complaint theme or a
 * sustained score drop into the signal.
 *
 * Derived from the enum, NOT from REVIEW_SOURCE_TYPES: that set names the one
 * source a user may still enable, while prod keeps scraping g2 and capterra
 * monitors created before the aggregators were retired. Derived rather than listed
 * so a review source added later is covered the day it exists.
 */
const ROTATING_LIST_SOURCE_TYPES = new Set<string>(
  SOURCE_TYPES.filter((s) => s.endsWith("_reviews")),
);

export function isRotatingListSource(source: SourceType): boolean {
  return ROTATING_LIST_SOURCE_TYPES.has(source);
}

/**
 * Registrable brand the review URL MUST belong to. This is both a correctness
 * guard (scrape the actual review page, not the competitor homepage) and an
 * SSRF guard: a user-supplied URL can never resolve to an internal host because
 * its brand would not match the expected review site.
 */
const REVIEW_SOURCE_BRAND: Record<ReviewSourceType, string> = {
  appstore_reviews: "apple",
  shopify_reviews: "shopify",
};

export type ReviewUrlValidation =
  | { ok: true; url: string }
  | { ok: false; error: string };

/**
 * Validate a user-supplied review-page URL against the expected source.
 * Enforces https, no embedded credentials, standard port, and a brand match
 * with the review site. App Store URLs must additionally carry an app id, and
 * Shopify URLs an app handle.
 */
export function validateReviewUrl(source: ReviewSourceType, raw: string): ReviewUrlValidation {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return { ok: false, error: "invalid_url" };
  }
  if (parsed.protocol !== "https:") return { ok: false, error: "must_be_https" };
  if (parsed.username || parsed.password) return { ok: false, error: "credentials_not_allowed" };
  if (parsed.port && parsed.port !== "443") return { ok: false, error: "port_not_allowed" };

  if (extractBrand(parsed.hostname) !== REVIEW_SOURCE_BRAND[source]) {
    return { ok: false, error: "host_not_allowed" };
  }
  if (source === "appstore_reviews" && !parseAppStoreUrl(parsed.toString())) {
    return { ok: false, error: "appstore_id_missing" };
  }
  if (source === "shopify_reviews" && !parseShopifyAppUrl(parsed.toString())) {
    return { ok: false, error: "shopify_handle_missing" };
  }
  return { ok: true, url: parsed.toString() };
}

export interface AppStoreRef {
  appId: string;
  country: string;
}

/** Extract the numeric app id + 2-letter storefront from an apps.apple.com URL. */
export function parseAppStoreUrl(raw: string): AppStoreRef | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const idMatch = u.pathname.match(/\/id(\d+)/);
  if (!idMatch?.[1]) return null;
  const firstSeg = u.pathname.split("/").filter(Boolean)[0] ?? "";
  const country = /^[a-z]{2}$/i.test(firstSeg) ? firstSeg.toLowerCase() : "us";
  return { appId: idMatch[1], country };
}

/** Official Apple RSS customer-reviews JSON endpoint (no proxy, no auth). */
export function appStoreReviewsRssUrl(ref: AppStoreRef, page = 1): string {
  return `https://itunes.apple.com/${ref.country}/rss/customerreviews/page=${page}/id=${ref.appId}/sortby=mostrecent/json`;
}

/**
 * Official Apple Lookup endpoint (no proxy, no auth). Returns the STORE-WIDE
 * aggregate — `averageUserRating` + `userRatingCount`, the numbers shown on the
 * product page — per storefront. This is where the real rating lives; the RSS feed
 * above only carries the most-recent verbatim sample (≤500), whose mean skews low.
 */
export function appStoreLookupUrl(ref: AppStoreRef): string {
  return `https://itunes.apple.com/${ref.country}/lookup?id=${ref.appId}`;
}

export interface AppStoreReview {
  /**
   * Apple's stable per-review id (`entry.id.label`, verified present 2026-07-15).
   * The dedup key across paginated pages and configured storefronts, and the sort
   * key for the deterministic snapshot.
   */
  id: string;
  rating: number;
  title: string;
  content: string;
  author: string;
  updated: string;
}

/**
 * Normalized App Store snapshot stored as the snapshot content. Deliberately
 * carries no timestamp so the content hash stays stable across scrapes when the
 * reviews are unchanged (drives scrape-monitor's no-change short-circuit). Reviews
 * are deduped by id and sorted, so the generic diff maps +/- lines to added/removed
 * reviews. `countries` is the (sorted) set of storefronts the scrape iterated.
 */
export interface AppStoreSnapshot {
  source: "appstore";
  appId: string;
  countries: string[];
  /**
   * Store-wide aggregate rating for the primary storefront (Apple Lookup API) — the
   * number a visitor sees on the product page. Deliberately NOT the mean of `reviews`
   * (that is only the recent verbatim sample and skews low). Null when the lookup
   * failed. Optional so snapshots stored before this field existed still parse.
   */
  averageUserRating?: number | null;
  /** Total rating count (all ratings incl. star-only) from the Lookup API; null on failure. */
  userRatingCount?: number | null;
  reviews: AppStoreReview[];
}

export interface AppStoreSummary {
  averageScore: number | null;
  reviewCount: number;
  text: string;
}

/** Parse a stored App Store snapshot into structured score/count + a text blob. */
export function parseAppStoreSnapshot(json: string): AppStoreSummary | null {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const snap = data as Partial<AppStoreSnapshot>;
  const reviews = snap.reviews;
  if (!Array.isArray(reviews)) return null;

  // Score + count come from Apple's store-wide aggregate (Lookup API) when present,
  // NOT the mean of the recent verbatim sample: `sortby=mostrecent` returns the last
  // ≤500 reviews, dominated by post-update complainers, so its mean reads far below
  // the rating shown on the store (e.g. 4.06 vs 4.8). Fall back to the sample only
  // for pre-aggregate snapshots or when the lookup failed.
  const aggScore =
    typeof snap.averageUserRating === "number" && snap.averageUserRating > 0
      ? Math.round(snap.averageUserRating * 100) / 100
      : null;
  const aggCount =
    typeof snap.userRatingCount === "number" && snap.userRatingCount >= 0
      ? snap.userRatingCount
      : null;

  if (reviews.length === 0) return { averageScore: aggScore, reviewCount: aggCount ?? 0, text: "" };

  const ratings = reviews
    .map((r) => r.rating)
    .filter((n): n is number => typeof n === "number" && n > 0);
  const sampleAverage = ratings.length
    ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 100) / 100
    : null;
  const text = reviews.map((r) => `[${r.rating}/5] ${r.title}\n${r.content}`).join("\n\n");
  return {
    averageScore: aggScore ?? sampleAverage,
    reviewCount: aggCount ?? reviews.length,
    text,
  };
}

// ─── Shopify App Store reviews (2026-08-04) ──────────────────────────────────
// The listing at apps.shopify.com/{handle} server-renders its merchant reviews and
// its own JSON-LD AggregateRating. Unlike the retired aggregators, Shopify neither
// forbids us in robots.txt (no `User-agent: *` group) nor sells this data as a
// product, so it is captured through the standard L0 path (robots + rate limit).

export interface ShopifyAppRef {
  /** The listing slug: `klaviyo-email-marketing` in apps.shopify.com/klaviyo-…. */
  handle: string;
}

/**
 * Paths under apps.shopify.com that are the store's own furniture, not an app.
 * A user pasting a category page would otherwise produce a monitor that scrapes a
 * listing of listings and reports its rating as a competitor's.
 */
const SHOPIFY_RESERVED_SEGMENTS = new Set([
  "categories", "collections", "search", "browse", "partners", "stores",
  "compare", "blog", "best", "trending", "recommended",
]);

/** Extract the app handle from an apps.shopify.com URL. Null when it isn't one. */
export function parseShopifyAppUrl(raw: string): ShopifyAppRef | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.hostname.toLowerCase() !== "apps.shopify.com") return null;
  const handle = u.pathname.split("/").filter(Boolean)[0];
  if (!handle) return null;
  // Handles are lowercase kebab slugs; anything else is a store path we don't know.
  if (!/^[a-z0-9][a-z0-9-]*$/.test(handle)) return null;
  if (SHOPIFY_RESERVED_SEGMENTS.has(handle)) return null;
  return { handle };
}

/** Canonical listing URL for a handle (what the source's monitor points at). */
export function shopifyAppUrl(handle: string): string {
  return `https://apps.shopify.com/${handle}`;
}

/**
 * Reviews page for a handle, newest first. `sort_by=newest` is what makes the
 * capture a moving window of the most recent reviews rather than Shopify's default
 * relevance order, which reshuffles without anything being written.
 */
export function shopifyReviewsUrl(handle: string, page = 1): string {
  return `https://apps.shopify.com/${handle}/reviews?sort_by=newest&page=${page}`;
}

export interface ShopifyReview {
  /** `data-review-content-id` — Shopify's stable per-review id. Dedup + sort key. */
  id: string;
  rating: number;
  content: string;
  /** The merchant's store name, as shown on the review. */
  author: string;
  /** Merchant country, when the listing shows one ("United States"). */
  country: string;
  /** Review date as printed ("August 1, 2026"). Empty when absent. */
  updated: string;
  /** How long they had been using the app ("About 2 years using the app"). */
  tenure: string;
}

/**
 * Normalized Shopify snapshot stored as the snapshot content. Like the App Store
 * snapshot it deliberately carries no timestamp, so the content hash stays stable
 * when nothing moved, and reviews are deduped by id and sorted so the generic diff
 * maps +/- lines to added/removed reviews.
 */
export interface ShopifyReviewsSnapshot {
  source: "shopify";
  handle: string;
  /** Listing-wide average from the page's JSON-LD AggregateRating; null if absent. */
  averageRating: number | null;
  /** Listing-wide review total from the same block; null if absent. */
  ratingCount: number | null;
  /** Star histogram, sorted by star descending. Empty when the page shows none. */
  distribution: { stars: number; count: number }[];
  reviews: ShopifyReview[];
}

export interface ShopifyReviewsSummary {
  averageScore: number | null;
  reviewCount: number;
  /** The verbatims, one block per review, for the qualitative AI pass. */
  text: string;
}

/** Parse a stored Shopify snapshot into structured score/count + a text blob. */
export function parseShopifyReviewsSnapshot(json: string): ShopifyReviewsSummary | null {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const snap = data as Partial<ShopifyReviewsSnapshot>;
  if (snap.source !== "shopify") return null;
  const reviews = snap.reviews;
  if (!Array.isArray(reviews)) return null;

  // Score + count come from the listing-wide aggregate, never from the mean of the
  // captured window: `sort_by=newest` returns the most recent 30, which skew with
  // whatever the app just shipped (same reason the App Store parser ignores its
  // sample mean). Fall back to the sample only when the aggregate is missing.
  const aggScore =
    typeof snap.averageRating === "number" && snap.averageRating > 0
      ? Math.round(snap.averageRating * 100) / 100
      : null;
  const aggCount =
    typeof snap.ratingCount === "number" && snap.ratingCount >= 0 ? snap.ratingCount : null;

  if (reviews.length === 0) return { averageScore: aggScore, reviewCount: aggCount ?? 0, text: "" };

  const ratings = reviews
    .map((r) => r.rating)
    .filter((n): n is number => typeof n === "number" && n > 0);
  const sampleAverage = ratings.length
    ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 100) / 100
    : null;
  const text = reviews.map((r) => `[${r.rating}/5] ${r.content}`).join("\n\n");
  return {
    averageScore: aggScore ?? sampleAverage,
    reviewCount: aggCount ?? reviews.length,
    text,
  };
}

// ─── Trustpilot public surface (Reviews v2, 2026-07-15) ──────────────────────
// Trustpilot's ToS explicitly forbids scraping (they target "AI agents or screen
// scrapers") and there is NO keyless public endpoint (verified 2026-07-15: the
// official API and the review page both return 403 without a key). So Trustpilot is
// SURFACE ONLY, via the OFFICIAL API (TRUSTPILOT_API_KEY): trust score, review count
// and star distribution — never third-party verbatims. The useful "score of X slips
// 4.4 → 4.2" signal survives; the verbatims (which they license as a product) do not.

/**
 * Normalized Trustpilot snapshot stored as the snapshot content. Like the App Store
 * snapshot it deliberately carries no timestamp, so the content hash is stable when
 * the score/count/distribution are unchanged and the generic diff surfaces a real
 * movement. `distribution` is sorted by star (deterministic).
 */
export interface TrustpilotSnapshot {
  source: "trustpilot";
  domain: string;
  businessUnitId: string;
  /** TrustScore 1.0–5.0, or null when the API did not return one. */
  trustScore: number | null;
  /** Rounded 1–5 stars, or null. */
  stars: number | null;
  reviewCount: number;
  distribution: { stars: number; count: number }[];
}

export interface TrustpilotSummary {
  trustScore: number | null;
  reviewCount: number;
}

/** Parse a stored Trustpilot snapshot into the score/count point for review_scores. */
export function parseTrustpilotSnapshot(json: string): TrustpilotSummary | null {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const snap = data as Partial<TrustpilotSnapshot>;
  if (snap.source !== "trustpilot") return null;
  const trustScore =
    typeof snap.trustScore === "number" && snap.trustScore > 0 ? snap.trustScore : null;
  const reviewCount = typeof snap.reviewCount === "number" ? snap.reviewCount : 0;
  return { trustScore, reviewCount };
}
