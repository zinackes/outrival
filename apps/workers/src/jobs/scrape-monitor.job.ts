import { task, logger, tasks, queue, AbortTaskRunError } from "@trigger.dev/sdk/v3";
import { z } from "zod";
import { and, desc, eq, gte } from "drizzle-orm";
import {
  db,
  monitors,
  competitors,
  snapshots,
  changes,
} from "@outrival/db";
import {
  computeHash,
  computeNextRun,
  computeTextDiff,
  uploadToR2,
  getFromR2,
  supportsConditionalFetch,
  detectPricingRepositioning,
  type PricingStatus,
  type PricingRepositioning,
} from "@outrival/shared";
// Pure subpath — pulls only the heuristic, never the groq/anthropic SDKs.
import { evaluateSignificance } from "@outrival/ai/significance";
// Pure subpath — cheerio only, never crawlee/playwright.
import { analyzePricingHtml, type PricingAnalysis } from "@outrival/scrapers/pricing";

const SCRAPER_REGION = process.env.SCRAPER_REGION ?? "FR";

const InputSchema = z.object({
  monitorId: z.string(),
  force: z.boolean().optional().default(false),
});

const IDEMPOTENCE_WINDOW_MS = 60 * 60 * 1000;

// Global throttle on concurrent scrapes. Each run is an isolated machine, so
// this does not protect memory — it bounds ScrapingBee burst usage and Trigger
// concurrency cost when schedule-scraping fans out many monitors at once.
const scrapeMonitorQueue = queue({
  name: "scrape-monitor",
  concurrencyLimit: 5,
});

export const scrapeMonitorJob = task({
  id: "scrape-monitor",
  // Chromium (lazy-imported Crawlee/Playwright) OOMs on the default 0.5 GB
  // machine for heavy pages — surfaced as TASK_EXECUTION_ABORTED. 2 GB is safe.
  machine: "medium-1x",
  queue: scrapeMonitorQueue,
  maxDuration: 300,
  retry: { maxAttempts: 3, minTimeoutInMs: 1000, maxTimeoutInMs: 10000, factor: 2 },

  async run(payload: z.input<typeof InputSchema>) {
    const input = InputSchema.parse(payload);
    logger.log("Starting scrape-monitor", { monitorId: input.monitorId, force: input.force });

    const monitor = await db.query.monitors.findFirst({
      where: eq(monitors.id, input.monitorId),
    });
    if (!monitor) throw new AbortTaskRunError(`Monitor ${input.monitorId} not found`);

    const competitor = await db.query.competitors.findFirst({
      where: eq(competitors.id, monitor.competitorId),
    });
    if (!competitor) throw new AbortTaskRunError(`Competitor ${monitor.competitorId} not found`);

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

    const lastSnapshot = await db.query.snapshots.findFirst({
      where: eq(snapshots.monitorId, monitor.id),
      orderBy: desc(snapshots.scrapedAt),
    });

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
          monitor.frequency,
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
          })
          .where(eq(monitors.id, monitor.id));
        return { changed: false, reason: "not_modified" };
      }
    }

    // Lazy-import to avoid loading crawlee/playwright at module parse time
    // (trigger.dev warns on >1 s import — crawlee is the culprit).
    const { getScraper } = await import("@outrival/scrapers");
    const scraper = getScraper(monitor.sourceType);
    const result = await scraper(competitor.id, scrapeUrl, {
      preferProxy: monitor.requiresProxy,
    });
    const newHash = computeHash(result.html);

    if (result.usedProxy && !monitor.requiresProxy) {
      await db
        .update(monitors)
        .set({ requiresProxy: true })
        .where(eq(monitors.id, monitor.id));
    }

    if (lastSnapshot && lastSnapshot.contentHash === newHash) {
      logger.log("Hash identical, no change", { lastSnapshotId: lastSnapshot.id });
      const nextRunAt = computeNextRun(
        monitor.frequency,
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
        })
        .where(eq(monitors.id, monitor.id));
      return { changed: false, snapshotId: lastSnapshot.id };
    }

    const timestamp = new Date().toISOString();
    const r2Key = `snapshots/${competitor.id}/${monitor.sourceType}/${timestamp}`;

    await uploadToR2(`${r2Key}.html`, result.html, "text/html; charset=utf-8", {
      compress: true,
    });
    if (result.screenshotBuffer.length > 0) {
      await uploadToR2(`${r2Key}.png`, result.screenshotBuffer, "image/png");
    }

    const resolvedUrl =
      typeof result.metadata.url === "string" ? result.metadata.url : scrapeUrl;

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
    if (lastSnapshot) {
      const beforeHtml = await getFromR2(`${lastSnapshot.r2Key}.html`);
      const diff = computeTextDiff(beforeHtml, result.html);
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
      (monitor.sourceType === "g2_reviews" ||
        monitor.sourceType === "capterra_reviews" ||
        monitor.sourceType === "appstore_reviews")
    ) {
      const reviewSource =
        monitor.sourceType === "g2_reviews"
          ? "g2"
          : monitor.sourceType === "capterra_reviews"
            ? "capterra"
            : "appstore";
      await tasks.trigger("extract-reviews", {
        snapshotId: newSnapshot.id,
        competitorId: competitor.id,
        source: reviewSource,
      });
    }

    // frequency/createdAt are immutable for the run; lastChangedAt only moves if
    // we detected a change above (captured in changedAt) — no need to refetch.
    const nextRunAt = computeNextRun(
      monitor.frequency,
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
      })
      .where(eq(monitors.id, monitor.id));

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
    await db
      .update(monitors)
      .set({
        scrapeStartedAt: null,
        lastFailedAt: new Date(),
        lastError: message.slice(0, 1000),
      })
      .where(eq(monitors.id, parsed.data.monitorId));
  },
});
