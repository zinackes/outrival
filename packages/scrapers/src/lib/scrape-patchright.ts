/// <reference lib="dom" />
// page.evaluate() callbacks below run in the browser context (document/window).
// Patchright's types don't pull in the DOM lib the way Playwright's did, so we
// reference it explicitly — the root tsconfig is ES2022 only.
import { chromium, type Browser, type Page, type Response } from "patchright"; // drop-in stealth Playwright
import { patchrightLaunchOptions, type ProxyTier } from "./proxy";
import { realisticHeaders, OUTRIVAL_UA } from "./fingerprint";
import { navWaitUntil, settleAfterNav } from "./nav-strategy";
import { isCloudflareChallenge } from "./block-detection";
import { collapseAnimatedCounters } from "./normalize-text";
import { extractContent, isContentCollapsed } from "./extract-content";

// Cascade level a scrape was served from. 0/1 are free (no proxy); 2 uses the
// configured datacenter egress. Stored per monitor as `requiresLevel` once learned.
export type ScrapeLevel = 0 | 1 | 2;

export type FailureReason =
  | "blocked_403"
  | "blocked_503"
  | "cloudflare_challenge"
  | "soft_block"
  | "robots_disallowed" // robots.txt Disallows this path for OutrivalBot — a refusal
  | "needs_render" // HTML fetched but too little content → needs a browser (L0 → L1)
  | "http_error" // 4xx/5xx (not 403/503) — dead/invalid target, no render will fix it
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
  /**
   * Pricing only: after the primary capture, click the billing-period toggle
   * (Monthly ↔ Annual) and append the second period's prices as a compact block, so
   * the extractor sees BOTH periods (only the default state renders otherwise).
   * Best-effort and primary-capture-first — a failure never affects the snapshot.
   */
  captureBillingToggle?: boolean;
}

// Subresources safe to abort before they hit the (paid) proxy. media + font are
// never parsed and carry no anti-bot signal. Images add the BULK of proxy
// bandwidth on data scrapes (jobs/pricing/reviews) — block them too, EXCEPT when
// the scrape needs a screenshot (homepage pHash), which requires images to render.
// Stylesheets are deliberately NOT blocked: innerText (the soft-block detector)
// respects computed CSS, and CSS-blocking is a known anti-bot tell.
function blockedResourceTypes(options: PatchrightOptions): Set<string> {
  const types = new Set(["media", "font"]);
  if (!options.screenshot) types.add("image");
  return types;
}

// One browser per egress tier: direct and datacenter launch with different proxy
// configs, so they cannot share a single Chromium. Lazily launched, reused across
// scrapes within a worker run (the run is an isolated machine).
const browserByTier: Partial<Record<ProxyTier, Browser>> = {};

async function getBrowser(tier: ProxyTier): Promise<Browser> {
  const existing = browserByTier[tier];
  if (existing && existing.isConnected()) return existing;
  const browser = await chromium.launch(patchrightLaunchOptions(tier));
  browserByTier[tier] = browser;
  return browser;
}

/**
 * Close a single pooled tier browser. The cascade calls this on escalation so a
 * failed lower tier is freed before the next one launches — bounding peak RAM to
 * one browser instead of holding 3 Chromium resident through an L1→L3 escalation.
 */
export async function closeTierBrowser(tier: ProxyTier): Promise<void> {
  const browser = browserByTier[tier];
  if (!browser) return;
  delete browserByTier[tier];
  await browser.close().catch(() => {});
}

/**
 * Close every pooled Chromium browser and empty the pool. Contexts are always
 * closed per-scrape, but the browsers persist (deliberately, for intra-run reuse).
 * A run must call this in a finally so a long-lived worker process (pg-boss) does
 * not leak browsers across jobs. No-op for L0-only scrapes (pool never populated).
 */
export async function closePatchrightPool(): Promise<void> {
  const browsers = Object.entries(browserByTier);
  for (const [tier] of browsers) delete browserByTier[tier as ProxyTier];
  await Promise.all(browsers.map(([, b]) => b?.close().catch(() => {})));
}

