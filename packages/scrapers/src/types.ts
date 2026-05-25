export interface ScraperResult {
  html: string;
  text: string;
  screenshotBuffer: Buffer;
  metadata: Record<string, unknown>;
  statusCode?: number;
}

export interface ScrapeOptions {
  fullPage?: boolean;
  waitForSelector?: string;
  /** If true, skip the direct attempt and go straight through the ScrapingBee proxy. */
  preferProxy?: boolean;
}

export interface ScrapeOutcome extends ScraperResult {
  usedProxy: boolean;
}
