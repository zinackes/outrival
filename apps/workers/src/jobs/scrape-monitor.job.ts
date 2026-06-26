import { task, logger, tasks, AbortTaskRunError } from "@trigger.dev/sdk/v3";
import { z } from "zod";
import { and, count, desc, eq, gte } from "drizzle-orm";
import {
  db,
  monitors,
  competitors,
  organizations,
  snapshots,
  changes,
  volatileLines,
  monitorAlternatives,
  forcedRescanLog,
} from "@outrival/db";
import {
  clampFrequencyToPlan,
  computeHash,
  computeNextRun,
  computeTextDiff,
  uploadToR2,
  getFromR2,
  supportsConditionalFetch,
  detectPricingRepositioning,
  isReviewSource,
  type PricingStatus,
  type PricingRepositioning,
  type PlatformProfile,
} from "@outrival/shared";
// Pure subpath — pulls only the heuristic, never the groq/anthropic SDKs.
import { evaluateSignificance } from "@outrival/ai/significance";
// Pure subpath — cheerio only, never crawlee/playwright.
import { analyzePricingHtml, type PricingAnalysis } from "@outrival/scrapers/pricing";
// Pure subpath — cheerio only. Diff/hash on extracted visible content, not raw
// HTML, so CSS-in-JS hashes / SVG paths / hydration scripts don't fake changes.
import { extractContent, isContentCollapsed } from "@outrival/scrapers/extract";
// Pure subpaths — cheerio only. Semantic structure + structural diff for homepage
// monitors (patch-16). Replaces the lexical diff for homepages only.
import {
  parseHomepageStructure,
  type HomepageStructure,
} from "@outrival/scrapers/homepage-structure";
import { diffHomepages, renderStructuredChanges } from "@outrival/scrapers/homepage-diff";
// Pure subpath — sharp only. Perceptual hash for visual-redesign detection (patch-17).
import {
  computePerceptualHash,
  hammingDistance,
  phashToHex,
  phashFromHex,
} from "@outrival/scrapers/phash";
// Pure subpath — regex only. Quantified homepage claims (patch-17).
import { extractNumericClaims } from "@outrival/scrapers/numeric-claims";
// Pure subpath — string logic only. Stable testimonial add/remove (patch-17).
import { diffTestimonialsStable } from "@outrival/scrapers/social-proof";
// Pure subpath — composite relevance score to silence low-impact changes (patch-17).
import { scoreRelevance } from "@outrival/scrapers/relevance";
// Pure subpath — median anti-void guard (patch-17).
import { checkAntiVoid } from "@outrival/scrapers/anti-void";
// Pure subpath — per-monitor volatile-line learning (patch-17).
import { computeVolatileUpdates, filterVolatileLines } from "@outrival/scrapers/volatile";
import { diagnoseFailure, type AttemptInfo, type FailureCategory } from "@outrival/scrapers/diagnose-failure";
import { generateAlternatives } from "@outrival/scrapers/alternatives";
import { filterRelevantApiCalls, apiCallsToHtmlDoc, toEndpoints } from "@outrival/scrapers/spa-filter";
import type { ScrapeOutcome } from "@outrival/scrapers";
import {
  logScrapeRun,
  insertNumericClaims,
  getLastNumericClaims,
} from "../lib/analytics";
import { scrapeMonitorQueue } from "../lib/scrape-queues";

const SCRAPER_REGION = process.env.SCRAPER_REGION ?? "FR";

// patch-17 — Hamming distance above which a homepage screenshot counts as a
// visual redesign (when little structural change accompanies it).
const PHASH_THRESHOLD = Number(process.env.ENRICHMENTS_PHASH_THRESHOLD ?? 15);

// patch-17 — fractional change in a tracked numeric claim ("15,000 → 50,000
// teams") above which it counts as a business signal. Below it is normal churn.
const CLAIM_VARIATION_THRESHOLD = 0.2;

// patch-17 — minimum composite relevance score for a homepage change to generate
// a signal. Below it the change is silenced (logged only). Conservative default.
const RELEVANCE_MIN_SCORE = Number(process.env.ENRICHMENTS_RELEVANCE_MIN_SCORE ?? 0.5);

// patch-17 — content/median ratio under which the median anti-void guard may flag
// a soft-block (combined with an absolute-smallness check inside the guard).
const ANTIVOID_THRESHOLD = Number(process.env.ENRICHMENTS_ANTIVOID_THRESHOLD ?? 0.3);

// patch-17 — volatile-line learning thresholds: consecutive scrapes a line
// signature must keep changing to be marked volatile, and stable scrapes to revert.
const VOLATILE_THRESHOLD = Number(process.env.ENRICHMENTS_VOLATILE_THRESHOLD ?? 5);
const VOLATILE_RESET = Number(process.env.ENRICHMENTS_VOLATILE_RESET ?? 10);

// Readable "12,000 teams" / "99.9% uptime" for a claim change card.
function formatClaim(value: number, unit: string | null, context: string): string {
  if (unit === "%") return `${value}% ${context}`;
  return `${value.toLocaleString("en-US")} ${context}`;
}

// patch-23 — fine-grained failure diagnosis. Runs in the body's catch (same
// invocation as the throw) so the rich cascade attempts ride along on the
// ScrapeFailedError; Trigger's onFailure only sees the message. Best-effort:
// a diagnosis/DB hiccup must never mask the real scrape error (we rethrow it).
async function diagnoseAndPersistFailure(
  monitorId: string,
  originalUrl: string,
  err: unknown,
): Promise<void> {
  try {
    const cascade =
      err && typeof err === "object" && "cascadeOutcome" in err
        ? (err as { cascadeOutcome?: { attempts?: { result?: AttemptInfo }[] } }).cascadeOutcome
        : undefined;
    const attempts: AttemptInfo[] =
      cascade?.attempts?.map((a) => ({
        ok: a.result?.ok,
        statusCode: a.result?.statusCode,
        failureReason: a.result?.failureReason,
        finalUrl: a.result?.finalUrl,
        html: a.result?.html,
        text: a.result?.text,
      })) ?? [{ failureReason: err instanceof Error ? err.message : String(err) }];
    const diagnosis = diagnoseFailure(attempts, originalUrl);
    await db
      .update(monitors)
      .set({
        lastFailureCategory: diagnosis.category,
        lastFailureConfidence: diagnosis.confidence,
        lastFailureEvidence: diagnosis.evidence,
        lastFailureDiagnosedAt: new Date(),
      })
      .where(eq(monitors.id, monitorId));
    logger.warn("Scrape failure diagnosed", {
      monitorId,
      category: diagnosis.category,
      confidence: diagnosis.confidence,
    });
  } catch (diagErr) {
    logger.warn("Failure diagnosis skipped (non-fatal)", {
      monitorId,
      error: diagErr instanceof Error ? diagErr.message : String(diagErr),
    });
  }
}

