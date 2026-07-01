import { defineJob, getBoss } from "./boss";

// ---------------------------------------------------------------------------
// Single source of truth for every Outrival job: name, payload type, queue
// policy (retry/expire/concurrency/dead-letter). Imported by @outrival/api
// (enqueue) and @outrival/workers (enqueue + work + schedule).
//
// Retry mapping: pg-boss retryLimit = number of RETRIES; Trigger maxAttempts N
// → retryLimit N-1. expireInSeconds = old Trigger `maxDuration`. concurrency =
// old `queue({concurrencyLimit})`, now a rolling per-node worker count.
// Payloads marked "refine in Phase 2" are typed minimally until their handler
// is wired against its zod InputSchema.
// ---------------------------------------------------------------------------

// Shared dead-letter sink for the critical scrape→signal pipeline. Jobs that
// exhaust retries land here for inspection / redrive; no worker consumes it.
const PIPELINE_DLQ = "outrival-dlq";
export const deadLetterQueue = defineJob<Record<string, never>>(PIPELINE_DLQ);

// ── Payload types (exported so handlers + API routes share them) ──────────────
export type ScrapeMonitorPayload = {
  monitorId: string;
  force?: boolean;
  triggeredBy?: string;
  forcedRescanLogId?: string;
};
export type ClassifyChangePayload = { changeId: string };
export type GenerateSignalPayload = {
  changeId: string;
  classification?: unknown; // ClassificationSchema (parsed by the handler)
  pricingTransition?: unknown;
};
export type SendAlertPayload = { signalId: string };
export type CompetitorRefPayload = { competitorId: string };
export type ExtractSelfProfilePayload = { competitorId: string; snapshotId: string };
export type ExtractPricingPayload = {
  snapshotId: string;
  competitorId: string;
  status?: string;
  promotional?: unknown;
  observedRegion?: string;
};
export type ExtractJobsPayload = { snapshotId: string; competitorId: string };
export type ExtractReviewsPayload = { snapshotId: string; competitorId: string; source: string };
export type ScrapeAiVisibilityPayload = { orgId: string };
export type GenerateBattleCardPayload = { competitorId: string; productId?: string }; // refine in Phase 2
export type NotifyOnboardingPayload = { orgId: string; sessionId?: string }; // refine in Phase 2
export type OrgRefPayload = { orgId: string };
export type Empty = Record<string, never>;

// ── Pipeline / on-demand worker jobs (14) ─────────────────────────────────────
// scrape-monitor runs on two bounded lanes (same handler, two queue names) so
// learned-slow scrapes can't starve fast ones — the patch-20 two-lane split.
export const scrapeMonitor = defineJob<ScrapeMonitorPayload>("scrape-monitor", {
  expireInSeconds: 300,
  concurrency: Number(process.env.SCRAPE_CONCURRENCY ?? 5),
  deadLetter: PIPELINE_DLQ,
});
export const scrapeMonitorSlow = defineJob<ScrapeMonitorPayload>("scrape-monitor-slow", {
  expireInSeconds: 300,
  concurrency: Number(process.env.SCRAPE_SLOW_CONCURRENCY ?? 2),
  deadLetter: PIPELINE_DLQ,
});

export const classifyChange = defineJob<ClassifyChangePayload>("classify-change", {
  expireInSeconds: 120,
  concurrency: 1, // groq lane (see Decision #2: global serialization)
  deadLetter: PIPELINE_DLQ,
});
export const generateSignal = defineJob<GenerateSignalPayload>("generate-signal", {
  expireInSeconds: 120,
  concurrency: 1, // groq lane
  deadLetter: PIPELINE_DLQ,
});
export const sendAlert = defineJob<SendAlertPayload>("send-alert", {
  expireInSeconds: 60,
  deadLetter: PIPELINE_DLQ,
  // API/handler dedup: pass `{ singletonKey: signalId }` (was Trigger idempotencyKey).
});
export const refreshCompetitorSummary = defineJob<CompetitorRefPayload>(
  "refresh-competitor-summary",
  { expireInSeconds: 120, concurrency: Number(process.env.SUMMARY_CONCURRENCY ?? 1) },
);
export const detectPlatform = defineJob<CompetitorRefPayload>("detect-platform", {
  retryLimit: 1, // was maxAttempts 2
  expireInSeconds: 120,
  concurrency: 2, // browser (step-B capture) — lives on the browser worker
});
export const extractSelfProfile = defineJob<ExtractSelfProfilePayload>("extract-self-profile", {
  expireInSeconds: 120,
});
export const extractPricing = defineJob<ExtractPricingPayload>("extract-pricing", {
  expireInSeconds: 120,
});
export const extractJobs = defineJob<ExtractJobsPayload>("extract-jobs", { expireInSeconds: 180 });
export const extractReviews = defineJob<ExtractReviewsPayload>("extract-reviews", {
  expireInSeconds: 120,
});
export const scrapeTechStack = defineJob<CompetitorRefPayload>("scrape-tech-stack", {
  expireInSeconds: 120,
});
export const scrapeAiVisibility = defineJob<ScrapeAiVisibilityPayload>("scrape-ai-visibility", {
  retryLimit: 1, // was maxAttempts 2
  expireInSeconds: 300,
});
export const generateBattleCard = defineJob<GenerateBattleCardPayload>("generate-battle-card", {
  expireInSeconds: 180, // browser (PDF via Playwright) — browser worker
});
export const notifyOnboardingAnalysis = defineJob<NotifyOnboardingPayload>(
  "notify-onboarding-analysis",
  { expireInSeconds: 600 },
);

