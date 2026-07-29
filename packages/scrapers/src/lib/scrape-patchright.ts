/// <reference lib="dom" />
// page.evaluate() callbacks below run in the browser context (document/window).
// The root tsconfig is ES2022 only, so reference the DOM lib explicitly.
//
// Collection doctrine: the render browser is VANILLA Playwright Chromium — NOT a
// stealth fork. We render the JS a site serves us while announcing ourselves (the
// OutrivalBot User-Agent, navigator.webdriver left true); we do not disguise the
// crawler as a human. (Module + symbol names keep the historical "patchright"
// spelling to avoid a churny rename; the import below is the source of truth.)
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
  type Response,
} from "playwright";
import { browserLaunchOptions, type ProxyTier } from "./proxy";
import { realisticHeaders, OUTRIVAL_UA } from "./fingerprint";
import { navWaitUntil, settleAfterNav } from "./nav-strategy";
import { isCloudflareChallenge } from "./block-detection";
import { collapseAnimatedCounters } from "./normalize-text";
import { extractContent, isContentCollapsed } from "./extract-content";
import { EXPAND_LABEL, EXPAND_LABEL_MAX_CHARS } from "./expand-controls";

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
  /**
   * Hold the capture until the rendered DOM stops growing (bounded). For pages
   * whose CONTENT is fetched after hydration — a jobs board rendering its rows from
   * an XHR — `networkidle` is the wrong signal: analytics beacons and polling mean
   * it often never arrives, so the bounded settle expires and the shell is captured
   * with none of the rows. This keys on the only thing a snapshot cares about
   * instead. Default off; a page that is already static exits after one poll.
   */
  waitForStableContent?: boolean;
  /**
   * Click the list's own "Show more" / "Load more" control until it stops adding
   * rows (bounded). A paginated listing renders its FIRST page only — a Workable
   * board shows 10 of 56 — so the capture is a silent slice of the real list while
   * the page's own header still announces the full count. Default off; only the
   * jobs render path asks for it. See ScrapeOptions.expandLists.
   */
  expandLists?: boolean;
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
// configs, so they cannot share a single Chromium. Lazily launched and reused.
//
// This pool is process-global, and the process is no longer single-threaded: the
// pg-boss worker runs SCRAPE_CONCURRENCY scrapes at once (3 by default), where
// Trigger.dev gave each run its own machine. Everything below exists to make the
// pool safe under that concurrency.
const browserByTier: Partial<Record<ProxyTier, Browser>> = {};

// In-flight launches, so N concurrent callers share ONE Chromium instead of each
// launching their own and clobbering the map. The losers of that race were never
// reachable again — nothing held a handle to close them — so they stayed resident
// until the box ran out of memory, which is what a 180s `launch` timeout looks
// like from the inside.
const launchingByTier: Partial<Record<ProxyTier, Promise<Browser>>> = {};

// Ceilings for the pool operations Playwright leaves unbounded. `launch` takes its
// own timeout option, but prod showed a launch still reported at three minutes, so
// it is raced as well; `newContext` and `newPage` accept no timeout at all. Without
// these, a browser that is alive but no longer answering parks a render forever.
const LAUNCH_TIMEOUT_MS = 60_000;
const DEFAULT_POOL_OP_TIMEOUT_MS = 30_000;

// A render lease is a timestamp, not a counter. A counter only came back down if
// every render returned, so ONE render parked forever held both teardown guards
// below open for the life of the process: the dead browser stayed pooled, every
// later render parked on it too, and only a restart cleared it (measured on prod
// 2026-07-28 — 23h of uptime took throughput from ~800 jobs/h to 5). A lease older
// than the longest legitimate render is treated as abandoned, so the guards recover
// on their own even if a new way to hang turns up.
const DEFAULT_RENDER_LEASE_MAX_MS = 5 * 60_000;
const renderLeases = new Set<{ startedAt: number }>();
let closeRequested = false;

