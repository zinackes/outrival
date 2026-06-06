import { extractBrand } from "./url";
import type { SourceType } from "./constants/sources";

export const REVIEW_SOURCE_TYPES = [
  "g2_reviews",
  "capterra_reviews",
  "appstore_reviews",
  // patch-32 — multi-platform review coverage. All web review sites with a
  // schema.org AggregateRating (structured-first score) + AI verbatims, scraped
  // like g2/capterra via the cascade. Play Store has no Apple-style RSS, so it
  // goes through the same generic page path (not the appstore RSS path).
  "trustpilot_reviews",
  "trustradius_reviews",
  "gartner_reviews",
  "playstore_reviews",
] as const;
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
  g2_reviews: "g2",
  capterra_reviews: "capterra",
  appstore_reviews: "apple",
  trustpilot_reviews: "trustpilot",
  trustradius_reviews: "trustradius",
  gartner_reviews: "gartner",
  playstore_reviews: "google", // play.google.com → registrable brand "google"
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
  if (source === "playstore_reviews" && !parsePlayStoreUrl(parsed.toString())) {
    return { ok: false, error: "playstore_id_missing" };
  }
  return { ok: true, url: parsed.toString() };
}

/** Extract the package id from a play.google.com app URL (?id=com.acme.app). */
export function parsePlayStoreUrl(raw: string): { appId: string } | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const id = u.searchParams.get("id");
  return id && /^[a-zA-Z0-9._]+$/.test(id) ? { appId: id } : null;
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

export interface AppStoreReview {
  rating: number;
  title: string;
  content: string;
  author: string;
  updated: string;
}

/**
 * Normalized App Store snapshot stored as the snapshot content. Deliberately
 * carries no timestamp so the content hash stays stable across scrapes when the
 * reviews are unchanged (drives scrape-monitor's no-change short-circuit).
 */
export interface AppStoreSnapshot {
  source: "appstore";
  appId: string;
  country: string;
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
  const reviews = (data as Partial<AppStoreSnapshot>).reviews;
  if (!Array.isArray(reviews)) return null;
  if (reviews.length === 0) return { averageScore: null, reviewCount: 0, text: "" };

  const ratings = reviews
    .map((r) => r.rating)
    .filter((n): n is number => typeof n === "number" && n > 0);
  const averageScore = ratings.length
    ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 100) / 100
    : null;
  const text = reviews.map((r) => `[${r.rating}/5] ${r.title}\n${r.content}`).join("\n\n");
  return { averageScore, reviewCount: reviews.length, text };
}
