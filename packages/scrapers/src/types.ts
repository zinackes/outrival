export interface ScraperResult {
  html: string;
  text: string;
  screenshotBuffer: Buffer;
  metadata: Record<string, unknown>;
}

export interface ScrapeOptions {
  fullPage?: boolean;
  waitForSelector?: string;
}