// Mutable only so the tests can reach the timeout paths without waiting out a
// 30s ceiling or a 5min lease. Nothing in the product ever writes these.
let poolOpTimeoutMs = DEFAULT_POOL_OP_TIMEOUT_MS;
let renderLeaseMaxMs = DEFAULT_RENDER_LEASE_MAX_MS;

/** Test-only: shrink the pool ceilings so their timeout paths run in milliseconds. */
export function __setPoolCeilingsForTest(ms: { poolOp: number; leaseMax: number } | null): void {
  poolOpTimeoutMs = ms?.poolOp ?? DEFAULT_POOL_OP_TIMEOUT_MS;
  renderLeaseMaxMs = ms?.leaseMax ?? DEFAULT_RENDER_LEASE_MAX_MS;
}

/** Live (non-abandoned) render leases, pruning stale ones as it counts. */
function liveRenders(): number {
  const cutoff = Date.now() - renderLeaseMaxMs;
  for (const lease of renderLeases) if (lease.startedAt < cutoff) renderLeases.delete(lease);
  return renderLeases.size;
}

/**
 * Reject if `promise` has not settled within `ms`. The rejection is named
 * TimeoutError so it lands on the same `failureReason: "timeout"` branch a
 * Playwright navigation timeout already does — no new case for the caller.
 *
 * The losing promise is NOT cancelled (nothing here can cancel it). A context that
 * arrives after its ceiling is orphaned, and the pool teardown closes its browser.
 * Freeing the lease is the point: an orphan costs memory, a held lease cost the
 * whole process.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ceiling = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`${label} exceeded ${ms}ms`);
      err.name = "TimeoutError";
      reject(err);
    }, ms);
  });
  return Promise.race([promise, ceiling]).finally(() => clearTimeout(timer));
}

async function getBrowser(tier: ProxyTier): Promise<Browser> {
  const existing = browserByTier[tier];
  if (existing && existing.isConnected()) return existing;
  const pending = launchingByTier[tier];
  if (pending) return pending;
  const launch = withTimeout(
    chromium.launch({ ...browserLaunchOptions(tier), timeout: LAUNCH_TIMEOUT_MS }),
    // Slightly above Playwright's own ceiling so its error wins in the normal case;
    // this outer race exists only to guarantee the promise settles, because an
    // unsettled launch is memoised in `launchingByTier` and every later caller is
    // handed that same never-resolving promise.
    LAUNCH_TIMEOUT_MS + 5_000,
    `chromium.launch(${tier})`,
  )
    .then((browser) => {
      browserByTier[tier] = browser;
      return browser;
    })
    .finally(() => {
      delete launchingByTier[tier];
    });
  launchingByTier[tier] = launch;
  return launch;
}

/**
 * Close a single pooled tier browser. The cascade calls this on escalation so a
 * failed lower tier is freed before the next one launches — bounding peak RAM to
 * one browser instead of holding 3 Chromium resident through an L1→L3 escalation.
 */
export async function closeTierBrowser(tier: ProxyTier): Promise<void> {
  const browser = browserByTier[tier];
  if (!browser) return;
  // Same hazard as closePatchrightPool: this fires BETWEEN two cascade levels of
  // one job, when that job holds no lease — but a concurrent job may be rendering
  // on this very browser. Leave it alone then; the RAM it saves is one Chromium,
  // the render it kills costs a failed scrape and a retry.
  if (liveRenders() > 0) return;
  delete browserByTier[tier];
  await browser.close().catch(() => {});
}

