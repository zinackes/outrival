import { gunzipSync } from "node:zlib";

/**
 * Sitemap parsing + URL-set collection (patch-32, sitemap-diff signal). A sitemap
 * is the broadest discovery surface a competitor exposes: diffing its URL set
 * between runs surfaces brand-new pages (a new pricing page, a launched product,
 * a careers push) before any of them is individually monitored. Pure XML parsing
 * (regex, no dep); the network recursion is a thin, fetch-injectable orchestrator.
 */

export type UrlCategory =
  | "comparison"
  | "blog"
  | "pricing"
  | "jobs"
  | "product"
  | "docs"
  | "changelog"
  | "customers"
  | "glossary"
  | "landing"
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

/** The JSON-island id the sitemap scraper embeds; single source of truth so the
 *  builder and the scrape-monitor reader can't drift. */
export const SITEMAP_DOC_MARKER = "outrival-sitemap";

/**
 * Read the sorted URL list back out of a sitemap snapshot's JSON island — used by
 * the scrape-monitor sitemap branch to recover the PREVIOUS run's URL set for the
 * loc-only diff (lastmod is never consulted). Tolerant: no island → []. Pure.
 */
export function parseSitemapDoc(html: string): string[] {
  const m = new RegExp(
    `<script[^>]*id=["']${SITEMAP_DOC_MARKER}["'][^>]*>([\\s\\S]*?)</script>`,
    "i",
  ).exec(html);
  if (!m?.[1]) return [];
  try {
    const parsed = JSON.parse(m[1].replace(/\\u003c/g, "<")) as { urls?: unknown };
    return Array.isArray(parsed.urls) ? parsed.urls.filter((u): u is string => typeof u === "string") : [];
  } catch {
    return [];
  }
}

/** Gunzip when the bytes are gzip-framed (magic 1f 8b) or the URL ends .gz. */
export function sitemapBytesToText(bytes: Uint8Array, url: string): string {
  const gzipped = (bytes[0] === 0x1f && bytes[1] === 0x8b) || /\.gz($|\?)/i.test(url);
  const buf = gzipped ? gunzipSync(Buffer.from(bytes)) : Buffer.from(bytes);
  return buf.toString("utf-8");
}

// A competitor comparison / alternative page — the sitemap v2 high-value signal.
// Matches a `/vs/`, `/versus/`, `/compare/`, `/comparison/` or `/alternatives/`
// path segment, an `x-vs-y` slug, and the `{name}-alternative(s)` suffix pattern.
const COMPARISON_RES: RegExp[] = [
  /(^|[/-])(vs|versus)([/-]|$)/i,
  /\/(compare|comparison|comparisons|alternatives?)(\/|$)/i,
  /-alternatives?(\/|$)/i,
];

const CATEGORY_RULES: [RegExp, UrlCategory][] = [
  // comparison first — a "/vs/pricing"-style slug must read as comparison, not pricing.
  [/\/(blog|news|articles?|press|stories)(\/|$)/i, "blog"],
  [/\/(pricing|plans?|tarifs?|tarification|prix)(\/|$)/i, "pricing"],
  [/\/(careers?|jobs?|join-us|hiring|work-with-us)(\/|$)/i, "jobs"],
  [/\/(changelog|releases?|whats-?new|release-notes|updates?)(\/|$)/i, "changelog"],
  [/\/(docs?|documentation|help|support|knowledge|guides?|api)(\/|$)/i, "docs"],
  [/\/(customers?|case-stud(y|ies)|testimonials?|success-stories)(\/|$)/i, "customers"],
  [/\/(glossary|terms-glossary|dictionary|definitions?)(\/|$)/i, "glossary"],
  [/\/(lp|landing|get-started|demo|signup|sign-up|free-trial)(\/|$)/i, "landing"],
  [/\/(legal|privacy|terms|gdpr|cookies?|dpa|security)(\/|$)/i, "legal"],
  [/\/(products?|features?|solutions?|platform|use-?cases?|integrations?)(\/|$)/i, "product"],
];

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/**
 * Is this a competitor comparison / alternative page? The sitemap v2 signal: a
 * competitor publishing `/vs/...`, `/alternatives/...` or `{name}-alternative` is a
 * deliberate GTM/SEO move worth a HIGH signal. Pure, path-only.
 */
export function isComparisonUrl(url: string): boolean {
  const path = pathOf(url);
  return COMPARISON_RES.some((re) => re.test(path));
}

/**
 * Does the URL path name a given brand token (the user's own org, for the CRITICAL
 * escalation "a competitor is attacking you by name")? Normalizes both sides so
 * `/vs/out-rival` or `/outrival-alternative` match brand "Outrival". Empty brand →
 * false. Pure.
 */
export function slugMentionsBrand(url: string, brand: string | null | undefined): boolean {
  const needle = (brand ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (!needle || needle.length < 3) return false; // too-short brands are homonym-prone
  const hay = pathOf(url).toLowerCase().replace(/[^a-z0-9]+/g, "");
  return hay.includes(needle);
}

export interface ComparisonSignal {
  category: "content";
  /** high normally; critical when the slug names the user's own org. */
  severity: "high" | "critical";
  /** The page attacks the user's product by name → realtime-worthy. */
  targetsOrg: boolean;
}

/**
 * Decide the deterministic signal for a newly-appeared URL: null when it is not a
 * comparison page; otherwise content/high, escalated to content/critical when the
 * slug names one of the user's own org brands. Single source of truth shared by the
 * scrape-monitor sitemap branch and the tests. Pure.
 */
export function classifyComparisonUrl(
  url: string,
  orgBrands: (string | null | undefined)[],
): ComparisonSignal | null {
  if (!isComparisonUrl(url)) return null;
  const targetsOrg = orgBrands.some((b) => slugMentionsBrand(url, b));
  return { category: "content", severity: targetsOrg ? "critical" : "high", targetsOrg };
}

/** Categorize a page URL by its path (deterministic, 0 AI). */
export function categorizeUrl(url: string): UrlCategory {
  const path = pathOf(url);
  if (isComparisonUrl(url)) return "comparison";
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
