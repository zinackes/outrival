import type { ScrapingBeeTier } from "@outrival/shared";

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
  /** If true, skip the direct attempt and go straight through the ScrapingBee proxy. */
  preferProxy?: boolean;
  /**
   * ScrapingBee tier to use when (and only when) the proxy fallback fires.
   * Lets cheaper sources (jobs ATS) skip the premium proxy. Defaults to the
   * premium tier when omitted.
   */
  proxyTier?: ScrapingBeeTier;
}

export interface ScrapeOutcome extends ScraperResult {
  usedProxy: boolean;
}
