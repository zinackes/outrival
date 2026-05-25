import * as homepage from "./homepage/homepage.scraper";
import * as pricing from "./pricing/pricing.scraper";
import * as blog from "./blog/blog.scraper";
import type { SourceType } from "@outrival/shared";
import type { ScraperResult } from "./types";

type ScraperFn = (competitorId: string, url: string) => Promise<ScraperResult>;

const scrapers: Partial<Record<SourceType, ScraperFn>> = {
  homepage: homepage.scrape,
  pricing: pricing.scrape,
  blog: blog.scrape,
};

export function getScraper(sourceType: SourceType): ScraperFn {
  const scraper = scrapers[sourceType];
  if (!scraper) throw new Error(`No scraper for source type: ${sourceType}`);
  return scraper;
}

export type { ScraperResult } from "./types";
