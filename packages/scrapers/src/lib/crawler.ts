import { PlaywrightCrawler, CheerioCrawler } from "crawlee";
import type { ScrapingBeeTier } from "@outrival/shared";
import { scrapeViaScrapingBee } from "./scrapingbee";
import type { ScraperResult, ScrapeOptions, ScrapeOutcome } from "../types";

const PREMIUM_TIER: ScrapingBeeTier = { renderJs: true, premiumProxy: true };

interface RunCrawlerOptions {
  useProxy: boolean;
  fullPage?: boolean;
  waitForSelector?: string;
  proxyTier?: ScrapingBeeTier;
}

function looksBlocked(html: string, statusCode?: number): boolean {
  if (statusCode === 403 || statusCode === 429 || statusCode === 503) return true;
  if (html.trim().length < 500) return true;
  const lower = html.toLowerCase();
  return (
    lower.includes("captcha") ||
    lower.includes("cf-challenge") ||
    lower.includes("attention required") ||
    lower.includes("access denied") ||
    lower.includes("just a moment")
  );
}

async function runCrawler(url: string, opts: RunCrawlerOptions): Promise<ScraperResult> {
  if (opts.useProxy) {
    const tier = opts.proxyTier ?? PREMIUM_TIER;
    return scrapeViaScrapingBee(url, {
      renderJs: tier.renderJs,
      premiumProxy: tier.premiumProxy,
    });
  }

  let result: ScraperResult | null = null;

  const crawler = new PlaywrightCrawler({
    maxRequestRetries: 3,
    maxConcurrency: 1,
    requestHandlerTimeoutSecs: 60,
    headless: true,
    launchContext: {
      launchOptions: {
        args: [
          "--disable-dev-shm-usage", // /dev/shm tiny under WSL → otherwise swap/crash
          "--disable-gpu",
          "--no-sandbox",
          // Hide the `navigator.webdriver` automation tell at the browser level
          // (cheapest anti-bot win) — Crawlee already injects human-like
          // fingerprints + headers by default, so the free path stays robust and
          // we fall back to paid ScrapingBee less often.
          "--disable-blink-features=AutomationControlled",
          // single-process slashes Chromium RAM but can break JS-heavy pages,
          // so it's dev-only — prod (Trigger.dev cloud) keeps the default model.
          ...(process.env.NODE_ENV !== "production" ? ["--single-process"] : []),
        ],
      },
    },
    async requestHandler({ page, request, response }) {
      await page.goto(request.url, { waitUntil: "networkidle", timeout: 45000 });
      if (opts.waitForSelector) {
        await page
          .waitForSelector(opts.waitForSelector, { timeout: 10000 })
          .catch(() => {});
      }

      const html = await page.content();
      const text = await page.evaluate(() => document.body?.innerText ?? "");
      const screenshotBuffer = await page.screenshot({
        fullPage: opts.fullPage ?? true,
        type: "png",
      });

      const respHeaders = response?.headers();
      result = {
        html,
        text,
        screenshotBuffer: Buffer.from(screenshotBuffer),
        metadata: { url: request.url, scrapedWith: "playwright" },
        statusCode: response?.status(),
        etag: respHeaders?.["etag"],
        lastModified: respHeaders?.["last-modified"],
      };
    },
  });

  await crawler.run([url]);
  await crawler.teardown();

  if (!result) throw new Error(`Scraping failed for ${url}`);
  return result;
}

/**
 * Direct-first scrape of a JS-heavy page. Falls back to ScrapingBee when
 * the direct attempt looks blocked. Set `preferProxy: true` to skip the
 * direct attempt entirely (e.g. for sites already known to be protected).
 */
export async function scrapePage(
  url: string,
  options: ScrapeOptions = {},
): Promise<ScrapeOutcome> {
  if (options.preferProxy) {
    const result = await runCrawler(url, {
      useProxy: true,
      fullPage: options.fullPage,
      waitForSelector: options.waitForSelector,
      proxyTier: options.proxyTier,
    });
    return { ...result, usedProxy: true };
  }

  try {
    const result = await runCrawler(url, {
      useProxy: false,
      fullPage: options.fullPage,
      waitForSelector: options.waitForSelector,
    });
    if (!looksBlocked(result.html, result.statusCode)) {
      return { ...result, usedProxy: false };
    }
  } catch {
    // direct attempt failed → fall through to proxy
  }

  const result = await runCrawler(url, {
    useProxy: true,
    fullPage: options.fullPage,
    waitForSelector: options.waitForSelector,
    proxyTier: options.proxyTier,
  });
  return { ...result, usedProxy: true };
}

/**
 * Static (no JS) scrape. Always direct — no proxy fallback because Cheerio
 * pages are typically blog/changelog content not behind anti-bot.
 */
export async function scrapeStatic(url: string): Promise<ScrapeOutcome> {
  let result: ScraperResult | null = null;

  const crawler = new CheerioCrawler({
    maxRequestRetries: 3,
    maxConcurrency: 1,
    async requestHandler({ $, request, body, response }) {
      const html = typeof body === "string" ? body : body.toString("utf-8");
      const text = $("body").text().replace(/\s+/g, " ").trim();
      const etagHeader = response?.headers?.["etag"];
      const lastModifiedHeader = response?.headers?.["last-modified"];
      result = {
        html,
        text,
        screenshotBuffer: Buffer.alloc(0),
        metadata: { url: request.url, scrapedWith: "cheerio" },
        statusCode: response?.statusCode,
        etag: typeof etagHeader === "string" ? etagHeader : undefined,
        lastModified: typeof lastModifiedHeader === "string" ? lastModifiedHeader : undefined,
      };
    },
  });

  await crawler.run([url]);
  await crawler.teardown();

  const captured = result as ScraperResult | null;
  if (!captured) throw new Error(`Static scraping failed for ${url}`);
  return { ...captured, usedProxy: false };
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
      if (res.text.length > 50) return res;
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(
    `No candidate path succeeded for ${baseUrl} (tried ${candidatePaths.join(", ")}): ${String(lastError)}`,
  );
}
