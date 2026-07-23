import { extractBrand } from "./url";
import type { SourceType } from "./constants/sources";

// Reviews v2 (2026-07-15): the ONLY user-selectable review source read directly is
// App Store, via Apple's public RSS feed (competitor data, keyless, no scraping).
// The scraped aggregators (g2/capterra/trustpilot/trustradius/gartner/playstore) are
// RETIRED for legal reasons — see sources.ts. Trustpilot survives as `trustpilot_public`
// (official-API surface: score + trend, no verbatims), which is NOT a REVIEW_SOURCE_TYPE:
// it needs no user URL (derived from the competitor domain) and no verbatim extraction.
export const REVIEW_SOURCE_TYPES = ["appstore_reviews"] as const;
export type ReviewSourceType = (typeof REVIEW_SOURCE_TYPES)[number];

export function isReviewSource(source: SourceType): source is ReviewSourceType {
  return (REVIEW_SOURCE_TYPES as readonly string[]).includes(source);
}

/**
 * Registrable brand the review URL MUST belong to. This is both a correctness
 * guard (scrape the actual review page, not the competitor homepage) and an
 * SSRF guard: a user-supplied URL can never resolve to an internal host because
 * its brand would not match the expected review site.
 */
const REVIEW_SOURCE_BRAND: Record<ReviewSourceType, string> = {
  appstore_reviews: "apple",
};

export type ReviewUrlValidation =
  | { ok: true; url: string }
  | { ok: false; error: string };

/**
 * Validate a user-supplied review-page URL against the expected source.
 * Enforces https, no embedded credentials, standard port, and a brand match
 * with the review site. App Store URLs must additionally carry an app id.
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
