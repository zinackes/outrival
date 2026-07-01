import type { ScrapeLevel } from "./lib/scrape-patchright";
import type { PlatformProfile } from "@outrival/shared";

export type { ScrapeLevel };

export interface ScraperResult {
  html: string;
  text: string;
  screenshotBuffer: Buffer;
  metadata: Record<string, unknown>;
  statusCode?: number;
  /** HTTP validators captured from the response, for conditional fetch. */
  etag?: string;
  lastModified?: string;
}

export interface ScrapeOptions {
  fullPage?: boolean;
  /**
   * Capture a screenshot during the browser scrape. Only the homepage needs it
   * (the patch-17 perceptual-hash visual-redesign detector); every other source
   * parses HTML/text, so leaving this off skips the PNG render + R2 upload + pHash
   * — pure CPU/storage savings. Default off.
   */
  screenshot?: boolean;
  /**
   * Abort heavy, never-parsed subresources (video/audio media + fonts) during the
   * browser scrape. Cuts residential proxy bandwidth (pay-per-GB) and load time.
   * Conservative subset — images/CSS are kept (anti-bot canaries + needed for the
   * homepage screenshot). Default off; enabled for data sources without a screenshot.
   */
  blockResources?: boolean;
  waitForSelector?: string;
  /**
   * Progressively scroll the page after networkidle to trigger lazy-loaded /
   * scroll-revealed content before capture (patch-16). Homepage-only.
   */
  progressiveScroll?: boolean;
  /**
   * Floor the cascade at L1 (browser render) even when L0 would have "succeeded".
   * Unlike `screenshot`, no PNG is captured — this is purely "L0's HTML is not
   * trustworthy for this page, render it". The jobs scraper uses it for careers /
   * board pages, whose openings are routinely injected client-side (a "Loading
   * open positions…" placeholder sits in the SSR HTML that L0's needs_render guard
   * accepts). Default off; L0 stays the norm for every other source.
   */
  render?: boolean;
  /**
   * Start the scraping cascade at this level instead of L0 (patch-20). Set from
   * the monitor's learned `requiresLevel` so a site known to need a proxy skips
   * the cheaper attempts. Levels 0/1 are free, 2/3/4 cost money.
   */
  knownLevel?: ScrapeLevel;
  /**
   * Cached platform profile (patch-31). When present, a scraper can route to a
   * structured connector — e.g. the jobs scraper hits the ATS API directly from
   * `platformProfile.ats` instead of discovering the careers page. Null/absent ⇒
   * exactly today's behaviour (the profile only ever optimises).
   */
  platformProfile?: PlatformProfile | null;
}

export interface ScrapeOutcome extends ScraperResult {
  /** Cascade level that served this result — learned per monitor for next run. */
  level: ScrapeLevel;
  /** Number of cascade attempts made before success (ops logging). */
  attempts: number;
}
