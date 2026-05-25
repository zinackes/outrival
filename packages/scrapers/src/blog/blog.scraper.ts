import { scrapeStatic, scrapeFirstSuccess } from "../lib/crawler";
import type { ScraperResult } from "../types";

const BLOG_PATHS = ["/blog", "/changelog", "/news", "/updates", "/posts"];

const BLOG_KEYWORDS = ["blog", "changelog", "news"];

export async function scrape(_competitorId: string, url: string): Promise<ScraperResult> {
  const lowered = url.toLowerCase();
  if (BLOG_KEYWORDS.some((k) => lowered.includes(k))) {
    return scrapeStatic(url);
  }
  return scrapeFirstSuccess(url, BLOG_PATHS, scrapeStatic);
}
