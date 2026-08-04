import type { ContentItemInput } from "./types";
import type { FeedItem } from "../feeds/rss";
import type { RoadmapEntry } from "../roadmap/types";

/**
 * Read published items back out of a snapshot document (Content Intelligence v2 P1).
 *
 * Both sources this covers already synthesise their snapshot from structured data:
 * the changelog scraper parses an RSS/Atom feed, the roadmap scraper parses a
 * portal's own payload. Each writes that structure into a JSON island alongside
 * the diff-bearing body, so the ingestion here re-reads what the scraper ALREADY
 * knew rather than parsing prose back out of the listing it rendered.
 *
 * The island is a `<script>`, which `extractContent` strips before hashing, so
 * nothing in this file can move a content hash or fake a change.
 *
 * PURE: no I/O, no DB, no AI.
 */

export const CHANGELOG_ISLAND_ID = "outrival-changelog-feed";
export const ROADMAP_ISLAND_ID = "outrival-roadmap";
export const BLOG_ISLAND_ID = "outrival-blog-items";
/** Written by the docs scraper (`docsIsland`), in either of its two modes. */
export const DOCS_ISLAND_ID = "outrival-docs";

/**
 * A capture with more entries than this is a feed we do not understand, not a
 * release history. Runaway guard only — real changelog feeds serve tens.
 */
const MAX_ITEMS_PER_CAPTURE = 500;

/** Titles are stored as published; a wall of text is a parse gone wrong. */
const MAX_TITLE_CHARS = 300;
/** Enough of the entry body to quote one sentence from, never the whole post. */
const MAX_BODY_CHARS = 4000;

/**
 * The JSON payload of `<script type="application/json" id="…">`, or null.
 *
 * The writers escape every `<` as a `<` sequence inside the payload, so a
 * closing script tag cannot occur within it and the non-greedy match is exact.
 */
