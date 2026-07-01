/// <reference lib="dom" />
// page.evaluate() callbacks below run in the browser context (document/window).
// Patchright's types don't pull in the DOM lib the way Playwright's did, so we
// reference it explicitly — the root tsconfig is ES2022 only.
import { chromium, type Browser, type Page, type Response } from "patchright"; // drop-in stealth Playwright
import { patchrightLaunchOptions, type ProxyTier } from "./proxy";
import { realisticHeaders, realisticUserAgent } from "./fingerprint";
import { navWaitUntil, settleAfterNav } from "./nav-strategy";
import { isCloudflareChallenge } from "./block-detection";
import { collapseAnimatedCounters } from "./normalize-text";

// Cascade level a scrape was served from (patch-20). 0/1 are free (no proxy),
// 2/3/4 cost money. Stored per monitor as `requiresLevel` once learned.
export type ScrapeLevel = 0 | 1 | 2 | 3 | 4;

export type FailureReason =
  | "blocked_403"
  | "blocked_503"
  | "cloudflare_challenge"
  | "soft_block"
  | "needs_render" // HTML fetched but too little content → needs a browser (L0 → L1)
  | "network_error"
  | "timeout";

export interface ScrapeResult {
  ok: boolean;
  html?: string;
  text?: string;
  statusCode?: number;
  finalUrl?: string;
  headers?: Record<string, string>;
  scriptUrls?: string[];
  screenshotBuffer?: Buffer;
  etag?: string | null;
  lastModified?: string | null;
  durationMs: number;
  failureReason?: FailureReason;
}

export interface PatchrightOptions {
  fullPage?: boolean;
  waitForSelector?: string;
  progressiveScroll?: boolean;
  /** Capture a screenshot (homepage pHash only). Default off — see ScrapeOptions. */
  screenshot?: boolean;
  /** Abort media + font subresources to save proxy bandwidth. Default off. */
  blockResources?: boolean;
}

// Never-parsed, heavy subresources that are safe to abort (no anti-bot signal,
// unlike CSS/images). Cuts residential pay-per-GB bandwidth on data scrapes.
const BLOCKED_RESOURCE_TYPES = new Set(["media", "font"]);

// One browser per proxy tier: datacenter and residential launch with different
// proxy configs, so they cannot share a single Chromium. Lazily launched, reused
// across scrapes within a worker run (the run is an isolated machine).
const browserByTier: Partial<Record<ProxyTier, Browser>> = {};

async function getBrowser(tier: ProxyTier): Promise<Browser> {
  const existing = browserByTier[tier];
  if (existing && existing.isConnected()) return existing;
  const browser = await chromium.launch(patchrightLaunchOptions(tier));
  browserByTier[tier] = browser;
  return browser;
}

/**
 * Scrape a page with Patchright (stealth Chromium) through the given proxy tier.
 *   "direct"      → L1 (no proxy, server IP)
 *   "datacenter"  → L2
 *   "residential" → L3
 * The browser fingerprint is identical across tiers — only the egress IP changes.
 */
export async function scrapeWithPatchright(
  url: string,
  tier: ProxyTier,
  options: PatchrightOptions = {},
): Promise<ScrapeResult> {
  const startedAt = Date.now();
  const browser = await getBrowser(tier);

  const context = await browser.newContext({
    userAgent: realisticUserAgent(),
    locale: "en-US",
    timezoneId: "America/New_York",
    viewport: { width: 1920, height: 1080 },
    extraHTTPHeaders: realisticHeaders(),
  });

  if (options.blockResources) {
    // Abort heavy never-parsed subresources before they hit the (paid) proxy.
    await context.route("**/*", (route) => {
      if (BLOCKED_RESOURCE_TYPES.has(route.request().resourceType())) return route.abort();
      return route.continue();
    });
  }

  const page = await context.newPage();
  const scriptUrls: string[] = [];
  page.on("response", (r) => {
    if (r.request().resourceType() === "script") scriptUrls.push(r.url());
  });

  try {
    const response = await page.goto(url, { waitUntil: navWaitUntil(), timeout: 30000 });
    if (!response) {
      return { ok: false, failureReason: "network_error", durationMs: Date.now() - startedAt };
    }
    return await capturePage(page, response, scriptUrls, options, startedAt);
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    return {
      ok: false,
      failureReason: name === "TimeoutError" ? "timeout" : "network_error",
      durationMs: Date.now() - startedAt,
    };
  } finally {
    await context.close().catch(() => {});
  }
}

