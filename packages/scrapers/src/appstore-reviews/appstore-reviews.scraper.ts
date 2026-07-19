import {
  parseAppStoreUrl,
  appStoreReviewsRssUrl,
  type AppStoreRef,
  type AppStoreReview,
  type AppStoreSnapshot,
} from "@outrival/shared";
import type { ScrapeOptions, ScrapeOutcome } from "../types";

const MAX_PAGES = 3;

interface RssEntry {
  id?: { label?: string };
  "im:rating"?: { label?: string };
  title?: { label?: string };
  content?: { label?: string };
  author?: { name?: { label?: string } };
  updated?: { label?: string };
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
      const res = await fetch(appStoreReviewsRssUrl(countryRef, page), {
        headers: { accept: "application/json" },
      });
      lastStatus = res.status;
      if (!res.ok) {
        // First page of THIS storefront failed (e.g. a bad country → HTTP 400, or a
        // transient error). Skip this country and try the next — don't throw yet;
        // another storefront may still succeed. A later page failing after we already
        // have reviews is just "no more pages".
        break;
      }
      firstPageFetched = true;

      const json = (await res.json()) as { feed?: { entry?: RssEntry | RssEntry[] } };
      const raw = json.feed?.entry;
      const entries = Array.isArray(raw) ? raw : raw ? [raw] : [];
      // Apple's first entry is app metadata (no im:rating) — filtered out here.
      // A real review always carries id.label; skip any entry missing it (defensive).
      const pageReviews = entries
        .filter((e) => e["im:rating"]?.label && e.id?.label)
        .map<AppStoreReview>((e) => ({
          id: e.id!.label!,
          rating: Number(e["im:rating"]?.label ?? 0) || 0,
          title: e.title?.label ?? "",
          content: e.content?.label ?? "",
          author: e.author?.name?.label ?? "anonymous",
          updated: e.updated?.label ?? "",
        }));
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
  // feed recovers. (A 200 with zero reviews is a legitimate baseline; a collapse from
  // many reviews to near-empty is caught downstream by the anti-void guard.)
  if (!anyCountryFetched) {
    throw new Error(
      `App Store RSS returned no data for app ${ref.appId} across [${countries.join(", ")}] (last status ${lastStatus})`,
    );
  }

  const reviews = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  const snapshot: AppStoreSnapshot = {
    source: "appstore",
    appId: ref.appId,
    countries: [...countries].sort(),
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
