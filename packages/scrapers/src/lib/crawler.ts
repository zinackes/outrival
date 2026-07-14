// Thin adapter over the scraping cascade. Preserves the public surface the source
// scrapers depend on — scrapePage / scrapeStatic / scrapeFirstSuccess returning a
// ScrapeOutcome (or throwing on total failure) — while delegating the actual fetch
// to the L0→L2 cascade in scrape-page.ts (L0 fetch · L1 browser render · L2 browser
// + datacenter egress). An explicit refusal (403/503/challenge/robots) is surfaced
// distinctly, never escalated.
import { validatePublicUrl } from "@outrival/shared";
import { scrapePage as cascadeScrape, type CascadeOutcome } from "./scrape-page";
import { scrapeDirect } from "./scrape-direct";
import { isAllowed } from "./robots";
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
  1: "browser",
  2: "browser-datacenter",
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
 * Scrape a page through the L0→L2 cascade. Throws (with the failure reason as the
 * message) when every enabled level was exhausted or the site refused us, so
 * existing scraper error handling + friendlyScrapeError keep working.
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
    captureBillingToggle: options.captureBillingToggle,
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
  // Collection doctrine: robots.txt is honoured on the static (L0) path too, before
  // any request touches the page.
  if (!(await isAllowed(url))) throw new Error("robots_disallowed");
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
 *
 * `accept` is an optional content gate: a path that fetches fine but whose CONTENT
 * isn't what we're after is skipped like a miss. This is what makes probing safe on a
 * client-routed SPA, where every path returns HTTP 200 with the app shell — status +
 * text-length alone can't tell `/careers` (real) from `/careers` (the SPA rendering
 * its home because that route doesn't exist). The jobs scraper passes a "looks like a
 * careers listing" gate; callers that omit it (blog, changelog) keep the old behaviour.
 */
export async function scrapeFirstSuccess(
  baseUrl: string,
  candidatePaths: string[],
  scrapeFn: (u: string) => Promise<ScrapeOutcome>,
  accept?: (res: ScrapeOutcome) => boolean,
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
      if (res.text.length <= 50) continue;
      if (accept && !accept(res)) continue;
      return res;
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(
    `No candidate path succeeded for ${baseUrl} (tried ${candidatePaths.join(", ")}): ${String(lastError)}`,
  );
}
