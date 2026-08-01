import {
  work,
  queueHealth,
  sendAlert,
  extractPricing,
  extractJobs,
  extractReviews,
  extractSelfProfile,
  refreshCompetitorSummary,
  scrapeAiVisibility,
  scrapeTechStack,
  aiVisibilityTeaser,
  sendWelcomeDigest,
  sendMonthlyRecap,
  backfillHistory,
  backfillPricingHistory,
  classifyChange,
  generateSignal,
  evaluateStandingQueries,
  detectReviewThemeShifts,
  detectHiringVelocityShifts,
  detectHiringFootprint,
  detectSalaryShifts,
  mineJobFacts,
  ingestContentItems,
  notifyOnboardingAnalysis,
  scheduleScraping,
  scheduleTechStack,
  schedulePlatformDetection,
  scheduleAiVisibility,
  generateDailyDigest,
  generateWeeklyDigest,
  signalBatching,
  detectStructuralChanges,
  relevanceThresholdRecalculation,
  detectNewCompetitors,
  analyzeSectoral,
  aiCapacityCheck,
  opsHealthCheck,
  feedbackPatternDetection,
  purgeRetention,
  detectSilentMonitors,
  heartbeat,
  scrapeMonitor,
  probePricingCalculator,
  detectPlatform,
  generateBattleCard,
  NonRetriable,
  type JobDef,
  type Job,
  type JobWithMetadata,
  type ScrapeMonitorPayload,
  type GenerateBattleCardPayload,
  type OrgRefPayload,
} from "@outrival/queue";
import { logger } from "@outrival/shared";
import { runSendAlert } from "../core/send-alert";
import { runExtractPricing } from "../core/extract-pricing";
import { runExtractJobs } from "../core/extract-jobs";
import { runMineJobFacts } from "../core/mine-job-facts";
import { runIngestContentItems } from "../core/ingest-content-items";
import { runDetectHiringFootprint } from "../core/detect-hiring-footprint";
import { runDetectSalaryShifts } from "../core/detect-salary-shifts";
import { runExtractReviews } from "../core/extract-reviews";
import { runExtractSelfProfile } from "../core/extract-self-profile";
import { runRefreshCompetitorSummary } from "../core/refresh-competitor-summary";
import { runScrapeAiVisibility } from "../core/scrape-ai-visibility";
import { runScrapeTechStack } from "../core/scrape-tech-stack";
import {
  runAiVisibilityTeaser,
  onAiVisibilityTeaserFailure,
} from "../core/ai-visibility-teaser";
import { runSendWelcomeDigest } from "../core/send-welcome-digest";
import { runSendMonthlyRecap } from "../core/send-monthly-recap";
import { runBackfillHistory } from "../core/backfill-history";
import { runBackfillPricingHistory } from "../core/backfill-pricing-history";
import { runClassifyChange } from "../core/classify-change";
import { runGenerateSignal } from "../core/generate-signal";
import { runEvaluateStandingQueries } from "../core/evaluate-standing-queries";
import { runDetectReviewThemeShifts } from "../core/detect-review-theme-shifts";
import { runDetectHiringVelocityShifts } from "../core/detect-hiring-velocity-shifts";
import { runNotifyOnboardingAnalysis } from "../core/notify-onboarding-analysis";
import { runScheduleScraping } from "../core/schedule-scraping";
import { runScheduleTechStack } from "../core/schedule-tech-stack";
import { runSchedulePlatformDetection } from "../core/schedule-platform-detection";
import { runScheduleAiVisibility } from "../core/schedule-ai-visibility";
import { runGenerateDailyDigest } from "../core/generate-daily-digest";
import { runGenerateWeeklyDigest } from "../core/generate-weekly-digest";
import { runSignalBatching } from "../core/signal-batching";
import { runDetectStructuralChanges } from "../core/detect-structural-changes";
import { runRelevanceThresholdRecalculation } from "../core/relevance-threshold-recalculation";
import { runDetectNewCompetitors } from "../core/detect-new-competitors";
import { runAnalyzeSectoral } from "../core/analyze-sectoral";
import { runAiCapacityCheck } from "../core/ai-capacity-check";
import { runOpsHealthCheck } from "../core/ops-health-check";
import { runFeedbackPatternDetection } from "../core/feedback-pattern-detection";
import { runPurgeRetention } from "../core/purge-retention";
import { runDetectSilentMonitors } from "../core/detect-silent-monitors";
import { runHeartbeat } from "../core/heartbeat";
import { runScrapeMonitor, onScrapeMonitorFailure } from "../core/scrape-monitor";
import { runDetectPlatform } from "../core/detect-platform";
import { runProbePricingCalculator } from "../core/probe-pricing-calculator";
import {
  runGenerateBattleCard,
  onGenerateBattleCardFailure,
} from "../core/generate-battle-card";

