import { PlaywrightCrawler, CheerioCrawler } from "crawlee";
import type { ScraperResult, ScrapeOptions } from "../types";

/**
 * Generic Playwright scrape — used for JS-heavy pages.
 * Returns the result; upload to R2 is the caller's responsibility (jobs).
 */
export async function scrapePage(
  url: string,
  options: ScrapeOptions = {},
): Promise<ScraperResult> {
  let result: ScraperResult | null = null;

  const crawler = new PlaywrightCrawler({
    maxRequestRetries: 3,
    maxConcurrency: 1,
    requestHandlerTimeoutSecs: 60,
    headless: true,
    async requestHandler({ page, request }) {
      await page.goto(request.url, { waitUntil: "networkidle", timeout: 45000 });
      if (options.waitForSelector) {
        await page.waitForSelector(options.waitForSelector, { timeout: 10000 }).catch(() => {});
      }

      const html = await page.content();
      const text = await page.evaluate(() => document.body?.innerText ?? "");
      const screenshotBuffer = await page.screenshot({
        fullPage: options.fullPage ?? true,
        type: "png",
      });

      result = {
        html,
        text,
        screenshotBuffer: Buffer.from(screenshotBuffer),
        metadata: { url: request.url, scrapedWith: "playwright" },
      };
    },
  });

  await crawler.run([url]);
  await crawler.teardown();

  if (!result) throw new Error(`Scraping failed for ${url}`);
  return result;
}

/**
 * Generic Cheerio scrape for static pages (no JS, no screenshot).
 */
export async function scrapeStatic(url: string): Promise<ScraperResult> {
  let result: ScraperResult | null = null;

  const crawler = new CheerioCrawler({
    maxRequestRetries: 3,
    maxConcurrency: 1,
    async requestHandler({ $, request, body }) {
      const html = typeof body === "string" ? body : body.toString("utf-8");
      const text = $("body").text().replace(/\s+/g, " ").trim();
      result = {
        html,
        text,
        screenshotBuffer: Buffer.alloc(0),
        metadata: { url: request.url, scrapedWith: "cheerio" },
      };
    },
  });

  await crawler.run([url]);
  await crawler.teardown();

  if (!result) throw new Error(`Static scraping failed for ${url}`);
  return result;
}

/**
 * Try a list of candidate paths on a base URL.
 * Returns the first one that scrapes successfully (non-empty text).
 */
export async function scrapeFirstSuccess(
  baseUrl: string,
  candidatePaths: string[],
  scrapeFn: (u: string) => Promise<ScraperResult>,
): Promise<ScraperResult> {
  const base = new URL(baseUrl);
  let lastError: unknown;

  for (const path of candidatePaths) {
    const candidate = new URL(path, `${base.protocol}//${base.host}`).toString();
    try {
      const res = await scrapeFn(candidate);
      if (res.text.length > 50) return res;
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(
    `No candidate path succeeded for ${baseUrl} (tried ${candidatePaths.join(", ")}): ${String(lastError)}`,
  );
}