/**
 * Close every pooled Chromium browser and empty the pool. Contexts are always
 * closed per-scrape, but the browsers persist (deliberately, for reuse).
 * Every scrape calls this in a finally so a long-lived worker process (pg-boss)
 * does not leak browsers across jobs. No-op for L0-only scrapes (pool never
 * populated).
 *
 * DEFERRED while other renders are in flight. The pool is process-global and jobs
 * run concurrently, so an unconditional close tore the browser out from under the
 * scrapes still using it — the caller then saw "Target page, context or browser
 * has been closed", failed, retried, and relaunched, which is how three concurrent
 * scrapes managed less throughput than one. The last render out does the closing,
 * so the RAM intent survives and no live page is ever pulled.
 */
export async function closePatchrightPool(): Promise<void> {
  if (liveRenders() > 0) {
    closeRequested = true;
    return;
  }
  closeRequested = false;
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
  // Hold a lease on the process-global pool for the whole render — acquiring the
  // browser included, since a concurrent teardown between getBrowser and newPage
  // is exactly how "Target page, context or browser has been closed" happened.
  const lease = { startedAt: Date.now() };
  renderLeases.add(lease);
  try {
    return await renderWithPatchright(url, tier, options);
  } finally {
    renderLeases.delete(lease);
    // A sibling job asked for the pool while this render held it: last one out
    // does the closing it deferred.
    if (liveRenders() === 0 && closeRequested) await closePatchrightPool();
  }
}