/**
 * Scrape a page with a rendered browser through the given egress tier.
 *   "direct"      → L1 (no proxy, server IP)
 *   "datacenter"  → L2 (configured datacenter egress)
 * The render is identical across tiers — only the egress IP changes.
 */
export async function scrapeWithPatchright(
  url: string,
  tier: ProxyTier,
  options: PatchrightOptions = {},
): Promise<ScrapeResult> {
  const startedAt = Date.now();
  const browser = await getBrowser(tier);

  const context = await browser.newContext({
    userAgent: OUTRIVAL_UA,
    locale: "en-US",
    timezoneId: "America/New_York",
    viewport: { width: 1920, height: 1080 },
    extraHTTPHeaders: realisticHeaders(),
  });

  if (options.blockResources) {
    // Abort heavy subresources before they hit the (paid) proxy.
    const blocked = blockedResourceTypes(options);
    await context.route("**/*", (route) => {
      if (blocked.has(route.request().resourceType())) return route.abort();
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
 * Shared capture sequence for a navigated page: status guards, Cloudflare-
 * challenge + soft-block detection, optional progressive scroll, then
 * HTML/text/screenshot. Closing the context is the caller's responsibility.
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
  // Any other non-2xx/3xx status is a dead/invalid target — reject it so an error
  // page (a 404 "Not Found" shell) never lands as a successful snapshot. Needed at
  // the browser tiers too: sources that floor the cascade at L1 (jobs `render`,
  // homepage `screenshot`) skip L0's guard entirely, so without this a 404 careers /
  // pricing page would be captured and extracted as empty. 403/503 above keep their
  // block-specific reason (they escalate to a proxy); this one does not.
  if (statusCode >= 400)
    return { ok: false, statusCode, failureReason: "http_error", durationMs: Date.now() - startedAt };

  // Bounded settle for late content (F6) — only now that we know the page isn't a
  // hard block, so a 403/503 never pays the wait. No-op in legacy networkidle mode.
  await settleAfterNav(page);

  if (options.waitForSelector) {
    await page.waitForSelector(options.waitForSelector, { timeout: 10000 }).catch(() => {});
  }
  if (options.progressiveScroll) {
    // Best-effort: a scroll failure must not lose the capture we already have.
    await scrollThroughPage(page).catch(() => {});
    // Scrolling to the bottom mounts scroll-revealed sections that fetch their data
    // on intersection (client-rendered data widgets). Settle the network once more so
    // those in-flight requests resolve and the section renders before capture —
    // otherwise the section lands in some snapshots and not others, faking section
    // add/remove diffs downstream. Bounded + best-effort; no-op in networkidle mode.
    await settleAfterNav(page);
  }

  let html = await page.content();
  if (isCloudflareChallenge(html))
    return { ok: false, statusCode, failureReason: "cloudflare_challenge", durationMs: Date.now() - startedAt };

  // Pricing only: the primary capture above holds the DEFAULT billing period; the
  // other one (usually Annual) is behind a toggle that only re-renders on click. Now
  // that the snapshot is secured, best-effort click the toggle and append the second
  // period's prices as a small labeled block so the extractor sees both. Fully
  // guarded — any failure keeps the primary html exactly as-is.
  if (options.captureBillingToggle) {
    const annual = await captureBillingToggleBlock(page).catch(() => "");
    if (annual) html += annual;
  }

  // innerText ignores overflow clipping, so animated counter widgets (odometer &
  // co.) leak their full 0-9 digit ribbons into the text — strip them here.
  const text = collapseAnimatedCounters(await page.evaluate(() => document.body?.innerText ?? ""));
  // Only 2xx/3xx reach here (4xx/5xx rejected above), so a near-empty body now is a
  // soft-block returning a styled shell → escalate. (Previously gated on `=== 200`,
  // which let a tiny non-200 body slip through as a success.)
  //
  // `innerText` respects computed CSS, so it reads near-empty on real pages whose
  // copy lives in a <canvas>/WebGL hero or is kept CSS-hidden until a JS reveal
  // animation runs — both common on marketing homepages, neither a block. The
  // markup-based extractor the pipeline actually diffs (cheerio, no computed CSS)
  // isn't fooled by either, so cross-check it before escalating: a genuine block
  // serves a thin shell that's empty in the markup too, whereas these pages carry
  // the real text in the DOM. Only pay the parse in the rare near-empty branch.
  if (text.length < 100 && statusCode < 400 && isContentCollapsed(extractContent(html)))
    return { ok: false, statusCode, failureReason: "soft_block", durationMs: Date.now() - startedAt };

  // Screenshot only when asked (homepage pHash). For every other source it would
  // be rendered, buffered, uploaded to R2 and pHashed for nothing.
  // page.screenshot() already returns a Buffer — don't Buffer.from-copy the
  // 5-30 MB PNG a second time (it stays live through diff/DB/upload as it is).
  const screenshotBuffer = options.screenshot
    ? await page.screenshot({ fullPage: options.fullPage ?? true, type: "png" })
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

// Compact list of the price-bearing leaf lines currently visible on the page —
// the signature used to tell whether flipping the billing toggle actually changed
// the displayed prices.
async function priceLines(page: Page): Promise<string[]> {
  return page
    .evaluate(() => {
      const priceRe = /[€$£¥]\s?\d/;
      const out: string[] = [];
      const seen = new Set<string>();
      for (const el of Array.from(document.querySelectorAll("body *"))) {
        if (el.children.length > 3) continue; // leaf-ish only → "Pro $290/yr", not a whole card
        const t = (el.textContent ?? "").replace(/\s+/g, " ").trim();
        if (t.length < 2 || t.length > 120 || !priceRe.test(t)) continue;
        if (!seen.has(t)) {
          seen.add(t);
          out.push(t);
        }
      }
      return out.slice(0, 120);
    })
    .catch(() => [] as string[]);
}

/**
 * Best-effort: flip a pricing page's billing-period toggle to its non-default state
 * (Annual/Yearly) and return a compact, HIDDEN block of the price lines it then
 * shows — so htmlToText (extract-pricing) sees BOTH periods while extractContent
 * (hash/diff, which strips `[hidden]`) ignores it, so a flaky toggle never fakes a
 * pricing change. Restricted to real controls (button/switch/tab/radio/label, never
 * an <a> nav link) and discarded if the click navigates away, so it can only ever
 * ADD the alternate period's prices, never corrupt the primary capture. "" = no
 * toggle / nothing changed.
 */
async function captureBillingToggleBlock(page: Page): Promise<string> {
  const urlBefore = page.url();
  const before = await priceLines(page);

  const clicked = await page
    .evaluate(() => {
      const ANNUAL = /\b(annual|annually|yearly|per year|\/\s?yr|\/\s?year|billed\s+year)\b/i;
      const isOn = (el: Element) =>
        el.getAttribute("aria-checked") === "true" || el.getAttribute("aria-selected") === "true";
      const controls = Array.from(
        document.querySelectorAll('button,[role="switch"],[role="tab"],[role="radio"],label'),
      );
      // Prefer a control that names annual/yearly and isn't already the active one.
      for (const el of controls) {
        const t = (el.textContent ?? "").trim();
        if (!t || t.length > 40) continue;
        if (ANNUAL.test(t) && !isOn(el)) {
          (el as HTMLElement).click();
          return true;
        }
      }
      // Fallback: a bare switch/checkbox sitting between Monthly/Annual labels.
      if (ANNUAL.test(document.body?.innerText ?? "")) {
        const sw = document.querySelector('[role="switch"],input[type="checkbox"]');
        if (sw) {
          (sw as HTMLElement).click();
          return true;
        }
      }
      return false;
    })
    .catch(() => false);
  if (!clicked) return "";

  await page.waitForTimeout(700);
  // A navigation means we clicked a link, not a toggle — discard, keep only primary.
  if (page.url() !== urlBefore) return "";

  const after = await priceLines(page);
  const beforeSet = new Set(before);
  const fresh = after.filter((l) => !beforeSet.has(l));
  if (fresh.length === 0) return ""; // toggle did nothing visible → don't duplicate

  const block = fresh.slice(0, 60).join(" • ").replace(/[<>&]/g, " ");
  return `<div data-outrival-billing="alternate" hidden>${block}</div>`;
}
