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
  waitForSelector?: string;
  /**
   * Progressively scroll the page after networkidle to trigger lazy-loaded /
   * scroll-revealed content before capture (patch-16). Homepage-only.
   */
  progressiveScroll?: boolean;
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
