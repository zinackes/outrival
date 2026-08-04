import { test, expect } from "bun:test";
import { parseShopifyReviewsPage } from "./parse";
import { detectShopifyApp } from "./detect";
import { scrape } from "./shopify-reviews.scraper";

// Fixture cut down from the real markup of apps.shopify.com/klaviyo-email-marketing
// (captured 2026-08-04): the star SVGs and the Tailwind soup are dropped, every
// semantic hook the parser reads is kept, in the order the page emits them.
function card(opts: {
  id: string;
  rating: number;
  body?: string;
  author: string;
  country: string;
  tenure?: string;
  date: string;
  reply?: string;
}) {
  return `
  <div id="review-${opts.id}">
    <div data-merchant-review="" data-review-content-id="${opts.id}">
      <div>
        <div>
          <div aria-label="${opts.rating} out of 5 stars" role="img"></div>
          <div class="tw-text-body-xs tw-text-fg-tertiary"> ${opts.date} </div>
        </div>
        <div data-truncate-review>
          <div data-truncate-content-copy class="tw-mb-xs">
            <p class="tw-break-words">${opts.body ?? ""}</p>
          </div>
          <button data-truncate-content-toggle="">Show more</button>
        </div>
      </div>
      <div>
        <div class="tw-text-heading-xs">
          <span title="${opts.author}"> ${opts.author} </span>
          <button aria-label="Copy link to review" title="Copy link to review"></button>
        </div>
        <div>${opts.country}</div>
        ${opts.tenure ? `<div>${opts.tenure}</div>` : ""}
      </div>
      <div data-merchant-review-reply>
        ${
          opts.reply
            ? `<div data-truncate-content-copy><p class="tw-break-words">${opts.reply}</p></div>
               <div>Vendor HQ</div>`
            : ""
        }
      </div>
    </div>
  </div>`;
}

function page(cards: string[], opts: { rating?: number; count?: number } = {}) {
  const ld =
    opts.rating === undefined
      ? ""
      : `<script type="application/ld+json">${JSON.stringify({
          "@type": "SoftwareApplication",
          name: "Acme",
          aggregateRating: { "@type": "AggregateRating", ratingValue: opts.rating, ratingCount: opts.count },
        })}</script>`;
  return `<html><head>${ld}</head><body>
    <div class="app-reviews-metrics">
      <ul>
        <li><a aria-label="2599 total reviews" href="/acme/reviews?ratings%5B%5D=5">2.6K</a></li>
        <li><a aria-label="74 total reviews" href="/acme/reviews?ratings%5B%5D=4">74</a></li>
        <li><a aria-label="206 total reviews" href="/acme/reviews?ratings%5B%5D=1">206</a></li>
      </ul>
    </div>
    ${cards.join("\n")}
  </body></html>`;
}

test("parses a review card into id, rating, body, author, country, tenure and date", () => {
  const html = page(
    [
      card({
        id: "2308573",
        rating: 4,
        body: "Support answered in minutes, but the editor is slow.",
        author: "M&amp;RK Store",
        country: "United States",
        tenure: "2 months using the app",
        date: "August 3, 2026",
      }),
    ],
    { rating: 4.7, count: 2940 },
  );

  const parsed = parseShopifyReviewsPage(html);
  expect(parsed.isReviewsPage).toBe(true);
  expect(parsed.averageRating).toBe(4.7);
  expect(parsed.ratingCount).toBe(2940);
  expect(parsed.reviews).toEqual([
    {
      id: "2308573",
      rating: 4,
      content: "Support answered in minutes, but the editor is slow.",
      author: "M&RK Store",
      country: "United States",
      updated: "August 3, 2026",
      tenure: "2 months using the app",
    },
  ]);
});

