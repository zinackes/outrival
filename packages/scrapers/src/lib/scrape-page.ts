import {
  scrapeWithPatchright,
  closeTierBrowser,
  closePatchrightPool,
  type PatchrightOptions,
  type ScrapeLevel,
  type ScrapeResult,
} from "./scrape-patchright";
import { scrapeDirect } from "./scrape-direct";
import { getProxyConfig, type ProxyTier } from "./proxy";
import { isAllowed, getCrawlDelayMs } from "./robots";
import { awaitDomainSlot } from "./rate-limit";

/**
 * Tear down every pooled render browser (Chromium tiers). A run that may have
 * rendered must call this in a finally so a long-lived worker process (pg-boss)
 * doesn't leak browsers across jobs. No-op when nothing was launched.
 */
export async function closeScraperBrowsers(): Promise<void> {
  await closePatchrightPool();
}

// A site that answers with any of these is REFUSING us. The collection doctrine
// stops there — a refusal is never escalated to a different IP or fingerprint.
// (needs_render is deliberately NOT here: it means "this page needs a JS render",
// not "you're not welcome", so it's the one thing that still escalates L0 → L1.)
const REFUSAL = new Set<string>([
  "blocked_403",
  "blocked_503",
  "cloudflare_challenge",
  "soft_block",
  "robots_disallowed",
]);

/** What the cascade does with one attempt's result (collection doctrine):
 *   done     — captured, stop.
 *   refused  — the site refused us (block/challenge/robots) → stop, no escalation.
 *   escalate — the page needs a JS render (needs_render) → try the render step.
 *   fail     — a transient/dead-target failure (http_error/network/timeout) → stop
 *              without escalating (a heavier tier won't fix it).
 * Exported so the doctrine's branching is unit-tested without touching the network. */
export type AttemptVerdict = "done" | "refused" | "escalate" | "fail";
export function verdictFor(r: { ok: boolean; failureReason?: string }): AttemptVerdict {
  if (r.ok) return "done";
  if (REFUSAL.has(r.failureReason ?? "")) return "refused";
  if (r.failureReason === "needs_render") return "escalate";
  return "fail";
}

export interface CascadeAttempt {
  level: ScrapeLevel;
  result: ScrapeResult;
}

export type CascadeOutcome = ScrapeResult & {
  level: ScrapeLevel | null;
  learnedLevel: ScrapeLevel | null;
  /** True when the site explicitly refused us (block/challenge/robots). Distinct
   * from a transient failure: a refusal marks the source, it is never retried or
   * escalated. */
  refused?: boolean;
  attempts: CascadeAttempt[];
  totalDurationMs: number;
};

export interface CascadeOptions extends PatchrightOptions {
  /** Start the cascade at this level (learned per monitor). Defaults to 0 (L0). */
  knownLevel?: ScrapeLevel;
  /**
   * Egress IP for this run, chosen UPSTREAM by the monitor (stability /
   * geolocation), never in reaction to a block. "datacenter" routes the render
   * through the configured datacenter proxy (reported as L2); "direct" (default)
   * uses the server IP. Degrades to direct when the datacenter proxy is
   * unconfigured or its kill-switch is off.
   */
  egressTier?: ProxyTier;
  /**
   * Floor the cascade at the render level without capturing a screenshot — for
   * pages whose L0 HTML can't be trusted (client-rendered listings). Like the
   * `screenshot` floor, but no PNG. See ScrapeOptions.render.
   */
  render?: boolean;
  /**
   * Capture a screenshot if — and only if — this run renders anyway. Never floors
   * the cascade. See ScrapeOptions.screenshotIfRendered.
   */
  screenshotIfRendered?: boolean;
}

/**
 * Scraping cascade (collection doctrine):
 *   L0 fetch direct · L1 browser render (direct) · L2 browser render (datacenter).
 * Only "needs a JS render" (needs_render) escalates L0 → the render step. A block,
 * challenge, or robots Disallow is a REFUSAL: the cascade stops and reports it,
 * never escalating to a different IP or fingerprint. The datacenter egress (L2) is
 * an upstream choice on the monitor, not a reaction to being blocked.
 */