// patch-23 — when a monitor first becomes unscrapable, propose 1-3 alternatives
// (always manual + pause, plus a URL/replace hint from the diagnosis) so the user
// has something to act on instead of a flat "unavailable". Idempotent: skips if
// alternatives are already proposed for this monitor. Best-effort.
async function proposeAlternatives(
  monitor: { id: string; competitorId: string; config: unknown; lastFailureCategory: string | null },
): Promise<void> {
  try {
    const existing = await db.query.monitorAlternatives.findFirst({
      where: and(
        eq(monitorAlternatives.monitorId, monitor.id),
        eq(monitorAlternatives.status, "proposed"),
      ),
    });
    if (existing) return;

    const configUrl =
      monitor.config && typeof monitor.config === "object" && "url" in monitor.config
        ? String((monitor.config as { url: unknown }).url)
        : null;
    const competitor = await db.query.competitors.findFirst({
      where: eq(competitors.id, monitor.competitorId),
      columns: { url: true },
    });
    const url = configUrl ?? competitor?.url ?? null;
    const category = (monitor.lastFailureCategory as FailureCategory | null) ?? "unknown";

    const proposals = await generateAlternatives(url, category);
    if (proposals.length === 0) return;
    await db.insert(monitorAlternatives).values(
      proposals.map((p) => ({
        monitorId: monitor.id,
        type: p.type,
        description: p.description,
        suggestedUrl: p.suggestedUrl ?? null,
        rationale: p.rationale ?? null,
      })),
    );
    logger.log("Proposed scrape alternatives", { monitorId: monitor.id, count: proposals.length });
  } catch (err) {
    logger.warn("Proposing alternatives skipped (non-fatal)", {
      monitorId: monitor.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// patch-23 — pure-SPA recovery. On the unscrapable transition for a spa_empty
// monitor, run the runtime API capture once: if it discovers JSON content
// endpoints, remember them and switch the monitor to API capture so the next run
// extracts real content instead of looping on the empty shell. Best-effort.
async function tryEnableApiCapture(
  monitor: { id: string; competitorId: string; config: unknown },
): Promise<boolean> {
  try {
    const configUrl =
      monitor.config && typeof monitor.config === "object" && "url" in monitor.config
        ? String((monitor.config as { url: unknown }).url)
        : null;
    const competitor = await db.query.competitors.findFirst({
      where: eq(competitors.id, monitor.competitorId),
      columns: { url: true },
    });
    const url = configUrl ?? competitor?.url ?? null;
    if (!url) return false;

    const { scrapeWithApiCapture } = await import("@outrival/scrapers");
    const cap = await scrapeWithApiCapture(url);
    const relevant = filterRelevantApiCalls(cap.apiCalls);
    if (relevant.length === 0) return false;

    await db
      .update(monitors)
      .set({ apiCaptureEnabled: true, apiCaptureEndpoints: toEndpoints(relevant) })
      .where(eq(monitors.id, monitor.id));
    logger.log("Enabled SPA API capture", {
      monitorId: monitor.id,
      endpoints: relevant.length,
    });
    return true;
  } catch (err) {
    logger.warn("SPA API capture discovery failed (non-fatal)", {
      monitorId: monitor.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

// patch-31 — min hours between drift-triggered platform re-detections, so a
// durably-migrated (or simply empty) ATS board re-detects at most once a day
// instead of every scrape. The periodic 30d re-detection still covers the rest.
const PLATFORM_DRIFT_COOLDOWN_MS =
  Number(process.env.PLATFORM_REDETECT_DRIFT_COOLDOWN_HOURS ?? 24) * 3_600_000;

// patch-31 — connector-failure self-heal. The cached profile promised a structured
// connector (ATS API) but this scrape didn't serve via it (board migrated / API
// down) → the profile is stale → re-detect (cooldown-bounded, fire-and-forget).
// Best-effort: a re-detection hiccup must never affect the scrape that succeeded.
async function maybeRedetectPlatformOnDrift(
  competitor: {
    id: string;
    platformProfile: PlatformProfile | null;
    platformDetectedAt: Date | null;
  },
  monitor: { sourceType: string },
  result: ScrapeOutcome,
): Promise<void> {
  try {
    const profile = competitor.platformProfile;
    if (!profile) return;
    if (
      competitor.platformDetectedAt &&
      Date.now() - competitor.platformDetectedAt.getTime() < PLATFORM_DRIFT_COOLDOWN_MS
    ) {
      return;
    }
    const atsDrift =
      monitor.sourceType === "jobs" &&
      Boolean(profile.ats) &&
      result.metadata.scrapedWith !== "ats-api";
    if (!atsDrift) return;
    await tasks.trigger("detect-platform", { competitorId: competitor.id });
    logger.log("Platform re-detection triggered on connector drift", {
      competitorId: competitor.id,
      sourceType: monitor.sourceType,
    });
  } catch (err) {
    logger.warn("Platform drift re-detection skipped (non-fatal)", {
      competitorId: competitor.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

const InputSchema = z.object({
  monitorId: z.string(),
  force: z.boolean().optional().default(false),
  // patch-27 — present when a user explicitly forced this re-scan. `force` already
  // bypasses the idempotence window + hash dedup; these fields only let us write
  // the outcome (change found or not) back to forced_rescan_log for the contextual
  // toast and the admin useful/wasted ratio.
  triggeredBy: z.enum(["user_forced_rescan"]).optional(),
  userId: z.string().optional(),
  forcedRescanLogId: z.string().optional(),
});

const IDEMPOTENCE_WINDOW_MS = 60 * 60 * 1000;

// How long a monitor stays pinned to a paid cascade level (>=2) before we
// re-probe from the bottom of the cascade. A site that stopped blocking us then
// drops back to a cheaper level instead of paying datacenter/residential forever.
const LEVEL_REPROBE_INTERVAL_MS = 14 * 24 * 60 * 60 * 1000;

// After this many consecutive run failures (incl. the final Camoufox level) a
// source is marked unscrapable so the UI can show a clear "unavailable" state.
const UNSCRAPABLE_FAILURE_THRESHOLD = 3;

// Failure backoff (hours) indexed by consecutive-failure count. onFailure runs
// only after every in-run retry is exhausted, so a genuine failure must push
// nextRunAt forward — otherwise schedule-scraping (which never excludes
// markedUnscrapable, and where only the success path advanced nextRunAt) re-enqueues
// the monitor on every hourly cron and a permanently-dead source floods scrape_runs
// forever. The curve still re-probes (self-healing) at a widening cadence:
// 6h, 12h, 1d, then 3d for any further/unscrapable failure.
const FAILURE_BACKOFF_HOURS = [6, 12, 24, 72];
function failureBackoffMs(consecutiveFailures: number): number {
  const idx = Math.min(Math.max(consecutiveFailures, 1), FAILURE_BACKOFF_HOURS.length) - 1;
  return (FAILURE_BACKOFF_HOURS[idx] ?? 72) * 60 * 60 * 1000;
}

export const scrapeMonitorJob = task({
  id: "scrape-monitor",
  // Chromium (lazy-imported Patchright) OOMs on the default 0.5 GB machine for
  // heavy pages — surfaced as TASK_EXECUTION_ABORTED. 2 GB is safe.
  machine: "medium-1x",
  // Fast lane (default). schedule-scraping reroutes learned-slow monitors (L3/L4)
  // to the bounded slow lane — see lib/scrape-queues.ts. Each run is an isolated
  // machine, so the lane caps bound proxy burst + Trigger cost, not memory.
  queue: scrapeMonitorQueue,
  maxDuration: 300,
  retry: { maxAttempts: 3, minTimeoutInMs: 1000, maxTimeoutInMs: 10000, factor: 2 },

  async run(payload: z.input<typeof InputSchema>) {
    const input = InputSchema.parse(payload);
    logger.log("Starting scrape-monitor", { monitorId: input.monitorId, force: input.force });
    // Ops timing (patch-02): wall-clock of the run, logged to scrape_runs at each
    // real outcome (no_change / success / failure). The recent_snapshot dedup
    // guard below returns before any fetch, so it is deliberately not logged.
    const startedAt = Date.now();

    const monitor = await db.query.monitors.findFirst({
      where: eq(monitors.id, input.monitorId),
    });
    if (!monitor) throw new AbortTaskRunError(`Monitor ${input.monitorId} not found`);

    const competitor = await db.query.competitors.findFirst({
      where: eq(competitors.id, monitor.competitorId),
    });
    if (!competitor) throw new AbortTaskRunError(`Competitor ${monitor.competitorId} not found`);

    // Clamp the reschedule cadence to the org's current plan: a downgraded org keeps
    // its monitors but must not keep scraping at a frequency above its tier (e.g. a
    // realtime monitor on free → weekly). Soft + reversible — we never touch the stored
    // monitor.frequency, so re-upgrading restores the full cadence on the next run.
    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, competitor.orgId),
      columns: { plan: true },
    });
    const effectiveFrequency = clampFrequencyToPlan(org?.plan ?? "free", monitor.frequency);

    if (!input.force) {
      const cutoff = new Date(Date.now() - IDEMPOTENCE_WINDOW_MS);
      const recent = await db.query.snapshots.findFirst({
        where: and(eq(snapshots.monitorId, monitor.id), gte(snapshots.scrapedAt, cutoff)),
      });
      if (recent) {
        logger.log("Recent snapshot exists, skipping", { snapshotId: recent.id });
        return { skipped: true, reason: "recent_snapshot" };
      }
    }

    const configUrl =
      monitor.config && typeof monitor.config === "object" && "url" in monitor.config
        ? String((monitor.config as { url: unknown }).url)
        : null;
    const scrapeUrl = configUrl ?? competitor.url;
    if (!scrapeUrl) {
      throw new AbortTaskRunError(
        `Monitor ${monitor.id} has no URL to scrape (competitor ${competitor.id} has none)`,
      );
    }

    const lastSnapshot = await db.query.snapshots.findFirst({
      where: eq(snapshots.monitorId, monitor.id),
      orderBy: desc(snapshots.scrapedAt),
    });

    // Self-heal the content summary: a homepage already captured but still missing
    // an aiSummary means a prior refresh-competitor-summary failed (AI outage,
    // transient) — and nothing else ever retries it, so the competitor sits in the
    // onboarding "analyzing" state forever (aiSummary is the readiness proxy).
    // Re-trigger here, before the dedup early-returns below, so an unchanged
    // homepage (304 / same hash) still gets a retry on each scheduled scrape.
    // Fire-and-forget; the job overwrites in place, so it's safe to repeat.
    if (monitor.sourceType === "homepage" && lastSnapshot && !competitor.aiSummary) {
      await tasks.trigger("refresh-competitor-summary", { competitorId: competitor.id });
    }

    // Conditional pre-flight: for server-rendered sources, a cheap GET with the
    // stored validators returns 304 when nothing changed — skip the full scrape
    // (and never load crawlee/Chromium). Only trusted when the last snapshot
    // pinned the resolved URL, so the pre-flight checks the exact resource.
    if (
      !input.force &&
      supportsConditionalFetch(monitor.sourceType) &&
      lastSnapshot?.resolvedUrl &&
      (lastSnapshot.etag || lastSnapshot.lastModified)
    ) {
      const { conditionalFetch } = await import("@outrival/scrapers/conditional-fetch");
      const cond = await conditionalFetch(
        lastSnapshot.resolvedUrl,
        lastSnapshot.etag,
        lastSnapshot.lastModified,
      );
      if (cond.notModified) {
        logger.log("Conditional 304, skipping scrape", {
          monitorId: monitor.id,
          url: lastSnapshot.resolvedUrl,
        });
        const nextRunAt = computeNextRun(
          effectiveFrequency,
          monitor.lastChangedAt,
          monitor.createdAt,
        );
        await db
          .update(monitors)
          .set({
            lastRunAt: new Date(),
            nextRunAt,
            scrapeStartedAt: null,
            lastFailedAt: null,
            lastError: null,
            consecutiveFailures: 0,
            markedUnscrapable: false,
          })
          .where(eq(monitors.id, monitor.id));
        await logScrapeRun({
          monitor_id: monitor.id,
          competitor_id: monitor.competitorId,
          source_type: monitor.sourceType,
          status: "no_change",
          level: 0, // conditional GET — no browser, no proxy
          attempts: 1,
          failure_reason: "",
          duration_ms: Date.now() - startedAt,
          recorded_at: new Date(),
        });
        return { changed: false, reason: "not_modified" };
      }
    }

    // Re-probe a monitor pinned to a paid level (>=2) from the bottom of the
    // cascade periodically: if the site stopped blocking us, we drop to a cheaper
    // (free) level instead of paying datacenter/residential forever.
    const pinnedLevel = monitor.requiresLevel;
    const shouldReprobe =
      pinnedLevel != null &&
      pinnedLevel >= 2 &&
      (!monitor.requiresLevelLastReprobe ||
        Date.now() - monitor.requiresLevelLastReprobe.getTime() > LEVEL_REPROBE_INTERVAL_MS);
    // Where the cascade starts: from the learned level normally, from L0 on a
    // re-probe so a cheaper level can win. Clamped to the valid 0..4 range.
    const startLevel = (shouldReprobe ? 0 : (pinnedLevel ?? 0)) as 0 | 1 | 2 | 3 | 4;

    // Lazy-import to avoid loading Patchright (Chromium) at module parse time
    // (trigger.dev warns on >1 s import).
    let result: ScrapeOutcome;
    try {
      if (monitor.apiCaptureEnabled) {
        // Pure SPA learned via patch-23: capture the runtime JSON API and wrap the
        // relevant calls in a synthetic document so the rest of the pipeline
        // (hash → diff → classify) treats it like any other source. Empty relevant
        // content falls back to the shell HTML → the collapse guard fails honestly.
        const { scrapeWithApiCapture } = await import("@outrival/scrapers");
        const cap = await scrapeWithApiCapture(scrapeUrl);
        const relevant = filterRelevantApiCalls(cap.apiCalls);
        result = {
          html: apiCallsToHtmlDoc(relevant) || cap.html,
          text: cap.text,
          screenshotBuffer: Buffer.alloc(0),
          metadata: { url: scrapeUrl, scrapedWith: "api-capture" },
          statusCode: cap.statusCode,
          level: 1,
          attempts: 1,
        };
      } else {
        const { getScraper } = await import("@outrival/scrapers");
        const scraper = getScraper(monitor.sourceType);
        result = await scraper(competitor.id, scrapeUrl, {
          knownLevel: startLevel,
          // patch-31 — lets a scraper route via a structured connector (e.g. jobs →
          // ATS API). Null when never detected / detection disabled ⇒ today's path.
          platformProfile: competitor.platformProfile,
        });
      }
    } catch (err) {
      // Diagnose before rethrowing so the failure category is persisted from the
      // attempt that actually carried the cascade data (patch-23). Trigger.dev
      // retries / onFailure then handles consecutiveFailures + markedUnscrapable.
      await diagnoseAndPersistFailure(monitor.id, scrapeUrl, err);
      throw err;
    }
    // Parse the freshly scraped HTML once: reused for the hash and (on a change)
    // for the after-side of the diff, instead of re-parsing the same big page.
    const afterContent = extractContent(result.html, monitor.sourceType);
    const newHash = computeHash(afterContent);

    // Reconcile the learned cascade level (patch-20). Only paid levels (>=2) are
    // pinned; a free win (L0/L1) clears the pin so we start cheap next run. A
    // re-probe always pushes the next re-probe window out, even if the level held.
    const learnedRequiresLevel = result.level >= 2 ? result.level : null;
    const levelChanged = learnedRequiresLevel !== monitor.requiresLevel;
    if (levelChanged || shouldReprobe) {
      await db
        .update(monitors)
        .set({
          ...(levelChanged
            ? {
                requiresLevel: learnedRequiresLevel,
                requiresLevelSince: learnedRequiresLevel === null ? null : new Date(),
              }
            : {}),
          ...(shouldReprobe ? { requiresLevelLastReprobe: new Date() } : {}),
        })
        .where(eq(monitors.id, monitor.id));
    }

    // patch-31 — self-heal the platform profile when a promised structured connector
    // didn't serve this run (e.g. ATS board migrated). Runs on success regardless of
    // change/no-change, fire-and-forget, cooldown-bounded.
    await maybeRedetectPlatformOnDrift(competitor, monitor, result);

    // A forced re-scan (manual "Re-scan", admin force-scrape) means "re-process now",
    // so it bypasses the hash dedup like it already bypasses the idempotence window and
    // the 304 pre-flight: even on identical content we insert a snapshot and re-run the
    // downstream extractions, so e.g. "Re-scan profile" actually re-derives the profile.
    if (!input.force && lastSnapshot && lastSnapshot.contentHash === newHash) {
      logger.log("Hash identical, no change", { lastSnapshotId: lastSnapshot.id });
      const nextRunAt = computeNextRun(
        effectiveFrequency,
        monitor.lastChangedAt,
        monitor.createdAt,
      );
      await db
        .update(monitors)
        .set({
          lastRunAt: new Date(),
          nextRunAt,
          scrapeStartedAt: null,
          lastFailedAt: null,
          lastError: null,
          consecutiveFailures: 0,
          markedUnscrapable: false,
        })
        .where(eq(monitors.id, monitor.id));
      await logScrapeRun({
        monitor_id: monitor.id,
        competitor_id: monitor.competitorId,
        source_type: monitor.sourceType,
        status: "no_change",
        level: result.level,
        attempts: result.attempts,
        failure_reason: "",
        duration_ms: Date.now() - startedAt,
        recorded_at: new Date(),
      });
      return { changed: false, snapshotId: lastSnapshot.id };
    }

    // Anti-collapse guard (precision): a hash change whose extracted content is
    // essentially empty is almost always a failed render or soft-block (big HTML
    // shell, no visible body) — not a competitor that deleted their whole page.
    // Don't let it become the new reference and fire a phantom "everything
    // removed" change. Throw so Trigger retries a clean render; if it stays empty
    // the monitor surfaces as failed (honest) instead of emitting a false signal.
    // Guarded on the prior snapshot having had real content, so a consistently
    // empty monitor doesn't retry-loop.
    if (lastSnapshot && isContentCollapsed(afterContent)) {
      const priorHtml = await getFromR2(`${lastSnapshot.r2Key}.html`);
      if (!isContentCollapsed(extractContent(priorHtml, monitor.sourceType))) {
        logger.warn("Extracted content collapsed — likely failed render/soft-block, retrying", {
          monitorId: monitor.id,
          sourceType: monitor.sourceType,
        });
        throw new Error(
          `Extracted content collapsed for monitor ${monitor.id} (likely failed render or soft-block)`,
        );
      }
    }

    // Median anti-void guard (patch-17, ADDITIVE to the absolute collapse guard
    // above): content that dropped far below this monitor's historical median AND
    // is absolutely small is almost certainly a soft-block returning a shell — not
    // a real reduction. Throw so Trigger retries (a re-probe may switch to proxy and
    // render real content). Conservative: a large page that merely shrank, or a
    // stably-small monitor, is never flagged. Skips gracefully without prior sizes.
    if (lastSnapshot) {
      const recentSizes = await db.query.snapshots.findMany({
        where: and(eq(snapshots.monitorId, monitor.id), eq(snapshots.status, "success")),
        orderBy: desc(snapshots.scrapedAt),
        limit: 5,
        columns: { contentSize: true },
      });
      const priorSizes = recentSizes
        .map((s) => s.contentSize)
        .filter((n): n is number => typeof n === "number" && n > 0);
      const decision = checkAntiVoid(afterContent.length, priorSizes, {
        ratioThreshold: ANTIVOID_THRESHOLD,
      });
      if (decision.isVoid) {
        logger.warn("Anti-void guard triggered — likely soft-block, retrying", {
          monitorId: monitor.id,
          reason: decision.reason,
          currentSize: afterContent.length,
        });
        throw new Error(
          `Anti-void: content below historical median for monitor ${monitor.id} (${decision.reason})`,
        );
      }
    }

    const timestamp = new Date().toISOString();
    const r2Key = `snapshots/${competitor.id}/${monitor.sourceType}/${timestamp}`;

    await uploadToR2(`${r2Key}.html`, result.html, "text/html; charset=utf-8", {
      compress: true,
    });
    let screenshotPhash: string | null = null;
    if (result.screenshotBuffer.length > 0) {
      await uploadToR2(`${r2Key}.png`, result.screenshotBuffer, "image/png");
      // Perceptual hash (patch-17) for visual-redesign detection. Best-effort: a
      // non-image buffer or a sharp failure must never break the scrape.
      try {
        screenshotPhash = phashToHex(await computePerceptualHash(result.screenshotBuffer));
      } catch (err) {
        logger.warn("Perceptual hash failed (non-fatal)", {
          monitorId: monitor.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const resolvedUrl =
      typeof result.metadata.url === "string" ? result.metadata.url : scrapeUrl;

    // Homepage semantic structure (patch-16): parsed once from the fresh HTML,
    // stored on the snapshot, and reused for the structured diff below. Null for
    // every other source — they keep the lexical visible-content diff.
    const homepageStructure =
      monitor.sourceType === "homepage"
        ? parseHomepageStructure(result.html, resolvedUrl)
        : null;

    const [newSnapshot] = await db
      .insert(snapshots)
      .values({
        monitorId: monitor.id,
        r2Key,
        contentHash: newHash,
        status: "success",
        scrapedAt: new Date(),
        etag: result.etag ?? null,
        lastModified: result.lastModified ?? null,
        resolvedUrl,
        homepageStructure,
        screenshotPhash,
        contentSize: afterContent.length,
      })
      .returning();

    if (!newSnapshot) throw new Error("Failed to insert snapshot");

    // Pricing taxonomy (patch-11): analyse the page we just captured, store the
    // latest status on the competitor (unless the user took manual control), and
    // remember the prior status to detect a repositioning when routing the change.
    let pricingAnalysis: PricingAnalysis | null = null;
    let pricingTransition: PricingRepositioning | null = null;
    const previousPricingStatus = (competitor.pricingStatus as PricingStatus | null) ?? null;
    if (monitor.sourceType === "pricing") {
      pricingAnalysis = analyzePricingHtml(result.html, resolvedUrl);
      pricingTransition = previousPricingStatus
        ? detectPricingRepositioning(previousPricingStatus, pricingAnalysis.status)
        : null;
      if (!competitor.pricingManualOverride) {
        await db
          .update(competitors)
          .set({
            pricingStatus: pricingAnalysis.status,
            pricingObservedRegion: SCRAPER_REGION,
            pricingPromotional: pricingAnalysis.promotional,
            pricingDemoUrl: pricingAnalysis.demoUrl,
            pricingNote: pricingAnalysis.note,
            updatedAt: new Date(),
          })
          .where(eq(competitors.id, competitor.id));
      }
    }

    let changeId: string | null = null;
    let changedAt: Date | null = null;

    // Structured diff (patch-16) for homepage monitors when BOTH the current
    // capture and the prior snapshot carry a semantic structure. Replaces the
    // lexical diff for homepages. Falls back to the lexical path below when the
    // prior snapshot predates the patch (no structure) — for that one iteration
    // only; the next scrape will have two structures and use the structured diff.
    const prevStructure = (lastSnapshot?.homepageStructure ?? null) as HomepageStructure | null;
    if (lastSnapshot && monitor.sourceType === "homepage" && homepageStructure && prevStructure) {
      const structuredChanges = diffHomepages(prevStructure, homepageStructure);

      // Visual redesign (patch-17): a large screenshot Hamming distance with FEW
      // structural changes ⇒ a redesign with little/no copy move — exactly what the
      // text diff misses. Guarded on < 3 structural changes so it doesn't pile onto
      // an already-obvious structural change. Best-effort on both hashes.
      const prevPhash = phashFromHex(lastSnapshot.screenshotPhash);
      const currPhash = phashFromHex(screenshotPhash);
      if (prevPhash !== null && currPhash !== null && structuredChanges.length < 3) {
        const distance = hammingDistance(prevPhash, currPhash);
        if (distance > PHASH_THRESHOLD) {
          structuredChanges.push({
            kind: "visual_redesign",
            field: "visual_redesign",
            before: `phash ${lastSnapshot.screenshotPhash}`,
            after: `phash ${screenshotPhash}`,
            metadata: { hammingDistance: distance },
          });
          logger.log("Visual redesign detected", {
            monitorId: monitor.id,
            hammingDistance: distance,
          });
        }
      }

      // Numeric claims (patch-17): extract the quantified brags from the page
      // copy, compare each to its last observed value, and flag a > 20% move as a
      // business change. Track every observation in the analytics tables afterwards. All
      // best-effort — a CH miss just means no claim comparison this run.
      const claimText = [
        homepageStructure.hero.headline ?? "",
        homepageStructure.hero.subheadline ?? "",
        ...homepageStructure.sections.map((s) => s.bodyText),
      ].join("\n");
      const currentClaims = extractNumericClaims(claimText);
      if (currentClaims.length > 0) {
        const lastClaims = await getLastNumericClaims(monitor.competitorId);
        const lastByKey = new Map<string, number>();
        for (const lc of lastClaims ?? []) {
          lastByKey.set(`${lc.pattern}|${lc.unit}|${lc.context}`, lc.value);
        }
        for (const claim of currentClaims) {
          const prev = lastByKey.get(`${claim.pattern}|${claim.unit ?? ""}|${claim.context}`);
          if (prev === undefined || prev <= 0) continue;
          const variation = (claim.value - prev) / prev;
          if (Math.abs(variation) > CLAIM_VARIATION_THRESHOLD) {
            structuredChanges.push({
              kind: "numeric_claim_changed",
              field: "numeric_claim_changed",
              before: formatClaim(prev, claim.unit, claim.context),
              after: formatClaim(claim.value, claim.unit, claim.context),
              metadata: { variation, pattern: claim.pattern, context: claim.context },
            });
          }
        }
        await insertNumericClaims(
          currentClaims.map((c) => ({
            competitor_id: monitor.competitorId,
            monitor_id: monitor.id,
            pattern: c.pattern,
            unit: c.unit ?? "",
            context: c.context,
            value: c.value,
            raw_text: c.rawText,
            observed_at: new Date(),
          })),
        );
      }

      // Testimonial add/remove (patch-17): needs more history than the 2-snapshot
      // structural diff, so it's worker-orchestrated. Read the last 2×window=6
      // homepage structures (incl. the one just inserted) and let the stability
      // windows decide — a rotating carousel can't satisfy them, so it never fires.
      const recentSnaps = await db.query.snapshots.findMany({
        where: eq(snapshots.monitorId, monitor.id),
        orderBy: desc(snapshots.scrapedAt),
        limit: 6,
        columns: { homepageStructure: true },
      });
      const testimonialSets = recentSnaps.map(
        (s) =>
          (s.homepageStructure as HomepageStructure | null)?.socialProof?.testimonials ?? [],
      );
      const testimonialDiff = diffTestimonialsStable(testimonialSets);
      for (const item of testimonialDiff.added) {
        structuredChanges.push({
          kind: "testimonial_added",
          field: "socialProof.testimonials",
          before: null,
          after: item.author ? `${item.quote} — ${item.author}` : item.quote,
        });
      }
      for (const item of testimonialDiff.removed) {
        structuredChanges.push({
          kind: "testimonial_removed",
          field: "socialProof.testimonials",
          before: item.author ? `${item.quote} — ${item.author}` : item.quote,
          after: null,
        });
      }

      // Volatile-line learning (patch-17): learn which line signatures churn
      // without meaning on this monitor (e.g. a live "Used by N teams" counter) and
      // filter them out of section body diffs so they stop generating noise. The
      // before/after lines come from the body diffs already computed above.
      const prevLines: string[] = [];
      const currLines: string[] = [];
      for (const c of structuredChanges) {
        if (c.bodyDiff) {
          prevLines.push(...c.bodyDiff.removed);
          currLines.push(...c.bodyDiff.added);
        }
      }
      if (prevLines.length > 0 || currLines.length > 0) {
        const existingVolatile = await db.query.volatileLines.findMany({
          where: eq(volatileLines.monitorId, monitor.id),
        });
        const existingStates = existingVolatile.map((v) => ({
          pattern: v.pattern,
          changeCount: v.changeCount,
          stableCount: v.stableCount,
          isVolatile: v.isVolatile,
        }));
        const updates = computeVolatileUpdates(prevLines, currLines, existingStates, {
          changeThreshold: VOLATILE_THRESHOLD,
          resetThreshold: VOLATILE_RESET,
        });
        for (const u of updates) {
          await db
            .insert(volatileLines)
            .values({
              monitorId: monitor.id,
              pattern: u.pattern,
              changeCount: u.changeCount,
              stableCount: u.stableCount,
              isVolatile: u.isVolatile,
              lastSeenAt: new Date(),
            })
            .onConflictDoUpdate({
              target: [volatileLines.monitorId, volatileLines.pattern],
              set: {
                changeCount: u.changeCount,
                stableCount: u.stableCount,
                isVolatile: u.isVolatile,
                lastSeenAt: new Date(),
              },
            });
        }
        // Currently-volatile signatures = existing volatile ± this round's updates.
        const volatileSet = new Set<string>();
        for (const e of existingStates) if (e.isVolatile) volatileSet.add(e.pattern);
        for (const u of updates) {
          if (u.isVolatile) volatileSet.add(u.pattern);
          else volatileSet.delete(u.pattern);
        }
        if (volatileSet.size > 0) {
          for (const c of structuredChanges) {
            if (c.bodyDiff) {
              c.bodyDiff.added = filterVolatileLines(c.bodyDiff.added, volatileSet);
              c.bodyDiff.removed = filterVolatileLines(c.bodyDiff.removed, volatileSet);
            }
          }
        }
      }
      // Drop body-change entries emptied by volatile filtering (the churn was all
      // there was). Other change kinds are unaffected.
      const cleanedChanges = structuredChanges.filter(
        (c) =>
          c.kind !== "section_body_changed" ||
          (c.bodyDiff?.added.length ?? 0) + (c.bodyDiff?.removed.length ?? 0) > 0,
      );

      // Relevance filter (patch-17): score every assembled change (weight of WHERE
      // × magnitude × recency) and keep only those at/above the threshold. A change
      // below it is SILENCED — no change row, no classify, no signal — just logged.
      // Recency damps a competitor that changes constantly (each change worth less).
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const recentChangeCount = await db
        .select({ value: count() })
        .from(changes)
        .innerJoin(monitors, eq(changes.monitorId, monitors.id))
        .where(
          and(eq(monitors.competitorId, monitor.competitorId), gte(changes.detectedAt, sevenDaysAgo)),
        );
      const previousChangesInLast7Days = recentChangeCount[0]?.value ?? 0;

      const scored = cleanedChanges.map((change) => ({
        change,
        relevance: scoreRelevance(change, { previousChangesInLast7Days }),
      }));
      const significant = scored.filter((s) => s.relevance.score >= RELEVANCE_MIN_SCORE);

      if (significant.length === 0) {
        // Either nothing semantic changed (a rotating carousel moving the content
        // hash), volatile filtering emptied everything, or every change scored
        // below the relevance threshold — store this snapshot as the new baseline
        // and emit no change/signal.
        logger.log("No significant homepage change", {
          monitorId: monitor.id,
          total: cleanedChanges.length,
          ignored: scored.length - significant.length,
        });
      } else {
        // Attach each change's relevance so the "Why this insight?" panel can show
        // it. perChangeAssessment (classify-change) preserves metadata via spread.
        const significantChanges = significant.map((s) => ({
          ...s.change,
          metadata: {
            ...(s.change.metadata ?? {}),
            relevanceScore: Number(s.relevance.score.toFixed(3)),
          },
        }));
        // Derive a lexical-shaped added/removed for rawDiff so existing consumers
        // (self-product change cards read rawDiff) keep working.
        const added: string[] = [];
        const removed: string[] = [];
        for (const c of significantChanges) {
          if (c.after) added.push(c.after);
          if (c.before) removed.push(c.before);
          if (c.bodyDiff) {
            added.push(...c.bodyDiff.added);
            removed.push(...c.bodyDiff.removed);
          }
        }
        // Strongest change drives the change-level relevance, persisted for the
        // patch-26 per-org threshold + weekly recalc (the dispatcher reads it off
        // the signal). Only the structured homepage path carries a score.
        const changeRelevance = Math.max(...significant.map((s) => s.relevance.score));
        const [newChange] = await db
          .insert(changes)
          .values({
            monitorId: monitor.id,
            snapshotBeforeId: lastSnapshot.id,
            snapshotAfterId: newSnapshot.id,
            diffText: renderStructuredChanges(significantChanges).slice(0, 50000),
            diffType: "structured",
            structuredDiff: significantChanges,
            rawDiff: { added, removed },
            relevanceScore: Number(changeRelevance.toFixed(3)),
            detectedAt: new Date(),
          })
          .returning();
        changeId = newChange?.id ?? null;
        if (changeId) {
          changedAt = new Date();
          await db
            .update(monitors)
            .set({ lastChangedAt: changedAt })
            .where(eq(monitors.id, monitor.id));
          // The structured diff + relevance filter already dropped cosmetic churn,
          // so always classify — no lexical significance gate needed here.
          await tasks.trigger("classify-change", { changeId });
        }
      }
    } else if (lastSnapshot) {
      const beforeHtml = await getFromR2(`${lastSnapshot.r2Key}.html`);
      const diff = computeTextDiff(
        extractContent(beforeHtml, monitor.sourceType),
        afterContent,
      );
      if (diff.hasChanges) {
        const [newChange] = await db
          .insert(changes)
          .values({
            monitorId: monitor.id,
            snapshotBeforeId: lastSnapshot.id,
            snapshotAfterId: newSnapshot.id,
            diffText: diff.diffText.slice(0, 50000),
            diffType: "text",
            rawDiff: { added: diff.added, removed: diff.removed },
            detectedAt: new Date(),
          })
          .returning();
        changeId = newChange?.id ?? null;
        if (changeId) {
          changedAt = new Date();
          await db
            .update(monitors)
            .set({ lastChangedAt: changedAt })
            .where(eq(monitors.id, monitor.id));

          // Pricing changes route to exactly one outcome (signals.changeId is
          // unique): a promo → no signal at all; a status repositioning → a
          // dedicated repositioning signal (replaces the generic diff signal);
          // otherwise → the generic classify pipeline (a plain price tweak).
          let pricingSignalHandled = false;
          if (monitor.sourceType === "pricing" && pricingAnalysis) {
            if (pricingAnalysis.promotional) {
              logger.log("Promotional pricing — skipping price-change signal", {
                monitorId: monitor.id,
                changeId,
              });
              pricingSignalHandled = true;
            } else if (pricingTransition && previousPricingStatus) {
              logger.log("Pricing repositioning detected", {
                monitorId: monitor.id,
                changeId,
                from: previousPricingStatus,
                to: pricingAnalysis.status,
                type: pricingTransition.type,
              });
              await tasks.trigger("generate-signal", {
                changeId,
                pricingTransition: {
                  type: pricingTransition.type,
                  severity: pricingTransition.severity,
                  previous: previousPricingStatus,
                  current: pricingAnalysis.status,
                },
              });
              pricingSignalHandled = true;
            }
          }

          // Skip the classification call (Trigger run + Groq) on trivial diffs —
          // timestamps, hashes, nonces. The change row is still recorded.
          if (!pricingSignalHandled) {
            const significance = evaluateSignificance({
              added: diff.added.join("\n"),
              removed: diff.removed.join("\n"),
            });
            if (significance.worth) {
              await tasks.trigger("classify-change", { changeId });
            } else {
              logger.log("Skipping classification (trivial diff)", {
                monitorId: monitor.id,
                changeId,
                reason: significance.reason,
              });
            }
          }
        }
      }
    }

    // First-ever homepage capture has no prior snapshot to diff against, so the
    // change → classify → signal pipeline produces nothing. Kick off a one-off
    // content summary so the user sees what this competitor does from scrape #1.
    if (monitor.sourceType === "homepage" && !lastSnapshot) {
      await tasks.trigger("refresh-competitor-summary", { competitorId: competitor.id });
    }

    // Self-competitor (patch-12): refresh the structured profile (features + tech
    // stack) from each homepage capture. Auto-detected fields are refreshed; fields
    // the user corrected stay sticky.
    if (monitor.sourceType === "homepage" && competitor.type === "self") {
      await tasks.trigger("extract-self-profile", {
        competitorId: competitor.id,
        snapshotId: newSnapshot.id,
      });
    }

    if (monitor.sourceType === "pricing") {
      await tasks.trigger("extract-pricing", {
        snapshotId: newSnapshot.id,
        competitorId: competitor.id,
        status: pricingAnalysis?.status,
        promotional: pricingAnalysis?.promotional,
        observedRegion: SCRAPER_REGION,
      });
    } else if (monitor.sourceType === "jobs") {
      await tasks.trigger("extract-jobs", {
        snapshotId: newSnapshot.id,
        competitorId: competitor.id,
      });
    } else if (
      // Reviews are never scraped for the self-competitor (defensive: we also
      // never create review monitors for it) — too early-stage + proxy cost.
      competitor.type !== "self" &&
      isReviewSource(monitor.sourceType)
    ) {
      // source_type "<platform>_reviews" → the extract-reviews source value
      // "<platform>" (g2/capterra/appstore/trustpilot/trustradius/gartner/playstore).
      const reviewSource = monitor.sourceType.replace(/_reviews$/, "");
      await tasks.trigger("extract-reviews", {
        snapshotId: newSnapshot.id,
        competitorId: competitor.id,
        source: reviewSource,
      });
    } else if (competitor.type !== "self" && monitor.sourceType === "reddit") {
      // patch-32 — Reddit mentions go through extract-reviews for sentiment +
      // complaint themes (no AggregateRating → null star score, no CH score row).
      await tasks.trigger("extract-reviews", {
        snapshotId: newSnapshot.id,
        competitorId: competitor.id,
        source: "reddit",
      });
    }

    // frequency/createdAt are immutable for the run; lastChangedAt only moves if
    // we detected a change above (captured in changedAt) — no need to refetch.
    const nextRunAt = computeNextRun(
      effectiveFrequency,
      changedAt ?? monitor.lastChangedAt,
      monitor.createdAt,
    );
    await db
      .update(monitors)
      .set({
        lastRunAt: new Date(),
        nextRunAt,
        scrapeStartedAt: null,
        lastFailedAt: null,
        lastError: null,
        consecutiveFailures: 0,
        markedUnscrapable: false,
      })
      .where(eq(monitors.id, monitor.id));

    await logScrapeRun({
      monitor_id: monitor.id,
      competitor_id: monitor.competitorId,
      source_type: monitor.sourceType,
      status: "success",
      level: result.level,
      attempts: result.attempts,
      failure_reason: "",
      duration_ms: Date.now() - startedAt,
      recorded_at: new Date(),
    });

    // patch-27 — stamp the user-forced re-scan outcome. A detected change means a
    // change row was created (and classify/generate-signal triggered downstream);
    // since signals are generated asynchronously, "found a change" is the honest
    // synchronous proxy for "the re-scan was useful". Forced runs always reach
    // this return (force bypasses every early no-op return above).
    if (input.triggeredBy === "user_forced_rescan" && input.forcedRescanLogId) {
      await db
        .update(forcedRescanLog)
        .set({ resultCapturedAt: new Date(), hadNewSignal: changeId !== null })
        .where(eq(forcedRescanLog.id, input.forcedRescanLogId));
    }

    logger.log("Completed scrape-monitor", {
      monitorId: monitor.id,
      snapshotId: newSnapshot.id,
      changeId,
    });

    return {
      changed: changeId !== null,
      snapshotId: newSnapshot.id,
      changeId,
    };
  },

  // Runs once after all retries are exhausted. Persist the failure so the UI
  // can show a "failed" state instead of spinning until the client poll times
  // out, and clear the in-progress marker.
  async onFailure({ payload, error }) {
    const parsed = InputSchema.safeParse(payload);
    if (!parsed.success) return;
    const message = error instanceof Error ? error.message : String(error);
    // Resolve competitor/source before the update so the ops failure log is
    // attributable to a source in the /admin scraping-health table.
    const monitor = await db.query.monitors.findFirst({
      where: eq(monitors.id, parsed.data.monitorId),
    });
    // Mark the source unscrapable after enough consecutive failures (incl. the
    // final Camoufox level) so the UI can show a clear "unavailable" state. A
    // later success resets both on the success/no_change paths above.
    const consecutiveFailures = (monitor?.consecutiveFailures ?? 0) + 1;
    const atThreshold = consecutiveFailures === UNSCRAPABLE_FAILURE_THRESHOLD;
    // patch-23 — on the unscrapable transition for a pure SPA, try to recover via
    // runtime API capture before giving up: success clears the failure state so
    // the next run scrapes the JSON API instead of looping on the empty shell.
    const recoveredViaApi =
      monitor && atThreshold && monitor.lastFailureCategory === "spa_empty" && !monitor.apiCaptureEnabled
        ? await tryEnableApiCapture(monitor)
        : false;
    // A recovered SPA runs again on the next cycle; any other failure backs off so
    // the hourly cron stops re-enqueueing a failing/dead monitor every hour.
    const nextRunAt = recoveredViaApi
      ? new Date()
      : new Date(Date.now() + failureBackoffMs(consecutiveFailures));
    const becomingUnscrapable =
      !recoveredViaApi && consecutiveFailures >= UNSCRAPABLE_FAILURE_THRESHOLD;
    await db
      .update(monitors)
      .set({
        scrapeStartedAt: null,
        nextRunAt,
        lastFailedAt: new Date(),
        lastError: message.slice(0, 1000),
        consecutiveFailures: recoveredViaApi ? 0 : consecutiveFailures,
        markedUnscrapable: recoveredViaApi ? false : consecutiveFailures >= UNSCRAPABLE_FAILURE_THRESHOLD,
        // Auto-pause an unreachable source so the scheduler stops re-enqueueing it.
        // The user re-enables it explicitly ("Resume anyway") or switches to manual entry.
        ...(becomingUnscrapable ? { isActive: false } : {}),
      })
      .where(eq(monitors.id, parsed.data.monitorId));
    // On the transition to unscrapable (and not recovered via API), propose
    // user-facing alternatives from the diagnosed failure category (patch-23).
    if (monitor && atThreshold && !recoveredViaApi) {
      await proposeAlternatives(monitor);
    }
    // Runs in a separate invocation after all retries — no run timing available,
    // so duration is 0 and level is the learned level (failure_reason = message).
    await logScrapeRun({
      monitor_id: parsed.data.monitorId,
      competitor_id: monitor?.competitorId ?? "",
      source_type: monitor?.sourceType ?? "",
      status: "failed",
      level: monitor?.requiresLevel ?? 0,
      attempts: 1,
      failure_reason: message.slice(0, 200),
      duration_ms: 0,
      recorded_at: new Date(),
    });
  },
});
