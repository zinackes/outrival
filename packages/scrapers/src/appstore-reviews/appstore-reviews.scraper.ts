import {
  parseAppStoreUrl,
  appStoreReviewsRssUrl,
  appStoreLookupUrl,
  type AppStoreRef,
  type AppStoreReview,
  type AppStoreSnapshot,
} from "@outrival/shared";
import type { ScrapeOptions, ScrapeOutcome } from "../types";

const MAX_PAGES = 3;

/** Pause before re-asking for a first page that came back without a single entry. */
const EMPTY_FEED_RETRY_DELAY_MS = 1_000;

interface RssEntry {
  id?: { label?: string };
  "im:rating"?: { label?: string };
  title?: { label?: string };
  content?: { label?: string };
  author?: { name?: { label?: string } };
  updated?: { label?: string };
}

/**
 * One RSS page. `reviews` is null when the request itself failed (non-2xx), which is
 * what tells "this storefront is unusable" apart from "this page carries no review".
 */
interface PageResult {
  status: number;
  reviews: AppStoreReview[] | null;
}

async function fetchReviewPage(ref: AppStoreRef, page: number): Promise<PageResult> {
  const res = await fetch(appStoreReviewsRssUrl(ref, page), {
    headers: { accept: "application/json" },
  });
  if (!res.ok) return { status: res.status, reviews: null };

  const json = (await res.json()) as { feed?: { entry?: RssEntry | RssEntry[] } };
  const raw = json.feed?.entry;
  const entries = Array.isArray(raw) ? raw : raw ? [raw] : [];
  // Apple's first entry is app metadata (no im:rating) — filtered out here.
  // A real review always carries id.label; skip any entry missing it (defensive).
  return {
    status: res.status,
    reviews: entries
      .filter((e) => e["im:rating"]?.label && e.id?.label)
      .map<AppStoreReview>((e) => ({
        id: e.id!.label!,
        rating: Number(e["im:rating"]?.label ?? 0) || 0,
        title: e.title?.label ?? "",
        content: e.content?.label ?? "",
        author: e.author?.name?.label ?? "anonymous",
        updated: e.updated?.label ?? "",
      })),
  };
}

/**
 * Scrape App Store customer reviews via Apple's official RSS JSON feed. No browser,
 * no proxy, no key — structured data straight from itunes.apple.com (Cas B "propre":
 * competitor data, publicly offered by Apple).
 *
 * Endpoint verified live 2026-07-15 (curl):
 *   https://itunes.apple.com/{country}/rss/customerreviews/page={n}/id={appId}/sortby=mostrecent/json
 *   → HTTP 200, 50 entries/page (entry[0] is app metadata, no im:rating → filtered),
 *     each review carries `id.label` (dedup key) + `im:rating`; page 11 → 0 entries
 *     (the ~10-page/500-review historical ceiling — recent window only, good for
 *     inflection, not a full history); an invalid country → HTTP 400.
 *
 * The stored snapshot is our normalized shape (not Apple's verbose feed), deduped by
 * review id and sorted, and carries no timestamp — so the content hash is stable when
 * the reviews are unchanged and the generic diff maps +/- lines to added/removed
 * reviews. Multiple storefronts (`options.countries`) are merged into one snapshot.
 *
 * The SCORE + COUNT do NOT come from these recent reviews — their mean skews low (the
 * `sortby=mostrecent` window is dominated by post-update complainers, e.g. 4.06 vs the
 * 4.8 shown on the store). They come from the store-wide aggregate (Apple Lookup API,
 * `averageUserRating` / `userRatingCount`) captured for the primary storefront and
 * stored alongside the verbatims; the recent reviews stay only for the AI qualitative
 * praise/complaint extraction. Best-effort: a lookup failure falls back to the sample.
 *
 * appstore is deliberately NOT in scrape-monitor's SIZE_VARIABLE_SOURCES: the review
 * window is bounded (not append-only), so a sudden collapse to near-empty must be
 * caught by the anti-void/completeness guard (graded partial → diff skipped) rather
 * than treated as "every review removed".
 */