async function renderWithPatchright(
  url: string,
  tier: ProxyTier,
  options: PatchrightOptions,
): Promise<ScrapeResult> {
  const startedAt = Date.now();
  // Acquiring the browser and opening the context/page are inside the try: each is
  // now bounded, so each can fail, and this function must return a ScrapeResult for
  // the cascade to reason about rather than throw out of it. `context` is declared
  // here only so the finally can close it when a later step is the one that fails.
  let context: BrowserContext | null = null;
  try {
    const browser = await getBrowser(tier);

    context = await withTimeout(
      browser.newContext({
        userAgent: OUTRIVAL_UA,
        locale: "en-US",
        timezoneId: "America/New_York",
        viewport: { width: 1920, height: 1080 },
        extraHTTPHeaders: realisticHeaders(),
      }),
      poolOpTimeoutMs,
      "browser.newContext",
    );

    if (options.blockResources) {
      // Abort heavy subresources before they hit the (paid) proxy.
      const blocked = blockedResourceTypes(options);
      await context.route("**/*", (route) => {
        if (blocked.has(route.request().resourceType())) return route.abort();
        return route.continue();
      });
    }

    const page = await withTimeout(context.newPage(), poolOpTimeoutMs, "context.newPage");
    const scriptUrls: string[] = [];
    page.on("response", (r) => {
      if (r.request().resourceType() === "script") scriptUrls.push(r.url());
    });

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
    await context?.close().catch(() => {});
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

  // Last chance for content that arrives after every network heuristic has given
  // up. Best-effort: a timeout here must never lose the page we already navigated.
  if (options.waitForStableContent) {
    await waitForStableContent(page).catch(() => {});
  }

  // A listing that paginates client-side has only its FIRST page in the DOM at this
  // point. Nothing above can see that: the shell settled, the rows arrived, the
  // capture looks complete — it just holds 10 of 56 openings. Click the list's own
  // "Show more" until it stops growing. Best-effort; a failure keeps the page we have.
  if (options.expandLists) {
    await expandPaginatedList(page).catch(() => {});
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

/**
 * Bounded wait until the rendered DOM stops growing (see PatchrightOptions
 * .waitForStableContent). Polls the body size and returns as soon as two
 * consecutive samples match, so a static page costs one poll interval and a board
 * that is still fetching its rows gets the time it needs — capped, never hanging.
 */
async function waitForStableContent(page: Page): Promise<void> {
  const pollMs = Number(process.env.SCRAPE_STABLE_POLL_MS ?? 500);
  const maxMs = Number(process.env.SCRAPE_STABLE_MAX_MS ?? 10000);
  const deadline = Date.now() + maxMs;
  let last = -1;
  while (Date.now() < deadline) {
    const size = await page.evaluate(() => document.body?.innerHTML.length ?? 0);
    if (size === last) return;
    last = size;
    await page.waitForTimeout(pollMs);
  }
}

/**
 * Expand a client-paginated list by clicking its own "Show more" control until it
 * stops adding rows (see PatchrightOptions.expandLists).
 *
 * Every click is validated by growth: the DOM has to be BIGGER afterwards or the
 * loop stops. That single rule is what keeps this safe on pages it wasn't meant
 * for — a "Show more" that expands a description fires once and turns into "Show
 * less"; a filter chip that happens to read "More" changes nothing and ends the
 * loop on its first pass. Anchors that would navigate are never clicked: leaving
 * the page would lose the capture entirely.
 *
 * Bounded twice (clicks and wall-clock) so an infinite-scroll list can't hold a
 * scrape open. Hitting the cap is not silent — extract-jobs compares what it
 * extracted against the count the page itself advertises and warns on a shortfall.
 */
async function expandPaginatedList(page: Page): Promise<void> {
  const maxClicks = Number(process.env.SCRAPE_EXPAND_MAX_CLICKS ?? 25);
  const maxMs = Number(process.env.SCRAPE_EXPAND_MAX_MS ?? 30000);
  const deadline = Date.now() + maxMs;

  for (let clicks = 0; clicks < maxClicks && Date.now() < deadline; clicks++) {
    const before = await page.evaluate(() => document.body?.innerHTML.length ?? 0);
    // The label rule is shared with isExpandControlLabel (unit-tested there) but has
    // to cross into the page as a string: nothing from this module exists in there.
    const clicked = await page.evaluate(({ source, maxLabel }) => {
      const re = new RegExp(source, "i");
      const candidates = Array.from(
        document.querySelectorAll<HTMLElement>(
          'button, [role="button"], a, input[type="button"], input[type="submit"]',
        ),
      );
      for (const el of candidates) {
        // An <a> with a real href navigates — that would replace the page we are
        // capturing. Only the "#"/JS-handler kind is a safe in-place control.
        if (el instanceof HTMLAnchorElement) {
          const href = el.getAttribute("href") ?? "";
          if (href && href !== "#" && !href.toLowerCase().startsWith("javascript:")) continue;
        }
        if ((el as HTMLButtonElement).disabled) continue;
        if (el.getAttribute("aria-disabled") === "true") continue;
        const rect = el.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) continue;
        if (getComputedStyle(el).visibility === "hidden") continue;
        const label = (
          el.innerText ||
          (el as HTMLInputElement).value ||
          el.getAttribute("aria-label") ||
          el.textContent ||
          ""
        )
          .replace(/\s+/g, " ")
          .trim();
        if (label.length === 0 || label.length > maxLabel || !re.test(label)) continue;
        el.scrollIntoView({ block: "center" });
        el.click();
        return true;
      }
      return false;
    }, { source: EXPAND_LABEL.source, maxLabel: EXPAND_LABEL_MAX_CHARS });
    if (!clicked) return;

    // The new rows arrive from an XHR, exactly like the first page did.
    await waitForStableContent(page).catch(() => {});
    const after = await page.evaluate(() => document.body?.innerHTML.length ?? 0);
    if (after <= before) return; // the control added nothing — it wasn't pagination
  }
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
  // Label the block. Unlabelled, the extractor saw a second set of bare amounts
  // with no way to tell which period they belong to — and a discounted per-month
  // rate ("$16") looks exactly like a cheaper monthly plan. The caption says which
  // toggle state produced them AND restates the canon, since these lines are the
  // usual source of the "/mo billed annually read as /yr" 12x error.
  const caption =
    "Prices shown with the ANNUAL billing option selected. A figure written per " +
    "month here is a per-month rate under a yearly commitment: its yearly price is " +
    "that figure multiplied by 12.";
  return `<div data-outrival-billing="alternate" hidden>${caption} ${block}</div>`;
}
