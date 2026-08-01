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
 * Exact vote counts stay out of it for the reason they stay out of the diff-bearing
 * body: they move on every capture, and nothing downstream reads them as a fact.
 */
export function buildRoadmapIsland(
  url: string,
  vendor: string,
  entries: ReadonlyArray<RoadmapEntry>,
): string {
  return island(ROADMAP_ISLAND_ID, {
    url,
    vendor,
    entries: entries.map((e) => ({ id: e.id, title: e.title, status: e.status, url: e.url })),
  });
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
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
      };
    }),
  );
}