// ── Scheduled / cron jobs (16 → all become boss.schedule(), no 10-cron cap) ───
export const scheduleScraping = defineJob<Empty>("schedule-scraping", { expireInSeconds: 120 });
export const scheduleTechStack = defineJob<Empty>("schedule-tech-stack", { expireInSeconds: 120 });
export const schedulePlatformDetection = defineJob<Empty>("schedule-platform-detection", {
  expireInSeconds: 120,
});
export const scheduleAiVisibility = defineJob<Empty>("schedule-ai-visibility", {
  expireInSeconds: 120,
});
export const generateDailyDigest = defineJob<Empty>("generate-daily-digest", {
  expireInSeconds: 300,
});
export const generateWeeklyDigest = defineJob<Empty>("generate-weekly-digest", {
  retryLimit: 3, // was maxAttempts 4
  expireInSeconds: 600,
});
export const signalBatching = defineJob<Empty>("signal-batching", { expireInSeconds: 300 });
export const detectStructuralChanges = defineJob<Empty>("detect-structural-changes", {
  expireInSeconds: 600,
});
export const relevanceThresholdRecalculation = defineJob<Empty>(
  "relevance-threshold-recalculation",
  { expireInSeconds: 300 },
);
export const detectNewCompetitors = defineJob<Empty>("detect-new-competitors", {
  expireInSeconds: 600,
});
export const analyzeSectoral = defineJob<Empty>("analyze-sectoral", { expireInSeconds: 600 });
// The five below were shipped CRON-LESS on Trigger (10-schedule cap) — restored here.
export const aiCapacityCheck = defineJob<Empty>("ai-capacity-check", { expireInSeconds: 60 });
export const opsHealthCheck = defineJob<Empty>("ops-health-check", { expireInSeconds: 120 });
export const feedbackPatternDetection = defineJob<Empty>("feedback-pattern-detection", {
  expireInSeconds: 120,
});
export const purgeRetention = defineJob<Empty>("purge-retention", { expireInSeconds: 600 });
export const detectSilentMonitors = defineJob<Empty>("detect-silent-monitors", {
  expireInSeconds: 300,
});

// End-to-end liveness probe: enqueue from anywhere, a worker completes it.
// Used by the post-deploy smoke test ("is the worker consuming?").
export const queueHealth = defineJob<{ note?: string }>("queue-health", {
  retryLimit: 0,
  expireInSeconds: 30,
});

/**
 * Cron expressions (UTC), registered via boss.schedule() on the worker.
 * No 10-schedule cap — the five previously-capped crons are all present.
 */
export const CRON_SCHEDULES: Record<string, string> = {
  "schedule-scraping": "0 * * * *",
  "generate-daily-digest": "0 * * * *",
  "schedule-tech-stack": "0 6 * * *",
  "schedule-platform-detection": "0 4 * * *",
  "schedule-ai-visibility": "0 7 * * 1",
  "signal-batching": "0 */6 * * *",
  "detect-structural-changes": "0 6 * * 1",
  "generate-weekly-digest": "0 8 * * 1",
  "relevance-threshold-recalculation": "0 3 * * 0",
  "detect-new-competitors": "0 20 * * 0",
  "analyze-sectoral": "0 7 * * 1",
  "ai-capacity-check": "*/30 * * * *",
  "ops-health-check": "0 */6 * * *",
  "feedback-pattern-detection": "0 9 * * 1",
  "purge-retention": "0 4 * * *",
  "detect-silent-monitors": "0 8 * * *",
};

/**
 * Reconcile DB schedules with CRON_SCHEDULES: upsert every entry, remove any
 * schedule no longer in the map (otherwise a deleted cron keeps firing forever).
 * Called on boot by the ONE worker that owns scheduling.
 */
export async function syncSchedules(): Promise<{ upserted: number; removed: string[] }> {
  const boss = getBoss();
  for (const [name, cron] of Object.entries(CRON_SCHEDULES)) {
    await boss.schedule(name, cron);
  }
  const existing = await boss.getSchedules();
  const removed: string[] = [];
  for (const s of existing) {
    if (!(s.name in CRON_SCHEDULES)) {
      await boss.unschedule(s.name, s.key);
      removed.push(s.name);
    }
  }
  return { upserted: Object.keys(CRON_SCHEDULES).length, removed };
}
