import {
  scrapeWithPatchright,
  type PatchrightOptions,
  type ScrapeLevel,
  type ScrapeResult,
} from "./scrape-patchright";
import { scrapeDirect } from "./scrape-direct";
import { scrapeWithCamoufox } from "./scrape-camoufox";
import { getProxyConfig } from "./proxy";

// Failures that justify escalating to a more expensive level. A timeout /
// network error is NOT here: it's a transient/site problem, not a "this level is
// too weak" signal, so we let Trigger.dev retry the same level instead of burning
// proxy budget. needs_render means "L0 got HTML but no content" → go to L1.
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
}

// The L0 failure was "needs a browser, not a different IP" (SPA shell / soft
// block) → L1 (Patchright, server IP). An IP/challenge failure instead means a
// reputation problem → skip L1 and go straight to the proxy levels.
function lastFailureNeedsBrowserNotProxy(attempts: CascadeAttempt[]): boolean {
  const reason = attempts[attempts.length - 1]?.result.failureReason;
  return reason === "needs_render" || reason === "soft_block";
}

// A paid/experimental level is only useful if it changes the egress IP. Without
// the proxy configured it would just repeat the direct attempt, so skip it.
function levelEnabled(envFlag: string, requiresResidential = false, requiresDatacenter = false): boolean {
  if (process.env[envFlag] === "false") return false;
  if (requiresDatacenter && getProxyConfig("datacenter") === null) return false;
  if (requiresResidential && getProxyConfig("residential") === null) return false;
  return true;
}

/**
 * Decoupled 5-level scraping cascade (patch-20). Fingerprint and IP reputation
 * are escalated separately, cheapest first:
 *   L0 fetch direct · L1 Patchright direct · L2 Patchright+datacenter ·
 *   L3 Patchright+residential · L4 Camoufox+residential.
 * Escalates only on a blocking failure (not on timeout). `knownLevel` lets a
 * monitor that already learned its level skip the cheaper attempts.
 */
export async function scrapePage(url: string, options: CascadeOptions = {}): Promise<CascadeOutcome> {
  const startedAt = Date.now();
  const attempts: CascadeAttempt[] = [];
  // A screenshot can only come from a rendered page — L0 (direct fetch) never
  // produces one. When the caller asks for a screenshot (homepage, for the pHash
  // visual-redesign detector AND the before/after visual diff), floor the cascade
  // at L1 so a homepage that would otherwise win at L0 still gets a browser-
  // rendered capture. The conditional-GET pre-flight upstream still short-circuits
  // unchanged pages, so the browser cost is only paid on a real (or validator-
  // less) change.
  const start = Math.max(
    options.knownLevel ?? 0,
    options.screenshot ? 1 : 0,
  ) as ScrapeLevel;
  const browserOpts: PatchrightOptions = {
    fullPage: options.fullPage,
    waitForSelector: options.waitForSelector,
    progressiveScroll: options.progressiveScroll,
    screenshot: options.screenshot,
    blockResources: options.blockResources,
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
    if (!ESCALATING_FAILURES.has(r.failureReason ?? "")) return fail();
  }

  // L2 — Patchright + datacenter.
  if (start <= 2 && levelEnabled("SCRAPING_LEVEL_1_ENABLED", false, true)) {
    const r = await scrapeWithPatchright(url, "datacenter", browserOpts);
    attempts.push({ level: 2, result: r });
    if (r.ok) return done(r, 2);
    if (!ESCALATING_FAILURES.has(r.failureReason ?? "")) return fail();
  }

  // L3 — Patchright + residential.
  if (start <= 3 && levelEnabled("SCRAPING_LEVEL_2_ENABLED", true)) {
    const r = await scrapeWithPatchright(url, "residential", browserOpts);
    attempts.push({ level: 3, result: r });
    if (r.ok) return done(r, 3);
    if (!ESCALATING_FAILURES.has(r.failureReason ?? "")) return fail();
  }

  // L4 — Camoufox + residential (Chromium fingerprint detected, rare).
  if (levelEnabled("SCRAPING_LEVEL_3_ENABLED", true)) {
    const r = await scrapeWithCamoufox(url, browserOpts);
    attempts.push({ level: 4, result: r });
    if (r.ok) return done(r, 4);
  }

  return fail();
}
