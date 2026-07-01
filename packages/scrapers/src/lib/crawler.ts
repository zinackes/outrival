// Thin adapter over the patch-20 scraping cascade. Preserves the public surface
// the source scrapers depend on — scrapePage / scrapeStatic / scrapeFirstSuccess
// returning a ScrapeOutcome (or throwing on total failure) — while delegating the
// actual fetch to the decoupled L0→L4 cascade in scrape-page.ts. Crawlee and
// ScrapingBee are gone; the browser is Patchright (stealth Chromium).
import { validatePublicUrl } from "@outrival/shared";
import { scrapePage as cascadeScrape, type CascadeOutcome } from "./scrape-page";
import { scrapeDirect } from "./scrape-direct";
import type { ScrapeLevel } from "./scrape-patchright";
import type { ScrapeOptions, ScrapeOutcome } from "../types";

/**
 * SSRF defense-in-depth: every source scraper funnels through scrapePage /
 * scrapeStatic, so a single host check here guards every monitor target — even
 * URLs that reached the DB without API-side validation (legacy rows, future
 * call sites). Syntactic only (no DNS), matching validatePublicUrl's contract;
 * a public domain whose A-record points at a private IP is still a residual gap
 * mitigated at the network egress layer. Throws so the run is logged as failed.
 */
function assertScrapableUrl(url: string): void {
  const safe = validatePublicUrl(url);
  if (!safe.ok) throw new Error(`unsafe_scrape_url: ${safe.error}`);
}

/**
 * Error thrown when the whole cascade was blocked. Carries the raw cascade
 * outcome (every attempt's status/reason/finalUrl) so the worker can run
 * `diagnoseFailure` (patch-23) in the same invocation — Trigger.dev's onFailure
 * only sees the message, so the rich data has to ride along here.
 */
export class ScrapeFailedError extends Error {
  constructor(
    message: string,
    public readonly cascadeOutcome: CascadeOutcome,
  ) {
    super(message);
    this.name = "ScrapeFailedError";
  }
}

const LEVEL_NAME: Record<ScrapeLevel, string> = {
  0: "direct",
  1: "patchright",
  2: "patchright-datacenter",
  3: "patchright-residential",
  4: "camoufox",
};

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Scrape a page through the full L0→L4 cascade. Throws (with the failure reason
 * as the message) when every enabled level was blocked, so existing scraper
 * error handling + friendlyScrapeError keep working.
 */
export async function scrapePage(
  url: string,
  options: ScrapeOptions = {},
): Promise<ScrapeOutcome> {
  assertScrapableUrl(url);
  const outcome = await cascadeScrape(url, {
    knownLevel: options.knownLevel,
    fullPage: options.fullPage,
    waitForSelector: options.waitForSelector,
    progressiveScroll: options.progressiveScroll,
    screenshot: options.screenshot,
    blockResources: options.blockResources,
    render: options.render,
  });

  if (!outcome.ok || outcome.level === null || !outcome.html) {
    throw new ScrapeFailedError(outcome.failureReason ?? "scraping_failed", outcome);
  }

  return {
    html: outcome.html,
    text: outcome.text ?? stripHtml(outcome.html),
    screenshotBuffer: outcome.screenshotBuffer ?? Buffer.alloc(0),
    metadata: { url: outcome.finalUrl ?? url, scrapedWith: LEVEL_NAME[outcome.level] },
    statusCode: outcome.statusCode,
    etag: outcome.etag ?? undefined,
    lastModified: outcome.lastModified ?? undefined,
    level: outcome.level,
    attempts: outcome.attempts.length,
  };
}

/**
 * Static (no JS) scrape — L0 fetch only. Used for SSR content (blog/changelog)
 * that isn't behind anti-bot. Throws on failure (e.g. a SPA that needs render).
 */
export async function scrapeStatic(url: string): Promise<ScrapeOutcome> {
  assertScrapableUrl(url);
  const r = await scrapeDirect(url);
  if (!r.ok || !r.html) throw new Error(r.failureReason ?? "static_scraping_failed");
  return {
    html: r.html,
    text: r.text ?? stripHtml(r.html),
    screenshotBuffer: Buffer.alloc(0),
    metadata: { url: r.finalUrl ?? url, scrapedWith: "direct" },
    statusCode: r.statusCode,
    etag: r.etag ?? undefined,
    lastModified: r.lastModified ?? undefined,
    level: 0,
    attempts: 1,
  };
}

/**
 * Try a list of candidate paths on a base URL.
 * Returns the first one that scrapes successfully (non-empty text).
 */
export async function scrapeFirstSuccess(
  baseUrl: string,
  candidatePaths: string[],
  scrapeFn: (u: string) => Promise<ScrapeOutcome>,
): Promise<ScrapeOutcome> {
  const base = new URL(baseUrl);
  let lastError: unknown;

  for (const path of candidatePaths) {
    const candidate = new URL(path, `${base.protocol}//${base.host}`).toString();
    try {
      const res = await scrapeFn(candidate);
      // A guessed path that 404s (many sites serve a full custom 404 / SPA shell
      // body, so `text.length` alone can't tell) is not a hit — skip it so the
      // caller can fall back instead of locking onto a non-existent page.
      if (res.statusCode && res.statusCode >= 400) continue;
      if (res.text.length > 50) return res;
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(
    `No candidate path succeeded for ${baseUrl} (tried ${candidatePaths.join(", ")}): ${String(lastError)}`,
  );
}
