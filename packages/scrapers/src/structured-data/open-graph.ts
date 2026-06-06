import * as cheerio from "cheerio";

/**
 * OpenGraph / Twitter-card / standard meta extraction (patch-30, structured-first).
 * Geo/language-agnostic page identity — used to seed the homepage structure and the
 * self-product profile without an AI call. Pure cheerio (no browser).
 */
export interface OpenGraphData {
  title: string | null;
  description: string | null;
  siteName: string | null;
  type: string | null;
  image: string | null;
}

export function extractOpenGraph(html: string): OpenGraphData {
  const $ = cheerio.load(html);
  const pick = (...selectors: string[]): string | null => {
    for (const sel of selectors) {
      const v = $(sel).attr("content")?.trim();
      if (v) return v;
    }
    return null;
  };

  return {
    title:
      pick('meta[property="og:title"]', 'meta[name="twitter:title"]') ??
      ($("title").first().text().trim() || null),
    description: pick(
      'meta[property="og:description"]',
      'meta[name="twitter:description"]',
      'meta[name="description"]',
    ),
    siteName: pick('meta[property="og:site_name"]'),
    type: pick('meta[property="og:type"]'),
    image: pick('meta[property="og:image"]', 'meta[name="twitter:image"]'),
  };
}
