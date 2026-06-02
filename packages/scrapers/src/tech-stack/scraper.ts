import * as cheerio from "cheerio";
import type { TechStackInput } from "./detector";

export interface TechStackEvidence extends TechStackInput {
  statusCode: number;
}

// Plain GET — no Playwright/Crawlee/ScrapingBee. Tech detection lives in the
// initial HTML (script tags, footer) and the response headers, which a native
// fetch returns for free. This keeps the tech-stack scraper fully independent
// of the homepage pipeline and zero-cost (no paid proxy). A site that blocks
// plain fetch (Cloudflare challenge, 403) yields degraded detection that month
// — acceptable; we still capture e.g. the cf-ray header on the challenge page.
const FETCH_TIMEOUT_MS = 15000;
const USER_AGENT =
  "Mozilla/5.0 (compatible; OutrivalBot/1.0; +https://outrival.io/bot)";

/**
 * Fetch a page and return the evidence the detector needs: raw HTML, lower-cased
 * response headers, and the list of `<script src>` URLs. Returns null on a
 * network error or a non-2xx status (the caller treats /integrations 404 etc. as
 * "no evidence", not an error).
 */
export async function fetchTechStackEvidence(
  url: string,
): Promise<TechStackEvidence | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
    });
    if (!res.ok) return null;

    const html = await res.text();

    // Header names are case-insensitive; fetch already lower-cases them, but
    // normalise defensively so detectors can index by lower-case name.
    const responseHeaders: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      responseHeaders[key.toLowerCase()] = value;
    });

    return {
      url: res.url || url, // res.url = final URL after redirects
      html,
      responseHeaders,
      scriptUrls: extractScriptUrls(html, res.url || url),
      statusCode: res.status,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Extract `<script src>` URLs from HTML, resolving relative/protocol-relative
 * srcs against the page URL so CDN host patterns match regardless of how the src
 * was written. Falls back to the raw src when resolution fails.
 */
export function extractScriptUrls(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const urls = new Set<string>();
  $("script[src]").each((_, el) => {
    const src = $(el).attr("src");
    if (!src) return;
    try {
      urls.add(new URL(src, baseUrl).toString());
    } catch {
      urls.add(src);
    }
  });
  return [...urls];
}
