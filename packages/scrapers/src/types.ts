import type { ScrapeLevel } from "./lib/scrape-patchright";
import type { ProxyTier } from "./lib/proxy";
import type { PlatformProfile } from "@outrival/shared";

export type { ScrapeLevel };

export interface ScraperResult {
  html: string;
  text: string;
  screenshotBuffer: Buffer;
  metadata: Record<string, unknown>;
  statusCode?: number;
  /** HTTP validators captured from the response, for conditional fetch. */
  etag?: string;
  lastModified?: string;
}

export interface ScrapeOptions {
  fullPage?: boolean;
  /**
   * Capture a screenshot during the browser scrape. Only the homepage needs it
   * (the patch-17 perceptual-hash visual-redesign detector); every other source
   * parses HTML/text, so leaving this off skips the PNG render + R2 upload + pHash
   * — pure CPU/storage savings. Default off.
   */
  screenshot?: boolean;
  /**
   * Abort heavy, never-parsed subresources (video/audio media + fonts) during the
   * browser scrape. Cuts datacenter proxy bandwidth and load time.
   * Conservative subset — images/CSS are kept (anti-bot canaries + needed for the
   * homepage screenshot). Default off; enabled for data sources without a screenshot.
   */
  blockResources?: boolean;
  waitForSelector?: string;
  /**
   * Hold the browser capture until the rendered DOM stops growing (bounded). The
   * jobs scraper uses it on careers / board pages: their rows arrive from an XHR
   * after hydration, and on a page with constant analytics chatter `networkidle`
   * never fires, so the capture lands on the empty shell. Default off.
   */
  waitForStableContent?: boolean;
  /**
   * Progressively scroll the page after networkidle to trigger lazy-loaded /
   * scroll-revealed content before capture (patch-16). Homepage-only.
   */
  progressiveScroll?: boolean;
  /**
   * Pricing only: after the primary (default-period) capture, click the billing
   * toggle (Monthly ↔ Annual) and append the other period's prices as a hidden block
   * so the extractor sees both. Best-effort, primary-capture-first; only meaningful
   * at browser levels (where a click is possible). Default off. See the pricing
   * scraper's PRICING_TOGGLE_CAPTURE_ENABLED kill-switch.
   */
  captureBillingToggle?: boolean;
  /**
   * Click the listing's own "Show more" / "Load more" control until it stops adding
   * rows, before capture. A client-paginated board puts only its FIRST page in the
   * DOM — a Workable board shows 10 of 56 openings — and nothing downstream can tell
   * that slice apart from a complete list, so the roles past the fold were counted as
   * "not open". Bounded by clicks and wall-clock, growth-validated (a control that
   * adds nothing ends the loop), and best-effort: a failure keeps the capture as-is.
   * Default off; the jobs scraper enables it on the pages it commits to rendering.
   */
  expandLists?: boolean;
  /**
   * Floor the cascade at L1 (browser render) even when L0 would have "succeeded".
   * Unlike `screenshot`, no PNG is captured — this is purely "L0's HTML is not
   * trustworthy for this page, render it". The jobs scraper uses it for careers /
   * board pages, whose openings are routinely injected client-side (a "Loading
   * open positions…" placeholder sits in the SSR HTML that L0's needs_render guard
   * accepts). Default off; L0 stays the norm for every other source.
   */
  render?: boolean;
  /**
   * Start the scraping cascade at this level instead of L0. Set from the monitor's
   * learned `requiresLevel` so a site known to need a browser render skips the
   * cheaper attempt. Levels 0/1 are free; L2 uses the configured datacenter egress.
   */
  knownLevel?: ScrapeLevel;
  /**
   * Egress IP chosen UPSTREAM by the monitor (stability / geolocation), never a
   * reaction to a block. "datacenter" routes the render through the datacenter
   * proxy (reported as L2); "direct" (default) uses the server IP.
   */
  egressTier?: ProxyTier;
  /**
   * Cached platform profile (patch-31). When present, a scraper can route to a
   * structured connector — e.g. the jobs scraper hits the ATS API directly from
   * `platformProfile.ats` instead of discovering the careers page. Null/absent ⇒
   * exactly today's behaviour (the profile only ever optimises).
   */
  platformProfile?: PlatformProfile | null;
  /**
   * Competitor display name (hackernews source). The HN scraper is DB-free, so
   * scrape-monitor threads the real competitor name through — the anti-homonym
   * guard matches it against story titles. Falls back to the URL brand when absent.
   */
  competitorName?: string;
  /**
   * Whether the competitor name is a common word (hackernews source). Default
   * (undefined/true) = STRICT: an HN hit must carry the competitor domain in its
   * url. Only `false` — an explicit user confirmation on competitor.metadata that
   * the name is unambiguous — unlocks the name-in-title match. Ignored by every
   * other scraper.
   */
  ambiguousName?: boolean;
  /**
   * App Store reviews source only: the storefronts to iterate (2-letter country
   * codes). Set from `monitor.config.countries`; defaults to the country in the app
   * URL (or "us") when unset. Reviews from every listed storefront are merged,
   * deduped by id and sorted into one deterministic snapshot. Ignored by every
   * other scraper.
   */
  countries?: string[];
}

export interface ScrapeOutcome extends ScraperResult {
  /** Cascade level that served this result — learned per monitor for next run. */
  level: ScrapeLevel;
  /** Number of cascade attempts made before success (ops logging). */
  attempts: number;
}