/**
 * Shared capture sequence for a navigated Patchright page: status guards,
 * Cloudflare-challenge + soft-block detection, optional progressive scroll, then
 * HTML/text/screenshot. Exported for the Camoufox (L4) path, whose page is API-
 * compatible. Closing the context is the caller's responsibility.
 */
export async function capturePage(
  page: Page,
  response: Response,
  scriptUrls: string[],
  options: PatchrightOptions,
  startedAt: number,
): Promise<ScrapeResult> {
  const statusCode = response.status();
  if (statusCode === 403)
    return { ok: false, statusCode, failureReason: "blocked_403", durationMs: Date.now() - startedAt };
  if (statusCode === 503)
    return { ok: false, statusCode, failureReason: "blocked_503", durationMs: Date.now() - startedAt };

  // Bounded settle for late content (F6) — only now that we know the page isn't a
  // hard block, so a 403/503 never pays the wait. No-op in legacy networkidle mode.
  await settleAfterNav(page);

  if (options.waitForSelector) {
    await page.waitForSelector(options.waitForSelector, { timeout: 10000 }).catch(() => {});
  }
  if (options.progressiveScroll) {
    // Best-effort: a scroll failure must not lose the capture we already have.
    await scrollThroughPage(page).catch(() => {});
  }

  const html = await page.content();
  if (isCloudflareChallenge(html))
    return { ok: false, statusCode, failureReason: "cloudflare_challenge", durationMs: Date.now() - startedAt };

  // innerText ignores overflow clipping, so animated counter widgets (odometer &
  // co.) leak their full 0-9 digit ribbons into the text — strip them here.
  const text = collapseAnimatedCounters(await page.evaluate(() => document.body?.innerText ?? ""));
  if (text.length < 100 && statusCode === 200)
    return { ok: false, statusCode, failureReason: "soft_block", durationMs: Date.now() - startedAt };

  // Screenshot only when asked (homepage pHash). For every other source it would
  // be rendered, buffered, uploaded to R2 and pHashed for nothing.
  const screenshotBuffer = options.screenshot
    ? Buffer.from(await page.screenshot({ fullPage: options.fullPage ?? true, type: "png" }))
    : Buffer.alloc(0);
  const headers = response.headers();
  return {
    ok: true,
    html,
    text,
    statusCode,
    finalUrl: response.url(),
    headers,
    scriptUrls,
    screenshotBuffer,
    etag: headers["etag"] ?? null,
    lastModified: headers["last-modified"] ?? null,
    durationMs: Date.now() - startedAt,
  };
}

// Drive the page down in fixed steps to fire lazy-load / scroll-reveal handlers
// (IntersectionObserver, infinite-scroll hydration) that networkidle alone
// misses. Each pass waits HOMEPAGE_LAZY_WAIT_MS to settle, and ENDS at the bottom:
// resetting to the top before capture drops sections that mount on scroll and
// unmount on exit (Framer `whileInView` & co — e.g. an on-homepage pricing table).
// Gated by the caller (progressiveScroll); used by homepage + pricing.
async function scrollThroughPage(page: Page): Promise<void> {
  const passes = Number(process.env.HOMEPAGE_SCROLL_PASSES ?? 2);
  const waitMs = Number(process.env.HOMEPAGE_LAZY_WAIT_MS ?? 2000);

  for (let pass = 0; pass < passes; pass++) {
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => {
        const distance = 400;
        let last = -1;
        let stable = 0;
        let ticks = 0;
        const timer = setInterval(() => {
          window.scrollBy(0, distance);
          // Stop once scrollY stops advancing — the TRUE bottom, tolerant of lazy
          // content that keeps extending the height as we descend. (The old
          // accumulator-vs-scrollHeight exit fired early on pages whose height
          // grows mid-scroll, stranding the viewport above the lazy section.) The
          // tick cap bounds infinite-scroll pages.
          if (window.scrollY <= last) stable++;
          else stable = 0;
          last = window.scrollY;
          if (stable >= 3 || ++ticks > 150) {
            clearInterval(timer);
            resolve();
          }
        }, 150);
      });
    });
    await page.waitForTimeout(waitMs);
    // Reset to the top only BETWEEN passes (to re-trigger top-anchored reveals on
    // the next pass) — never after the last, so the capture happens at the bottom
    // with scroll-revealed sections still mounted.
    if (pass < passes - 1) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(500);
    }
  }
}
