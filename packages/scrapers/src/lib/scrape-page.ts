import {
  scrapeWithPatchright,
  closeTierBrowser,
  closePatchrightPool,
  type PatchrightOptions,
  type ScrapeLevel,
  type ScrapeResult,
} from "./scrape-patchright";
import { scrapeDirect } from "./scrape-direct";
import { getProxyConfig } from "./proxy";
import { isAllowed } from "./robots";

/**
 * Tear down every pooled render browser (Chromium tiers). A run that may have
 * rendered must call this in a finally so a long-lived worker process (pg-boss)
 * doesn't leak browsers across jobs. No-op when nothing was launched.
 */
export async function closeScraperBrowsers(): Promise<void> {
  await closePatchrightPool();
}

// Failures that justify escalating to a more expensive level. A timeout /
// network error is NOT here: it's a transient/site problem, not a "this level is
// too weak" signal, so we let Trigger.dev retry the same level instead of burning
// proxy budget. needs_render means "L0 got HTML but no content" → go to L1.
// `http_error` (4xx/5xx that isn't a 403/503 block) is deliberately absent: a 404
// won't become a 200 at a higher tier, so the cascade fails fast instead.
const ESCALATING_FAILURES = new Set<string>([
  "blocked_403",
  "blocked_503",
  "cloudflare_challenge",
  "soft_block",
  "needs_render",
]);

export interface CascadeAttempt {
  level: ScrapeLevel;
  result: ScrapeResult;
}

export type CascadeOutcome = ScrapeResult & {
  level: ScrapeLevel | null;
  learnedLevel: ScrapeLevel | null;
  attempts: CascadeAttempt[];
  totalDurationMs: number;
};

export interface CascadeOptions extends PatchrightOptions {
  /** Start the cascade at this level (learned per monitor). Defaults to 0 (L0). */
  knownLevel?: ScrapeLevel;
  /**
   * Floor the cascade at L1 (browser render) without capturing a screenshot —
   * for pages whose L0 HTML can't be trusted (client-rendered listings). Like the
   * `screenshot` floor, but no PNG. See ScrapeOptions.render.
   */
  render?: boolean;
}

// The L0 failure was "needs a browser, not a different IP" (SPA shell / soft
// block) → L1 (Patchright, server IP). An IP/challenge failure instead means a
// reputation problem → skip L1 and go straight to the proxy levels.
function lastFailureNeedsBrowserNotProxy(attempts: CascadeAttempt[]): boolean {
  const reason = attempts[attempts.length - 1]?.result.failureReason;
  return reason === "needs_render" || reason === "soft_block";
}

// The datacenter egress is only useful if it's actually configured; without the
// proxy it would just repeat the direct attempt, so skip it.
function levelEnabled(envFlag: string, requiresDatacenter = false): boolean {
  if (process.env[envFlag] === "false") return false;
  if (requiresDatacenter && getProxyConfig("datacenter") === null) return false;
  return true;
}

/**
 * 3-level scraping cascade (collection doctrine):
 *   L0 fetch direct · L1 browser render direct · L2 browser + datacenter egress.
 * L1 escalates only when the page needs a JS render (needs_render). The datacenter
 * egress (L2) is chosen upstream by the monitor, never in reaction to a block.
 * `knownLevel` lets a monitor that already learned its level skip cheaper attempts.
 */
export async function scrapePage(url: string, options: CascadeOptions = {}): Promise<CascadeOutcome> {
  const startedAt = Date.now();
  const attempts: CascadeAttempt[] = [];

  // Collection doctrine: honour robots.txt BEFORE emitting any request on the page.
  // A Disallow is a refusal (surfaced distinctly in scrape-monitor), never escalated.
  if (!(await isAllowed(url))) {
    return {
      ok: false,
      failureReason: "robots_disallowed",
      durationMs: 0,
      level: null,
      learnedLevel: null,
      attempts,
      totalDurationMs: Date.now() - startedAt,
    };
  }
  // A screenshot can only come from a rendered page — L0 (direct fetch) never
  // produces one. When the caller asks for a screenshot (homepage, for the pHash
  // visual-redesign detector AND the before/after visual diff), floor the cascade
  // at L1 so a homepage that would otherwise win at L0 still gets a browser-
  // rendered capture. Homepage is not conditional-GET'd (it's a SPA, excluded from
  // CONDITIONAL_FETCH_SOURCES), so this browser render is paid on every homepage
  // scrape — which is exactly why it sits behind the HOMEPAGE_SCREENSHOT_ENABLED
  // kill-switch.
  const start = Math.max(
    options.knownLevel ?? 0,
    options.screenshot || options.render ? 1 : 0,
  ) as ScrapeLevel;
  const browserOpts: PatchrightOptions = {
    fullPage: options.fullPage,
    waitForSelector: options.waitForSelector,
    progressiveScroll: options.progressiveScroll,
    screenshot: options.screenshot,
    blockResources: options.blockResources,
    captureBillingToggle: options.captureBillingToggle,
  };

  const done = (r: ScrapeResult, level: ScrapeLevel): CascadeOutcome => ({
    ...r,
    level,
    learnedLevel: level,
    attempts,
    totalDurationMs: Date.now() - startedAt,
  });
  const fail = (): CascadeOutcome => {
    const last = attempts[attempts.length - 1]?.result;
    return {
      ok: false,
      failureReason: last?.failureReason,
      statusCode: last?.statusCode,
      durationMs: last?.durationMs ?? 0,
      level: null,
      learnedLevel: null,
      attempts,
      totalDurationMs: Date.now() - startedAt,
    };
  };

  // L0 — fetch HTTP direct, no proxy.
  if (start <= 0) {
    const r = await scrapeDirect(url);
    attempts.push({ level: 0, result: r });
    if (r.ok) return done(r, 0);
    if (!ESCALATING_FAILURES.has(r.failureReason ?? "")) return fail();
  }

  // L1 — Patchright, no proxy (server IP). Only when the prior failure means
  // "needs a browser", not an IP block (which would skip straight to proxies).
  if (start <= 1 && (start === 1 || attempts.length === 0 || lastFailureNeedsBrowserNotProxy(attempts))) {
    const r = await scrapeWithPatchright(url, "direct", browserOpts);
    attempts.push({ level: 1, result: r });
    if (r.ok) return done(r, 1);
    // Escalating past this tier — free its browser before the next one launches.
    await closeTierBrowser("direct");
    if (!ESCALATING_FAILURES.has(r.failureReason ?? "")) return fail();
  }

  // L2 — browser + datacenter egress.
  if (start <= 2 && levelEnabled("SCRAPING_LEVEL_1_ENABLED", true)) {
    const r = await scrapeWithPatchright(url, "datacenter", browserOpts);
    attempts.push({ level: 2, result: r });
    if (r.ok) return done(r, 2);
    await closeTierBrowser("datacenter");
    if (!ESCALATING_FAILURES.has(r.failureReason ?? "")) return fail();
  }

  return fail();
}
