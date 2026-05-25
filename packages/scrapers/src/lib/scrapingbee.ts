import type { ScraperResult } from "../types";

const ENDPOINT = "https://app.scrapingbee.com/api/v1/";

/**
 * Fetch a page through ScrapingBee (browser-based proxy) and return a
 * ScraperResult. Used for anti-bot protected sources (G2, Capterra...).
 * No screenshot returned — use scrapingbeeScreenshot if needed.
 */
export async function scrapeViaScrapingBee(
  url: string,
  options: { renderJs?: boolean; premiumProxy?: boolean } = {},
): Promise<ScraperResult> {
  const apiKey = process.env.SCRAPINGBEE_API_KEY;
  if (!apiKey) throw new Error("SCRAPINGBEE_API_KEY is required for scrapeViaScrapingBee");

  const endpoint = new URL(ENDPOINT);
  endpoint.searchParams.set("api_key", apiKey);
  endpoint.searchParams.set("url", url);
  endpoint.searchParams.set("render_js", options.renderJs === false ? "false" : "true");
  if (options.premiumProxy) endpoint.searchParams.set("premium_proxy", "true");

  const res = await fetch(endpoint.toString());
  if (!res.ok) {
    throw new Error(`ScrapingBee fetch failed (${res.status}) for ${url}`);
  }
  const html = await res.text();

  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return {
    html,
    text,
    screenshotBuffer: Buffer.alloc(0),
    metadata: { url, scrapedWith: "scrapingbee" },
  };
}
