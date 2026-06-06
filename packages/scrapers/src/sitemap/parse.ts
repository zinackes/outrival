import { gunzipSync } from "node:zlib";

/**
 * Sitemap parsing + URL-set collection (patch-32, sitemap-diff signal). A sitemap
 * is the broadest discovery surface a competitor exposes: diffing its URL set
 * between runs surfaces brand-new pages (a new pricing page, a launched product,
 * a careers push) before any of them is individually monitored. Pure XML parsing
 * (regex, no dep); the network recursion is a thin, fetch-injectable orchestrator.
 */

export type UrlCategory =
  | "blog"
  | "pricing"
  | "jobs"
  | "product"
  | "docs"
  | "changelog"
  | "legal"
  | "other";

export interface ParsedSitemap {
  /** Page URLs from a <urlset>. */
  urls: string[];
  /** Nested sitemap URLs from a <sitemapindex>. */
  sitemaps: string[];
}

function locs(xml: string, container: string): string[] {
  const out: string[] = [];
  const blockRe = new RegExp(`<${container}\\b[\\s\\S]*?</${container}>`, "gi");
  for (const block of xml.match(blockRe) ?? []) {
    const m = /<loc>\s*([\s\S]*?)\s*<\/loc>/i.exec(block);
    const loc = m?.[1]?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
    if (loc) out.push(decodeXml(loc));
  }
  return out;
}

function decodeXml(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

/** Parse one sitemap document: page URLs from <urlset>, child sitemaps from
 *  <sitemapindex>. A document is one or the other; both arrays are returned. */
export function parseSitemap(xml: string): ParsedSitemap {
  return { urls: locs(xml, "url"), sitemaps: locs(xml, "sitemap") };
}

/** Gunzip when the bytes are gzip-framed (magic 1f 8b) or the URL ends .gz. */
export function sitemapBytesToText(bytes: Uint8Array, url: string): string {
  const gzipped = (bytes[0] === 0x1f && bytes[1] === 0x8b) || /\.gz($|\?)/i.test(url);
  const buf = gzipped ? gunzipSync(Buffer.from(bytes)) : Buffer.from(bytes);
  return buf.toString("utf-8");
}

const CATEGORY_RULES: [RegExp, UrlCategory][] = [
  [/\/(blog|news|articles?|press|stories)(\/|$)/i, "blog"],
  [/\/(pricing|plans?|tarifs?|tarification|prix)(\/|$)/i, "pricing"],
  [/\/(careers?|jobs?|join-us|hiring|work-with-us)(\/|$)/i, "jobs"],
  [/\/(changelog|releases?|whats-?new|release-notes|updates?)(\/|$)/i, "changelog"],
  [/\/(docs?|documentation|help|support|knowledge|guides?|api)(\/|$)/i, "docs"],
  [/\/(legal|privacy|terms|gdpr|cookies?|dpa|security)(\/|$)/i, "legal"],
  [/\/(products?|features?|solutions?|platform|use-?cases?|integrations?)(\/|$)/i, "product"],
];

/** Categorize a page URL by its path (deterministic, 0 AI). */
export function categorizeUrl(url: string): UrlCategory {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    path = url;
  }
  for (const [re, cat] of CATEGORY_RULES) {
    if (re.test(path)) return cat;
  }
  return "other";
}

export interface CollectOptions {
  /** Fetch one sitemap URL → raw bytes, or null on failure. Injectable for tests. */
  fetchBytes: (url: string) => Promise<Uint8Array | null>;
  /** Hard cap on collected page URLs (default 5000). */
  maxUrls?: number;
  /** Hard cap on sitemap documents fetched, incl. nested (default 50). */
  maxSitemaps?: number;
}

/**
 * Walk a sitemap (or sitemap-index) from `rootUrl`, recursing one level into a
 * <sitemapindex> and decompressing .gz children, into a de-duplicated, sorted URL
 * set. Bounded by maxUrls/maxSitemaps so a pathological index can't blow up a run.
 * Returns the sorted URLs (sorted → a stable snapshot the diff can compare).
 */
export async function collectSitemapUrls(
  rootUrl: string,
  opts: CollectOptions,
): Promise<string[]> {
  const maxUrls = opts.maxUrls ?? 5000;
  const maxSitemaps = opts.maxSitemaps ?? 50;
  const urls = new Set<string>();
  const queue = [rootUrl];
  const visited = new Set<string>();
  let fetched = 0;

  while (queue.length > 0 && fetched < maxSitemaps && urls.size < maxUrls) {
    const next = queue.shift();
    if (!next || visited.has(next)) continue;
    visited.add(next);
    const bytes = await opts.fetchBytes(next);
    if (!bytes) continue;
    fetched++;
    let text: string;
    try {
      text = sitemapBytesToText(bytes, next);
    } catch {
      continue; // corrupt gzip / non-text → skip this document
    }
    const parsed = parseSitemap(text);
    for (const u of parsed.urls) {
      urls.add(u);
      if (urls.size >= maxUrls) break;
    }
    for (const s of parsed.sitemaps) {
      if (!visited.has(s)) queue.push(s);
    }
  }

  return Array.from(urls).sort();
}