export async function scrape(
  _competitorId: string,
  url: string,
  options: ScrapeOptions = {},
): Promise<ScrapeOutcome> {
  const ref = parseAppStoreUrl(url);
  if (!ref) throw new Error(`Not a valid App Store URL: ${url}`);

  // Configured storefronts, else the country in the app URL (default "us"). Dedup +
  // normalize to lowercase 2-letter codes; ignore anything malformed.
  const configured = (options.countries ?? [])
    .map((c) => c.trim().toLowerCase())
    .filter((c) => /^[a-z]{2}$/.test(c));
  const countries = configured.length ? [...new Set(configured)] : [ref.country];

  const byId = new Map<string, AppStoreReview>();
  let anyCountryFetched = false;
  let lastStatus = 200;

  for (const country of countries) {
    const countryRef: AppStoreRef = { appId: ref.appId, country };
    let firstPageFetched = false;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const result = await fetchReviewPage(countryRef, page);
      lastStatus = result.status;
      if (!result.reviews) {
        // First page of THIS storefront failed (e.g. a bad country → HTTP 400, or a
        // transient error). Skip this country and try the next — don't throw yet;
        // another storefront may still succeed. A later page failing after we already
        // have reviews is just "no more pages".
        break;
      }
      firstPageFetched = true;

      // Apple intermittently answers 200 with an entry-less feed. Measured on prod
      // 2026-07-29: two consecutive captures of the same app stored 124-byte snapshots
      // (empty reviews, valid 4.55/2506 aggregate) while the identical URL returned 50
      // reviews from the same host minutes later. Accepting that as a baseline costs
      // twice: the capture carries no verbatim to extract, and the next healthy scrape
      // diffs as "150 reviews appeared". One re-ask separates the hiccup from an app
      // that genuinely has nothing recent — and only on the first page, so a storefront
      // that has simply run out of pages still stops at the first empty one.
      let pageReviews = result.reviews;
      if (pageReviews.length === 0 && page === 1) {
        await new Promise((resolve) => setTimeout(resolve, EMPTY_FEED_RETRY_DELAY_MS));
        const retry = await fetchReviewPage(countryRef, page);
        lastStatus = retry.status;
        if (retry.reviews) pageReviews = retry.reviews;
      }

      if (pageReviews.length === 0) break;
      // Dedup by id (across pages AND storefronts — ids are storefront-unique so this
      // never merges two distinct reviews).
      for (const r of pageReviews) byId.set(r.id, r);
    }
    if (firstPageFetched) anyCountryFetched = true;
  }

  // Anti-silent-failure: if NOT ONE storefront returned even a first page, we fetched
  // nothing — throw so the run fails and retries instead of storing an empty reviews
  // snapshot as a "success" baseline, which would fake "N new reviews" the moment the
  // feed recovers. (A 200 with zero reviews is a legitimate baseline ONCE re-asked —
  // see the retry above; a collapse from many reviews to near-empty is caught
  // downstream by the anti-void guard.)
  if (!anyCountryFetched) {
    throw new Error(
      `App Store RSS returned no data for app ${ref.appId} across [${countries.join(", ")}] (last status ${lastStatus})`,
    );
  }

  // Store-wide aggregate rating for the primary storefront (Apple Lookup API) — the
  // number shown on the product page. The RSS reviews above are only the most-recent
  // verbatim sample and their mean skews low, so the SCORE + COUNT ride this instead
  // (mirrors the Trustpilot surface snapshot: an aggregate movement IS the change).
  // Best-effort: a failure leaves both null and parseAppStoreSnapshot falls back to
  // the sample mean, so the scrape never fails over a missing aggregate.
  const [primaryCountry] = countries;
  let averageUserRating: number | null = null;
  let userRatingCount: number | null = null;
  if (primaryCountry) {
    try {
      const res = await fetch(appStoreLookupUrl({ appId: ref.appId, country: primaryCountry }), {
        headers: { accept: "application/json" },
      });
      if (res.ok) {
        const json = (await res.json()) as {
          results?: Array<{ averageUserRating?: number; userRatingCount?: number }>;
        };
        const app = json.results?.[0];
        if (app) {
          averageUserRating =
            typeof app.averageUserRating === "number" ? app.averageUserRating : null;
          userRatingCount = typeof app.userRatingCount === "number" ? app.userRatingCount : null;
        }
      }
    } catch {
      // best-effort — keep nulls, the parser falls back to the recent-sample mean.
    }
  }

  const reviews = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  const snapshot: AppStoreSnapshot = {
    source: "appstore",
    appId: ref.appId,
    countries: [...countries].sort(),
    averageUserRating,
    userRatingCount,
    reviews,
  };
  const html = JSON.stringify(snapshot);

  return {
    html,
    text: html,
    screenshotBuffer: Buffer.alloc(0),
    metadata: {
      source: "appstore",
      appId: ref.appId,
      countries,
      reviewCount: reviews.length,
    },
    statusCode: lastStatus,
    level: 0, // RSS JSON, no browser/proxy
    attempts: 1,
  };
}
