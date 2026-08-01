import { scrapePage } from "../lib/crawler";
import type { ScrapeOutcome, ScrapeOptions } from "../types";
import { discoverPricingUrl, discoverCommerceCandidates } from "./discover-url";
import { deriveProductLine, buildAggregatedDocument } from "./product-lines";
import { needsRenderRetry } from "./render-retry";

const PRICING_KEYWORDS = ["pricing", "tarifs", "plans", "tarification", "prix"];
// L3 cap: how many product pages a catalog contributes to the aggregated snapshot.
const MAX_PRODUCT_LINES = 3;
const AGGREGATE_ENABLED = process.env.PRICING_AGGREGATE_ENABLED !== "false";
const RENDER_RETRY_ENABLED = process.env.PRICING_RENDER_RETRY_ENABLED !== "false";

/**
 * Scrape a single pricing candidate, then — when the capture never saw a browser
 * (L0) and carries no harvestable price — re-scrape once with a browser render.
 * Catches client-rendered pricing pages that L0 accepts as a text-rich marketing
 * shell (see `needsRenderRetry`). If the render retry itself throws, that error
 * propagates (same failure semantics as any `scrapePage` call) rather than being
 * swallowed back to the L0 result, which would mask a block as a priceless success.
 */
async function scrapeWithRenderRetry(
  url: string,
  opts: ScrapeOptions,
): Promise<ScrapeOutcome> {
  const result = await scrapePage(url, opts);
  if (RENDER_RETRY_ENABLED && needsRenderRetry(result.html, result.level)) {
    return scrapePage(url, { ...opts, render: true });
  }
  return result;
}

export async function scrape(
  _competitorId: string,
  url: string,
  options: ScrapeOptions = {},
): Promise<ScrapeOutcome> {
  const knownLevel = options.knownLevel;
  // Pricing tables are commonly lazy-mounted / scroll-revealed (Framer `whileInView`
  // & co), so always scroll to reveal them before capture — on the dedicated page,
  // the homepage probe, and an embedded homepage section alike. captureBillingToggle
  // flips Monthly↔Annual after the primary capture so both periods are extracted
  // (kill-switch PRICING_TOGGLE_CAPTURE_ENABLED, default on; browser levels only).
  const opts = {
    blockResources: true,
    // A pricing page is the source where seeing the change beats reading it, and it
    // was the largest source with no capture at all (100 of 343 prod signals over 30
    // days, none of them renderable side by side). This never sends a scrape to the
    // browser — it keeps the PNG from the runs that already go there (render retry,
    // a learned requiresLevel, datacenter egress), which is 368 of 976 measured over
    // 14 days. Images stay unblocked on those runs so the capture is faithful.
    screenshotIfRendered: true,
    knownLevel,
    progressiveScroll: true,
    captureBillingToggle: process.env.PRICING_TOGGLE_CAPTURE_ENABLED !== "false",
    // P2 entitlements: pricing pages fold their feature matrix behind "See all
    // features" accordions — same append-style control the jobs path expands, so
    // the comparison table is in the DOM before capture. Browser renders only;
    // an L0 page already carries its accordion content in the static HTML.
    expandLists: true,
  };

  // URL already points at a pricing page → scrape it directly.
  if (PRICING_KEYWORDS.some((k) => url.toLowerCase().includes(k))) {
    return scrapeWithRenderRetry(url, opts);
  }

  // Otherwise scrape the homepage and locate the real pricing page from it.
  // Discover against the URL the homepage ACTUALLY resolved to (post-redirect), not
  // the stored monitor URL: an apex host like `codebenders.ai` 301s only its root to
  // `www.codebenders.ai` and hard-404s every sub-path, so resolving a relative
  // `/pricing` nav link against the pre-redirect apex yields a dead URL. `metadata.url`
  // is the final response URL.
  const homepage = await scrapePage(url, opts);
  const resolvedBase =
    (typeof homepage.metadata.url === "string" && homepage.metadata.url) || url;

  const candidate = await discoverPricingUrl(resolvedBase, homepage.html);
  // A real convention pricing page (`/pricing`, `/tarifs`, hub-drilled child) is
  // authoritative — use it and skip the catalog probes entirely.
  if (candidate && candidate.source === "direct") {
    return scrapeWithRenderRetry(candidate.url, opts);
  }

  // L3 catalog aggregation: hosting/e-commerce spreads pricing across product pages
  // / a store subdomain with no /pricing page. When ≥2 priced product pages exist,
  // capture the top-K and stitch them into ONE delimited snapshot so each becomes a
  // product-line row. Only reached when there was no convention pricing page.
  if (AGGREGATE_ENABLED) {
    const catalog = await discoverCommerceCandidates(resolvedBase, homepage.html);
    if (catalog.length >= 2) {
      const scraped: { line: string; page: ScrapeOutcome }[] = [];
      for (const c of catalog.slice(0, MAX_PRODUCT_LINES)) {
        const page = await scrapePage(c.url, opts).catch(() => null);
        if (page) scraped.push({ line: deriveProductLine(c.url, page.html), page });
      }
      if (scraped.length >= 2) {
        const base = scraped[0]!.page;
        return {
          ...base,
          html: buildAggregatedDocument(scraped.map((s) => ({ line: s.line, html: s.page.html }))),
          metadata: { ...base.metadata, url: resolvedBase, aggregatedLines: scraped.length },
          level: Math.max(...scraped.map((s) => s.page.level)) as ScrapeOutcome["level"],
          attempts: scraped.reduce((n, s) => n + s.page.attempts, 0),
        };
      }
    }
  }

  // Single best page (nav/footer link), or the homepage when pricing is embedded /
  // nothing was found (the extract-pricing harvest floor recovers visible prices).
  if (!candidate || candidate.source === "homepage_section") {
    // A client-rendered homepage with an embedded pricing widget is the same
    // failure shape as a dedicated page's — reuse the already-fetched capture.
    if (RENDER_RETRY_ENABLED && needsRenderRetry(homepage.html, homepage.level)) {
      return scrapePage(resolvedBase, { ...opts, render: true });
    }
    return homepage;
  }
  return scrapeWithRenderRetry(candidate.url, opts);
}