test("the vendor's reply is never read as the merchant's verbatim", () => {
  const html = page([
    card({
      id: "1",
      rating: 1,
      body: "Billed twice for the same month.",
      author: "Shop A",
      country: "Germany",
      tenure: "About 1 year using the app",
      date: "August 1, 2026",
      reply: "Hi there, our support team has refunded you.",
    }),
  ]);
  const [review] = parseShopifyReviewsPage(html).reviews;
  expect(review?.content).toBe("Billed twice for the same month.");
  expect(review?.country).toBe("Germany");
});

test("a star-only review keeps its rating and country, with an empty body", () => {
  // Same-day reviews carry no tenure line at all, which is what broke the
  // country/tenure pair when they were read as a fixed sequence.
  const html = page([
    card({ id: "7", rating: 5, author: "Fresh Shop", country: "France", date: "August 4, 2026" }),
  ]);
  const [review] = parseShopifyReviewsPage(html).reviews;
  expect(review).toMatchObject({ rating: 5, content: "", country: "France", tenure: "" });
});

test("the star distribution is read from the ratings filter links, sorted by star", () => {
  expect(parseShopifyReviewsPage(page([])).distribution).toEqual([
    { stars: 5, count: 2599 },
    { stars: 4, count: 74 },
    { stars: 1, count: 206 },
  ]);
});

test("an app with no reviews is a valid reviews page, not a parse failure", () => {
  // Shopify renders the ratings breakdown for a brand-new app ("No reviews yet"),
  // which is what tells an empty listing from a page that is not the one we asked for.
  const parsed = parseShopifyReviewsPage(page([]));
  expect(parsed.isReviewsPage).toBe(true);
  expect(parsed.reviews).toEqual([]);
  expect(parsed.averageRating).toBeNull();
});

test("a page that is not a Shopify reviews page yields nothing and says so", () => {
  const parsed = parseShopifyReviewsPage("<html><body><h1>Not found</h1></body></html>");
  expect(parsed.isReviewsPage).toBe(false);
  expect(parsed.reviews).toEqual([]);
  expect(parsed.distribution).toEqual([]);
});

test("a card with no rating is skipped rather than stored as a 0-star review", () => {
  const html = page([
    `<div data-merchant-review="" data-review-content-id="99"><span title="Ghost"></span></div>`,
    card({ id: "100", rating: 5, author: "Real Shop", country: "Spain", date: "July 30, 2026" }),
  ]);
  expect(parseShopifyReviewsPage(html).reviews.map((r) => r.id)).toEqual(["100"]);
});

// ─── detection ───────────────────────────────────────────────────────────────

test("detects the listing a competitor links from its own site", () => {
  const html = `<footer><a href="https://apps.shopify.com/acme-checkout">Install on Shopify</a></footer>`;
  expect(detectShopifyApp(html)).toEqual({
    handle: "acme-checkout",
    url: "https://apps.shopify.com/acme-checkout",
  });
});

test("a protocol-relative link and a deep link resolve to the same handle", () => {
  const html = `<a href="//apps.shopify.com/acme-checkout/reviews?page=2">reviews</a>
                <a href="https://apps.shopify.com/acme-checkout">listing</a>`;
  expect(detectShopifyApp(html)?.handle).toBe("acme-checkout");
});

test("several distinct apps on one page is a guess, so nothing is detected", () => {
  const html = `<a href="https://apps.shopify.com/acme">us</a>
                <a href="https://apps.shopify.com/rival">them</a>`;
  expect(detectShopifyApp(html)).toBeNull();
});

test("store furniture is never mistaken for a listing", () => {
  const html = `<a href="https://apps.shopify.com/categories/marketing">Marketing apps</a>
                <a href="https://apps.shopify.com/search?q=email">Search</a>`;
  expect(detectShopifyApp(html)).toBeNull();
});

// ─── scraper guard (no network) ──────────────────────────────────────────────

test("scrape rejects a URL that is not a Shopify listing before any request", () => {
  expect(scrape("c1", "https://apps.apple.com/us/app/slack/id618783545")).rejects.toThrow(
    /Not a valid Shopify App Store URL/,
  );
});