export async function scrapePage(url: string, options: CascadeOptions = {}): Promise<CascadeOutcome> {
  const startedAt = Date.now();
  const attempts: CascadeAttempt[] = [];

  const done = (r: ScrapeResult, level: ScrapeLevel): CascadeOutcome => ({
    ...r,
    level,
    learnedLevel: level,
    attempts,
    totalDurationMs: Date.now() - startedAt,
  });
  const refused = (r: ScrapeResult): CascadeOutcome => ({
    ok: false,
    refused: true,
    failureReason: r.failureReason,
    statusCode: r.statusCode,
    durationMs: r.durationMs ?? 0,
    level: null,
    learnedLevel: null,
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

  // Collection doctrine: honour robots.txt BEFORE emitting any request on the page.
  // A Disallow is a refusal (surfaced distinctly in scrape-monitor), never escalated.
  if (!(await isAllowed(url))) {
    return refused({ ok: false, failureReason: "robots_disallowed", durationMs: 0 });
  }

  // Per-domain rate limit (courtesy): space out requests to the same registrable
  // domain, honouring a robots Crawl-delay when it's longer. One slot per logical
  // page visit — the L0→render escalation of one page is a single visit, not two hits.
  await awaitDomainSlot(url, await getCrawlDelayMs(url));

  // Egress is decided upstream, not by a block. Fall back to direct when the
  // datacenter proxy is unconfigured or killed, so a missing proxy degrades cleanly.
  const datacenterAvailable =
    process.env.SCRAPING_LEVEL_1_ENABLED !== "false" && getProxyConfig("datacenter") !== null;
  const effectiveEgress: ProxyTier =
    options.egressTier === "datacenter" && datacenterAvailable ? "datacenter" : "direct";
  const renderLevel: ScrapeLevel = effectiveEgress === "datacenter" ? 2 : 1;

  // A screenshot or a `render` request needs a rendered page — L0 (direct fetch)
  // never produces one, so floor at the render level. Datacenter egress always
  // renders (a plain fetch can't be routed through the proxy), so its floor is the
  // render level too. `start` is clamped to renderLevel so a stale knownLevel can't
  // skip past the only render step.
  const needsRenderFloor = !!(options.screenshot || options.render);
  const renderFloor: ScrapeLevel =
    effectiveEgress === "datacenter" ? renderLevel : needsRenderFloor ? 1 : 0;
  const start = Math.min(
    Math.max(options.knownLevel ?? 0, renderFloor),
    renderLevel,
  ) as ScrapeLevel;

  const browserOpts: PatchrightOptions = {
    fullPage: options.fullPage,
    waitForSelector: options.waitForSelector,
    progressiveScroll: options.progressiveScroll,
    // A conditional screenshot is indistinguishable from a requested one ONCE we
    // are in the browser — the difference is only whether it forced us in (the
    // render floor above ignores it). Setting it here also keeps images unblocked
    // (blockedResourceTypes reads this flag), so the capture renders faithfully.
    screenshot: options.screenshot || options.screenshotIfRendered,
    blockResources: options.blockResources,
    captureBillingToggle: options.captureBillingToggle,
    waitForStableContent: options.waitForStableContent,
    expandLists: options.expandLists,
  };

  // L0 — fetch HTTP direct (direct egress only; datacenter egress starts at the
  // render because a plain fetch can't be routed through the proxy).
  if (start <= 0) {
    const r = await scrapeDirect(url);
    attempts.push({ level: 0, result: r });
    const v = verdictFor(r);
    if (v === "done") return done(r, 0);
    if (v === "refused") return refused(r);
    if (v === "fail") return fail();
    // v === "escalate" (needs_render) → fall through to the render step.
  }

  // Render step — L1 (direct) or L2 (datacenter egress). Reached from an L0
  // needs_render, a screenshot/render floor, or a datacenter egress. A block here is
  // a refusal, not a reason to try a heavier tier (there is none).
  if (start <= renderLevel) {
    const r = await scrapeWithPatchright(url, effectiveEgress, browserOpts);
    attempts.push({ level: renderLevel, result: r });
    const v = verdictFor(r);
    if (v === "done") return done(r, renderLevel);
    await closeTierBrowser(effectiveEgress);
    if (v === "refused") return refused(r);
    return fail(); // escalate/fail are both terminal here — nothing above the render.
  }

  return fail();
}
