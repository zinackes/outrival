import type { ScrapeOutcome, ScrapeOptions } from "../types";
import { collectSitemapUrls, categorizeUrl, type UrlCategory } from "./parse";

/**
 * Sitemap scraper (patch-32, sitemap-diff signal). Resolves a competitor's root
 * sitemap (robots.txt `Sitemap:` directive → conventional paths), walks it
 * (index + .gz), and emits a DETERMINISTIC snapshot: the sorted URL list, one per
 * line. The generic snapshot→diff→change→classify pipeline then surfaces brand-new
 * (and removed) URLs as a change with zero sitemap-specific code in scrape-monitor.
 * Pure `fetch` (no browser, no cascade) — sitemaps are plain XML.
 */

const ROOT_PATHS = ["/sitemap.xml", "/sitemap_index.xml", "/sitemap-index.xml", "/sitemap.xml.gz"];
const MARKER = "outrival-sitemap";

async function fetchBytes(url: string): Promise<Uint8Array | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; OutrivalBot/1.0; +https://outrival.io)",
        accept: "application/xml, text/xml, */*",
      },
    });
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Sitemap URLs declared in robots.txt (`Sitemap: <url>`), best-effort. */
async function sitemapsFromRobots(origin: string): Promise<string[]> {
  const bytes = await fetchBytes(`${origin}/robots.txt`);
  if (!bytes) return [];
  const text = Buffer.from(bytes).toString("utf-8");
  const out: string[] = [];
  for (const m of text.matchAll(/^\s*sitemap:\s*(\S+)\s*$/gim)) {
    if (m[1]) out.push(m[1]);
  }
  return out;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildSnapshot(rootUrl: string, urls: string[]): ScrapeOutcome {
  // Category counts as a stable header — moves only when the mix changes.
  const counts = new Map<UrlCategory, number>();
  for (const u of urls) counts.set(categorizeUrl(u), (counts.get(categorizeUrl(u)) ?? 0) + 1);
  const summary = Array.from(counts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cat, n]) => `${cat}: ${n}`)
    .join(", ");

  // The diff-bearing body: one URL per line, already sorted → +/- lines map 1:1 to
  // added/removed pages.
  const list = urls.map((u) => `<li>${escapeHtml(u)}</li>`).join("");
  const json = JSON.stringify({ rootUrl, urls }).replace(/</g, "\\u003c");
  const html =
    `<!doctype html><html><body><section data-outrival-sitemap>` +
    `<h2>Sitemap — ${urls.length} URLs (${escapeHtml(summary)})</h2><ul>${list}</ul></section>` +
    `<script type="application/json" id="${MARKER}">${json}</script></body></html>`;

  return {
    html,
    text: `${summary}\n${urls.join("\n")}`,
    screenshotBuffer: Buffer.alloc(0),
    metadata: { url: rootUrl, scrapedWith: "sitemap", urlCount: urls.length },
    statusCode: 200,
    level: 0,
    attempts: 1,
  };
}

export async function scrape(
  _competitorId: string,
  url: string,
  _options: ScrapeOptions = {},
): Promise<ScrapeOutcome> {
  const origin = new URL(url).origin;
  const roots = [
    ...(await sitemapsFromRobots(origin)),
    ...ROOT_PATHS.map((p) => `${origin}${p}`),
  ];

  const tried = new Set<string>();
  for (const root of roots) {
    if (tried.has(root)) continue;
    tried.add(root);
    const urls = await collectSitemapUrls(root, { fetchBytes });
    if (urls.length > 0) return buildSnapshot(root, urls);
  }

  // No sitemap anywhere → throw so Trigger retries (and eventually marks the
  // monitor unscrapable) rather than writing an empty snapshot that the diff would
  // later read as "every URL removed".
  throw new Error("no_sitemap_found");
}