// Which queues a worker process consumes, keyed by WORKER_ROLE:
//   browser — the jobs that launch Chromium or render a PDF (scrape-monitor,
//             detect-platform, generate-battle-card). Deployed from
//             Dockerfile.queue-browser (browsers baked in, big RAM).
//   light   — everything else: crons, AI lane, extracts, digests, alerts.
//             Deployed from Dockerfile.queue-light (slim, no browsers).
// Every job body lives in src/core/* and is shared verbatim with the thin
// Trigger.dev wrappers in src/jobs/*.job.ts until the cutover deletes those.
export type WorkerRole = "browser" | "light";

export async function registerHandlers(role: WorkerRole): Promise<string[]> {
  const registered: string[] = [];
  const on = async <P extends object>(
    def: JobDef<P>,
    handler: (data: P) => Promise<unknown>,
  ): Promise<void> => {
    await work(def, (data) => handler(data));
    registered.push(def.name);
  };

  if (role === "light") {
    // Liveness probe — the post-deploy smoke test enqueues this and expects it
    // to complete ("is the worker consuming?").
    await on(queueHealth, async (data) => {
      logger.info({ note: data.note ?? null }, "queue-health processed");
    });

    // Leaf jobs — no downstream fan-out, or a single enqueue.
    await on(sendAlert, runSendAlert);
    await on(extractPricing, runExtractPricing);
    await on(extractJobs, runExtractJobs);
    await on(extractReviews, runExtractReviews);
    await on(extractSelfProfile, runExtractSelfProfile);
    await on(refreshCompetitorSummary, runRefreshCompetitorSummary);
    await on(scrapeAiVisibility, runScrapeAiVisibility);
    await on(scrapeTechStack, runScrapeTechStack);
    await on(sendWelcomeDigest, runSendWelcomeDigest);
    await on(sendMonthlyRecap, runSendMonthlyRecap);
    await on(backfillHistory, runBackfillHistory);
    // Pure fetch + deterministic harvest — no browser, so it belongs on the light
    // worker next to its sibling.
    await on(backfillPricingHistory, runBackfillPricingHistory);

    // The teaser is retryLimit 0 (a retry would re-spend the free grounding quota),
    // so EVERY failure is terminal: run the hook that writes the terminal
    // "unavailable" row, or the day-0 card polls forever. Trigger got this from its
    // onFailure; pg-boss has no per-job hook, so it is wired here.
    await work(aiVisibilityTeaser, async (data: OrgRefPayload) => {
      try {
        return await runAiVisibilityTeaser(data);
      } catch (err) {
        try {
          await onAiVisibilityTeaserFailure({ payload: data });
        } catch (hookErr) {
          logger.error({ err: hookErr, orgId: data.orgId }, "ai-visibility-teaser hook threw");
        }
        throw err;
      }
    });
    registered.push(aiVisibilityTeaser.name);

    // AI lane (concurrency 1 per the registry): classify → signal, plus the two
    // inflection detectors and the standing-query re-evaluation they can wake.
    await on(classifyChange, runClassifyChange);
    await on(generateSignal, runGenerateSignal);
    await on(evaluateStandingQueries, runEvaluateStandingQueries);
    await on(detectReviewThemeShifts, runDetectReviewThemeShifts);
    await on(detectHiringVelocityShifts, runDetectHiringVelocityShifts);
    await on(mineJobFacts, runMineJobFacts);
    await on(ingestContentItems, runIngestContentItems);
    await on(detectHiringFootprint, runDetectHiringFootprint);
    await on(detectSalaryShifts, runDetectSalaryShifts);

    // notify-onboarding-analysis polls with an in-process sleep (lib/job-wait) — a
    // rare, ≤8-min per-onboarding job; DB-only, so it lives on the light worker.
    await on(notifyOnboardingAnalysis, runNotifyOnboardingAnalysis);

    // Cron jobs. Schedules are synced from CRON_SCHEDULES on boot, but a fired
    // schedule still needs a work() handler to consume it. The light worker owns
    // all of them — including the five that Trigger's 10-schedule cap had left
    // cron-less (ai-capacity-check, ops-health-check, feedback-pattern-detection,
    // purge-retention, detect-silent-monitors).
    await on(scheduleScraping, runScheduleScraping);
    await on(scheduleTechStack, runScheduleTechStack);
    await on(schedulePlatformDetection, runSchedulePlatformDetection);
    await on(scheduleAiVisibility, runScheduleAiVisibility);
    await on(generateDailyDigest, runGenerateDailyDigest);
    await on(generateWeeklyDigest, runGenerateWeeklyDigest);
    await on(signalBatching, runSignalBatching);
    await on(detectStructuralChanges, runDetectStructuralChanges);
    await on(relevanceThresholdRecalculation, runRelevanceThresholdRecalculation);
    await on(detectNewCompetitors, runDetectNewCompetitors);
    await on(analyzeSectoral, runAnalyzeSectoral);
    await on(aiCapacityCheck, runAiCapacityCheck);
    await on(opsHealthCheck, runOpsHealthCheck);
    await on(feedbackPatternDetection, runFeedbackPatternDetection);
    await on(purgeRetention, runPurgeRetention);
    await on(detectSilentMonitors, runDetectSilentMonitors);

    // Dead-man's switch — pg-boss only (Trigger's schedule cap is what blocked it).
    await on(heartbeat, runHeartbeat);
  }

  if (role === "browser") {
    // Trigger ran scrape-monitor's onFailure hook after exhausting retries (mark the
    // monitor unscrapable, back off nextRunAt, propose alternatives — the anti-flood
    // guard). pg-boss has no per-job onFailure, so run it here on the TERMINAL
    // attempt: a NonRetriable abort, or the last retry (retryCount === retryLimit,
    // read via includeMetadata). Best-effort — a throw in the hook must not mask the
    // real error.
    const scrapeHandler = async (
      data: ScrapeMonitorPayload,
      job: Job<ScrapeMonitorPayload>,
    ): Promise<unknown> => {
      try {
        return await runScrapeMonitor(data);
      } catch (err) {
        const meta = job as JobWithMetadata<ScrapeMonitorPayload>;
        const terminal = err instanceof NonRetriable || meta.retryCount >= meta.retryLimit;
        if (terminal) {
          try {
            await onScrapeMonitorFailure({ payload: data, error: err });
          } catch (hookErr) {
            logger.error(
              { err: hookErr, monitorId: data.monitorId },
              "scrape-monitor onFailure hook threw",
            );
          }
        }
        throw err;
      }
    };
    await work(scrapeMonitor, scrapeHandler, { includeMetadata: true });
    registered.push(scrapeMonitor.name);

    // Per-competitor platform detection (patch-31) — step B may launch Chromium.
    await on(detectPlatform, runDetectPlatform);

    // Pricing calculator probe (P4) — drives a competitor's public calculator in
    // Chromium, so it belongs on this worker with the other browser jobs.
    await on(probePricingCalculator, runProbePricingCalculator);

    // On-demand battle card — launches Chromium to render the PDF. The summary-less
    // grounding path runs refresh-competitor-summary inline (Decision #1).
    //
    // Same terminal-attempt rule as scrape-monitor above: the "could not be
    // generated" notification must fire ONCE per click, not once per retry. A
    // retryable error (an AI rate limit, a provider 5xx) runs the body three times,
    // and notifying inside it sent the user three identical toasts for one card.
    const battleCardHandler = async (
      data: GenerateBattleCardPayload,
      job: Job<GenerateBattleCardPayload>,
    ): Promise<unknown> => {
      try {
        return await runGenerateBattleCard(data);
      } catch (err) {
        const meta = job as JobWithMetadata<GenerateBattleCardPayload>;
        if (err instanceof NonRetriable || meta.retryCount >= meta.retryLimit) {
          await onGenerateBattleCardFailure({ payload: data, error: err });
        }
        throw err;
      }
    };
    await work(generateBattleCard, battleCardHandler, { includeMetadata: true });
    registered.push(generateBattleCard.name);
  }

  return registered;
}
