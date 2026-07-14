// Pure sitemap parsing + fetch-injectable collection — AI-free. Imported by
// workers via the "@outrival/scrapers/sitemap" subpath.
export {
  parseSitemap,
  collectSitemapUrls,
  categorizeUrl,
  sitemapBytesToText,
  // sitemap v2 — JSON-island round-trip + competitor comparison-page detection.
  parseSitemapDoc,
  isComparisonUrl,
  slugMentionsBrand,
  classifyComparisonUrl,
  SITEMAP_DOC_MARKER,
  type ParsedSitemap,
  type UrlCategory,
  type CollectOptions,
  type ComparisonSignal,
} from "./parse";