export function readJsonIsland(html: string, id: string): unknown {
  const re = new RegExp(
    `<script[^>]*\\bid=["']${id}["'][^>]*>([\\s\\S]*?)</script>`,
    "i",
  );
  const raw = re.exec(html)?.[1];
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Wrap a payload as the island a snapshot carries.
 *
 * Both writers live here, next to the readers below, because the two ARE one
 * format: split across the scraper that emits it and the job that reads it, a
 * renamed field would drift silently and ingestion would simply go quiet.
 *
 * Every `<` is escaped, so a title containing a closing script tag cannot end the
 * element early — and the non-greedy read below stays exact.
 */
function island(id: string, payload: unknown): string {
  const json = JSON.stringify(payload).replace(/</g, "\\u003c");
  return `<script type="application/json" id="${id}">${json}</script>`;
}

/** The island a feed-first changelog capture carries. */
export function buildChangelogIsland(feedUrl: string, items: ReadonlyArray<FeedItem>): string {
  return island(CHANGELOG_ISLAND_ID, { feedUrl, items });
}

/**
 * The island a roadmap capture carries.
 *
 * Exact vote counts DO travel here (P5), unlike in the diff-bearing body, which
 * carries a band. The reason the body bands them is that raw counts drift on every
 * row every week and would diff the whole listing on every capture — a property of
 * the DIFF, not of the number. The island is stripped before hashing, so nothing
 * here can move a content hash or fake a change, and a count is the only thing that
 * can rank one request against another: "their most requested feature just became
 * planned work" is a statement about an ordering, and a band cannot order.
 */
export function buildRoadmapIsland(
  url: string,
  vendor: string,
  entries: ReadonlyArray<RoadmapEntry>,
): string {
  return island(ROADMAP_ISLAND_ID, {
    url,
    vendor,
    entries: entries.map((e) => ({
      id: e.id,
      title: e.title,
      status: e.status,
      url: e.url,
      votes: e.votes,
    })),
  });
}

/**
 * The island a blog capture carries (Content Intelligence v2 P2).
 *
 * Two shapes, and the shape is part of the payload because it decides how the
 * capture may be DIFFED. A blog with a feed synthesises its snapshot from the
 * feed, exactly like the changelog; a blog without one keeps its rendered listing
 * as the diff body and the island only records the post links read off it. The
 * first capture after a blog gains the feed shape therefore compares a feed
 * listing against rendered marketing HTML — "everything changed" — which is why
 * the reader below exposes the shape and scrape-monitor re-baselines on it.
 */
export function buildBlogIsland(
  source: { feedUrl: string | null; listingUrl: string },
  items: ReadonlyArray<BlogIslandItem>,
): string {
  return island(BLOG_ISLAND_ID, {
    shape: source.feedUrl ? "feed" : "listing",
    feedUrl: source.feedUrl,
    listingUrl: source.listingUrl,
    items,
  });
}

/** One blog item as the scraper read it, before the ingestion job sees it. */
export interface BlogIslandItem {
  /** Feed guid when there is a feed; the canonical URL when there is not. */
  id: string;
  title: string;
  link: string | null;
  publishedAt: string | null;
  /** The feed's own summary, when it carried one. Never the fetched post body. */
  summary?: string | null;
}

/**
 * How this capture was built: "feed" when it was synthesised from an RSS/Atom
 * feed, "listing" when the rendered index page is still the diff body, null when
 * the capture predates P2 and carries no island at all.
 */
export function blogIslandShape(html: string): "feed" | "listing" | null {
  const island = readJsonIsland(html, BLOG_ISLAND_ID);
  if (!island || typeof island !== "object") return null;
  const shape = (island as { shape?: unknown }).shape;
  return shape === "feed" ? "feed" : shape === "listing" ? "listing" : null;
}

/**
 * The posts of a blog capture.
 *
 * Identity is the publisher's feed guid when there is a feed, and the canonical
 * URL when there is not — the URL being the only thing a listing hands out that a
 * copy edit cannot move (a title can be rewritten the day after publishing, and
 * keying on it would file the same post twice).
 */
export function parseBlogItems(html: string): ContentItemInput[] {
  const island = readJsonIsland(html, BLOG_ISLAND_ID);
  if (!island || typeof island !== "object") return [];
  const items = (island as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];

  return normalize(
    items.map((raw): ContentItemInput => {
      const it = (raw ?? {}) as Record<string, unknown>;
      const link = str(it.link);
      return {
        externalId: str(it.id) ?? link ?? str(it.title) ?? "",
        title: str(it.title) ?? "",
        url: link,
        publishedAt: str(it.publishedAt),
        body: str(it.summary),
        status: null,
        itemType: null,
      };
    }),
  );
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** `/docs/api/rate-limits` → "Rate limits". The docs index publishes no titles. */
export function docsTitleFromUrl(url: string): string {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    path = url;
  }
  const slug = path.replace(/\/+$/, "").split("/").filter(Boolean).pop() ?? "";
  const words = slug
    .replace(/\.(html?|mdx?)$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!words) return url;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * What a docs capture DOCUMENTED that the one before it did not.
 *
 * Unlike a feed or a portal, a docs index is a complete listing with no dates on
 * it: every page a vendor has ever written is on it, and none of them says when.
 * So the first capture of a docs surface publishes NOTHING — there is no honest
 * date to file three hundred existing pages under, and filing them under today
 * would report a vendor who documented their whole product this afternoon.
 *
 * From the second capture on, the difference between the two page lists IS the
 * publication, and `first_seen_at` is a true statement about it: we saw it appear.
 *
 * Both of the scraper's modes are read. A spec-published API has no pages at all,
 * and its new operations are the same fact in a different shape — a capability that
 * is documented now and was not before.
 */
export function parseDocsItems(html: string, previousHtml: string | null): ContentItemInput[] {
  const current = readJsonIsland(html, DOCS_ISLAND_ID);
  if (!current || typeof current !== "object") return [];
  // No previous capture is the baseline: we hold the listing, we announce nothing.
  if (previousHtml === null) return [];
  const previous = readJsonIsland(previousHtml, DOCS_ISLAND_ID);
  if (!previous || typeof previous !== "object") return [];

  const mode = str((current as { mode?: unknown }).mode);
  // A mode flip (a vendor publishing a spec for the first time) replaces the whole
  // listing with a different KIND of listing. Every line of it would read as new,
  // which is exactly the phantom the scraper's own mode-flip guard exists to stop.
  if (mode !== str((previous as { mode?: unknown }).mode)) return [];

  if (mode === "sitemap") {
    const held = new Set(pagesOf(previous));
    return normalize(
      pagesOf(current)
        .filter((url) => !held.has(url))
        .map((url) => ({
          externalId: url,
          title: docsTitleFromUrl(url),
          url,
          publishedAt: null,
          body: null,
          status: null,
          itemType: "doc_page",
        })),
    );
  }

  if (mode === "openapi") {
    const held = new Set(operationsOf(previous));
    return normalize(
      operationsOf(current)
        .filter((op) => !held.has(op))
        .map((op) => ({
          externalId: op,
          title: op,
          url: str((current as { specUrl?: unknown }).specUrl),
          publishedAt: null,
          body: null,
          status: null,
          itemType: "doc_endpoint",
        })),
    );
  }

  return [];
}

function pagesOf(island: object): string[] {
  const pages = (island as { pages?: unknown }).pages;
  if (!Array.isArray(pages)) return [];
  return pages.map(str).filter((p): p is string => p !== null);
}

/** `POST /v1/charges` — method and path, which is what identifies an endpoint. */
function operationsOf(island: object): string[] {
  const operations = (island as { operations?: unknown }).operations;
  if (!Array.isArray(operations)) return [];
  const out: string[] = [];
  for (const raw of operations) {
    const op = (raw ?? {}) as Record<string, unknown>;
    const method = str(op.method);
    const path = str(op.path);
    if (method && path) out.push(`${method.toUpperCase()} ${path}`);
  }
  return out;
}

/** Keep the first row per external id, drop the unusable ones, cap the rest. */
function normalize(items: ContentItemInput[]): ContentItemInput[] {
  const seen = new Set<string>();
  const out: ContentItemInput[] = [];
  for (const item of items) {
    if (!item.externalId || !item.title) continue;
    if (seen.has(item.externalId)) continue;
    seen.add(item.externalId);
    out.push({
      ...item,
      title: item.title.slice(0, MAX_TITLE_CHARS),
      body: item.body ? item.body.slice(0, MAX_BODY_CHARS) : null,
    });
    if (out.length >= MAX_ITEMS_PER_CAPTURE) break;
  }
  return out;
}

/**
 * The entries of a feed-first changelog capture. Empty when the capture fell back
 * to plain HTML change-detection — there is no feed to read, and guessing entries
 * out of rendered markup would write publications that never happened.
 */
export function parseChangelogItems(html: string): ContentItemInput[] {
  const island = readJsonIsland(html, CHANGELOG_ISLAND_ID);
  if (!island || typeof island !== "object") return [];
  const items = (island as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];

  return normalize(
    items.map((raw): ContentItemInput => {
      const it = (raw ?? {}) as Record<string, unknown>;
      const title = str(it.title) ?? "";
      const link = str(it.link);
      return {
        // The feed's guid is the identity; link and title are the fallbacks the
        // parser itself already applies, so this mirrors `FeedItem.id`.
        externalId: str(it.id) ?? link ?? title,
        title,
        url: link,
        publishedAt: str(it.publishedAt),
        body: str(it.summary),
        status: null,
        itemType: null,
      };
    }),
  );
}

/**
 * The entries of a roadmap portal capture.
 *
 * `publishedAt` stays null: a portal states a STATUS, not a publication date, and
 * stamping the capture time here would turn our scrape schedule into their
 * shipping cadence. The status is the fact worth keeping.
 */
export function parseRoadmapItems(html: string): ContentItemInput[] {
  const island = readJsonIsland(html, ROADMAP_ISLAND_ID);
  if (!island || typeof island !== "object") return [];
  const entries = (island as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) return [];

  return normalize(
    entries.map((raw): ContentItemInput => {
      const e = (raw ?? {}) as Record<string, unknown>;
      return {
        externalId: str(e.id) ?? "",
        title: str(e.title) ?? "",
        url: str(e.url),
        publishedAt: null,
        body: null,
        status: str(e.status)?.toLowerCase() ?? null,
        itemType: "roadmap_entry",
        // A capture written before P5 carries no votes at all, which is null —
        // distinct from a portal that publishes an entry sitting at zero.
        votes: typeof e.votes === "number" && Number.isFinite(e.votes) ? Math.max(0, Math.floor(e.votes)) : null,
      };
    }),
  );
}
