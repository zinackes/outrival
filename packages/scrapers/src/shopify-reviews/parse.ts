/**
 * Pure parsing of a Shopify App Store reviews page. No network, no AI, no DOM
 * library: the page ships stable semantic hooks (`data-merchant-review`,
 * `data-review-content-id`, `aria-label="N out of 5 stars"`) and its own JSON-LD
 * AggregateRating, so regex over the markup is enough, the same way feeds/rss.ts
 * reads a feed. A page that carries none of these returns empty rather than a
 * guess, which is what lets the scraper tell "no reviews" from "not the page".
 *
 * Markup verified live 2026-08-04 on apps.shopify.com/klaviyo-email-marketing.
 */
import type { ShopifyReview } from "@outrival/shared";

export interface ShopifyPageParse {
  reviews: ShopifyReview[];
  /** Listing-wide aggregate from the JSON-LD block; null when the page has none. */
  averageRating: number | null;
  ratingCount: number | null;
  /** Star histogram, sorted by star descending. Empty when the page shows none. */
  distribution: { stars: number; count: number }[];
  /**
   * True when this really is a Shopify reviews page, whatever it holds. An app with
   * zero reviews still renders the ratings-breakdown block, so this is what tells a
   * legitimately empty listing (a new app: "No reviews yet") from a page that is not
   * the one we asked for. Without it, both look like "0 reviews" and the scraper
   * would store an empty baseline for a capture that actually failed.
   */
  isReviewsPage: boolean;
}

/**
 * Review card boundary. The `=` matters: the vendor's answer to a review is marked
 * `data-merchant-review-reply` inside the same card, so splitting on the bare
 * attribute name cut every card in half and dropped the merchant's country.
 */
const REVIEW_SPLIT = /data-merchant-review=/;
/** The vendor's reply, which starts where the merchant's own card content ends. */
const REPLY_SPLIT = /data-merchant-review-reply/;
const REVIEWS_SECTION_MARKER = "app-reviews-metrics";
const REVIEW_ID_RE = /data-review-content-id="(\d+)"/;
const RATING_RE = /aria-label="(\d(?:\.\d)?) out of 5 stars"/;
const DATE_RE =
  /(January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4}/;
/** The review body: one or more paragraphs inside the truncation wrapper. */
const BODY_BLOCK_RE = /data-truncate-content-copy[^>]*>([\s\S]*?)<\/div>/;
const PARAGRAPH_RE = /<p[^>]*>([\s\S]*?)<\/p>/g;
/** Merchant store name, carried as the title attribute of its own span. */
const AUTHOR_RE = /<span[^>]*title="([^"]*)"[^>]*>/;
/**
 * Country and tenure are the only bare `<div>text</div>` nodes in a card (everything
 * else carries classes), and tenure is absent on a review posted the same day, so
 * they are read as a list rather than as a fixed pair.
 */
const BARE_DIV_RE = /<div>\s*([^<>]{1,80}?)\s*<\/div>/g;
const TENURE_SUFFIX = "using the app";
const DISTRIBUTION_RE = /aria-label="(\d+) total reviews"\s+href="[^"]*ratings%5B%5D=(\d)"/g;

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

function decode(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&[a-z]+;|&#39;/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? entity);
}

function textOf(html: string): string {
  return decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

/**
 * Listing-wide score + total, from the page's own JSON-LD. Deliberately the only
 * source for these numbers: the captured window is the 30 most recent reviews, whose
 * mean sits well away from the rating the page displays.
 */
function parseAggregate(html: string): { averageRating: number | null; ratingCount: number | null } {
  const blocks = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) ?? [];
  for (const block of blocks) {
    const body = block.replace(/^<script[^>]*>/, "").replace(/<\/script>$/, "");
    let data: unknown;
    try {
      data = JSON.parse(body);
    } catch {
      continue;
    }
    const rating = (data as { aggregateRating?: { ratingValue?: unknown; ratingCount?: unknown } })
      ?.aggregateRating;
    if (!rating) continue;
    const value = Number(rating.ratingValue);
    const count = Number(rating.ratingCount);
    return {
      averageRating: Number.isFinite(value) && value > 0 ? value : null,
      ratingCount: Number.isFinite(count) && count >= 0 ? count : null,
    };
  }
  return { averageRating: null, ratingCount: null };
}

function parseDistribution(html: string): { stars: number; count: number }[] {
  const byStar = new Map<number, number>();
  for (const match of html.matchAll(DISTRIBUTION_RE)) {
    const count = Number(match[1]);
    const stars = Number(match[2]);
    if (!Number.isFinite(count) || !Number.isFinite(stars)) continue;
    byStar.set(stars, count);
  }
  return [...byStar.entries()]
    .map(([stars, count]) => ({ stars, count }))
    .sort((a, b) => b.stars - a.stars);
}

/** One review card into a normalized review, or null when it carries no id/rating. */
function parseCard(rawCard: string): ShopifyReview | null {
  // Cut the vendor's reply off before reading anything: it sits in the same card and
  // would otherwise contribute its own paragraphs and country, turning the app
  // vendor's answer into a verbatim the AI attributes to a customer.
  const card = rawCard.split(REPLY_SPLIT)[0] ?? "";

  const id = card.match(REVIEW_ID_RE)?.[1];
  const rating = Number(card.match(RATING_RE)?.[1] ?? NaN);
  if (!id || !Number.isFinite(rating) || rating <= 0) return null;

  const bodyHtml = card.match(BODY_BLOCK_RE)?.[1] ?? "";
  const paragraphs = [...bodyHtml.matchAll(PARAGRAPH_RE)].map((m) => textOf(m[1] ?? ""));
  const content = paragraphs.filter(Boolean).join("\n").trim();

  const bare = [...card.matchAll(BARE_DIV_RE)].map((m) => textOf(m[1] ?? "")).filter(Boolean);
  const tenure = bare.find((line) => line.endsWith(TENURE_SUFFIX)) ?? "";
  const country = bare.find((line) => !line.endsWith(TENURE_SUFFIX)) ?? "";

  return {
    id,
    rating,
    content,
    author: decode(card.match(AUTHOR_RE)?.[1] ?? "").trim(),
    country,
    updated: card.match(DATE_RE)?.[0] ?? "",
    tenure,
  };
}

/**
 * Parse one reviews page. The first segment of the split is the page chrome (header,
 * metrics, filters) and never a review, so it is dropped.
 */
export function parseShopifyReviewsPage(html: string): ShopifyPageParse {
  const [, ...cards] = html.split(REVIEW_SPLIT);
  const reviews = cards
    .map(parseCard)
    .filter((review): review is ShopifyReview => review !== null);

  return {
    reviews,
    ...parseAggregate(html),
    distribution: parseDistribution(html),
    isReviewsPage: html.includes(REVIEWS_SECTION_MARKER),
  };
}
