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
// Payload types mirror each job's zod InputSchema in apps/workers/src/core/*.
// They are the contract the API enqueues against, so a drift here is a runtime
// parse error on the worker — keep them in sync when a schema changes.
export type ScrapeMonitorPayload = {
  monitorId: string;
  force?: boolean;
  triggeredBy?: "user_forced_rescan";
  userId?: string;
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
  promotional?: boolean;
  observedRegion?: string;
  /** L2 archive backfill: backdate the pricing_history rows to the capture time. */
  recordedAt?: string;
  /** Pricing Intelligence P1 — the change row of the SAME scrape, whose signal
   * routing scrape-monitor DEFERRED to this extractor: a non-empty deterministic
   * batch diff owns the signal; otherwise the lexical classifier is the fallback.
   * Absent on manual re-triggers, backfill, and scrapes with no change row. */
  changeId?: string;
  /** Whether the deferred change passed evaluateSignificance — i.e. worth a
   * lexical classify when the deterministic diff turns out empty. */
  lexicalWorth?: boolean;
};
export type ProbePricingCalculatorPayload = {
  competitorId: string;
  monitorId: string;
  /** The pricing page the `dynamic` capture landed on — the calculator's address. */
  url: string;
};
export type ExtractJobsPayload = { snapshotId: string; competitorId: string };
export type ExtractReviewsPayload = { snapshotId: string; competitorId: string; source: string };
export type ScrapeAiVisibilityPayload = { orgId: string; notifyOnComplete?: boolean };
export type RefreshCompetitorSummaryPayload = {
  competitorId: string;
  /** On-demand refresh route only → drop a durable "summary ready" notification. */
  notifyOnComplete?: boolean;
};
export type GenerateBattleCardPayload = {
  competitorId: string;
  orgId: string;
  productId?: string;
  notifyOnComplete?: boolean;
};
export type NotifyOnboardingPayload = { orgId: string; competitorIds: string[] };
export type BackfillHistoryPayload = {
  monitorId: string;
  competitorId: string;
  sourceType: string;
};
export type OrgRefPayload = { orgId: string };
export type EvaluateStandingQueriesPayload = {
  orgId: string;
  competitorId: string;
  category: string;
  severity: "low" | "medium" | "high" | "critical";
  signalId: string;
};
export type Empty = Record<string, never>;

// ── Pipeline / on-demand worker jobs ──────────────────────────────────────────
// scrape-monitor runs on a single bounded lane. The collection doctrine caps the
// cascade at L2 (datacenter egress, flat-cost and fast), so there is no slow paid
// level left to isolate — the previous two-lane split was retired with L3/L4.
// Default 3, not 5: on the target VPS (8 GB) the browser worker shares the box with
// the light worker and the queue Postgres, and each in-flight scrape can hold a
// Chromium. There is no second lane to tune — the slow lane was retired with L3/L4
// (see above), so this single number is the whole scrape concurrency budget.
// expireIn is 15 min, not the 5 it was: prod runs already reach 300s (a pricing
// capture measured 302.7s), and pg-boss cannot ABORT a JS handler when a job
// expires — it just marks the job expired and retries it, while the original
// handler keeps scraping. So a ceiling set at the real p100 did not cap anything;
// it duplicated the slowest scrapes and left the monitor row stamped in-flight
// with no failure to explain it. 15 min sits above every observed run.
export const scrapeMonitor = defineJob<ScrapeMonitorPayload>("scrape-monitor", {
  expireInSeconds: 900,
  concurrency: Number(process.env.SCRAPE_CONCURRENCY ?? 3),
  deadLetter: PIPELINE_DLQ,
});

// Priority for a scrape someone is WAITING on, versus the hourly fan-out that
// nobody is watching. pg-boss fetches highest priority first, so a click no longer
// queues behind up to a thousand cron-seeded monitors — which is how a 13-second
// hiring scrape ended up 35 minutes late. Cron enqueues stay at the default 0.
export const USER_SCRAPE_PRIORITY = 100;

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
export const refreshCompetitorSummary = defineJob<RefreshCompetitorSummaryPayload>(
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
// Pricing Intelligence P4 — measure what a calculator-priced competitor actually
// charges, by driving its own public calculator. Event-triggered off a live
// `dynamic` pricing capture, deduped to one run per competitor per day by the
// caller's singletonKey.
//
// retryLimit 0, deliberately: a probe is an INTERACTION with someone else's site,
// not a computation. Retrying it would repeat the visit for the same information,
// and every failure mode it has (a refusal, a login wall, selectors that no longer
// resolve, a series that failed its sanity checks) is one a retry five seconds
// later reproduces exactly. The next scheduled probe is the retry.
// expireIn 180s covers the 90s probe budget plus screenshot uploads.
export const probePricingCalculator = defineJob<ProbePricingCalculatorPayload>(
  "probe-pricing-calculator",
  { retryLimit: 0, expireInSeconds: 180, concurrency: 1 },
);
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
// Lever 7 — free one-time "share of model" taste at onboarding. Event-triggered,
// never retried (would re-spend free-tier quota); writes one terminal row per org.
export const aiVisibilityTeaser = defineJob<OrgRefPayload>("ai-visibility-teaser", {
  retryLimit: 0,
  expireInSeconds: 120,
});
// Lever 5 brick 1 — D0 welcome digest, event-triggered from onboarding/complete.
export const sendWelcomeDigest = defineJob<OrgRefPayload>("send-welcome-digest", {
  retryLimit: 0,
  expireInSeconds: 60,
});
// Lever 9 — monthly recap teaser email, triggered from generate-daily-digest at the
// org's local first-of-month morning (no new cron; idempotency-keyed per org+month).
export const sendMonthlyRecap = defineJob<{ orgId: string; month: string }>(
  "send-monthly-recap",
  { retryLimit: 0, expireInSeconds: 60 },
);
// concurrency 2, not the default 1: pg-boss spawns ONE loop per localConcurrency and
// that loop awaits its own handler, so a single wedged run takes the whole queue
// offline with nothing to say so. Measured on prod 2026-07-29: three user-triggered
// cards sat `created` for six hours while scrape-monitor on the SAME process kept
// fetching normally, and only a container recreate cleared it. A second loop is the
// cheap half of the fix (the loud half is the stuck-queue alarm in the heartbeat) —
// cards are on-demand and rare, so two in flight costs nothing.
export const generateBattleCard = defineJob<GenerateBattleCardPayload>("generate-battle-card", {
  expireInSeconds: 180, // browser (PDF via Playwright) — browser worker
  concurrency: 2,
});
export const notifyOnboardingAnalysis = defineJob<NotifyOnboardingPayload>(
  "notify-onboarding-analysis",
  { expireInSeconds: 600 },
);
// L2 archive backfill (Wayback). Event-triggered from scrape-monitor's first
// capture; never retried (archive inserts aren't idempotent), politely throttled.
export const backfillHistory = defineJob<BackfillHistoryPayload>("backfill-history", {
  retryLimit: 0,
  expireInSeconds: 300,
});

// Complaint-theme / hiring-velocity inflection detectors. Event-triggered per
// competitor off extract-reviews / extract-jobs (never a cron), each emitting one
// grounded signal through the synthetic anchor→snapshot→change chain.
export const detectReviewThemeShifts = defineJob<CompetitorRefPayload>(
  "detect-review-theme-shifts",
  { expireInSeconds: 60 },
);
export const detectHiringVelocityShifts = defineJob<CompetitorRefPayload>(
  "detect-hiring-velocity-shifts",
  { expireInSeconds: 60 },
);
// Job-description fact mining (Hiring Intelligence v2 P1), event-triggered per
// competitor off extract-jobs. Up to four batched model calls per run, so it gets
// a longer window than its two sibling detectors, which do no AI at all.
export const mineJobFacts = defineJob<CompetitorRefPayload>("mine-job-facts", {
  expireInSeconds: 300,
});
// Standing-query re-evaluation, targeted off generate-signal. Shares the groq lane
// (concurrency 1) so the judge + internal Ask run never starve classify→signal.
export const evaluateStandingQueries = defineJob<EvaluateStandingQueriesPayload>(
  "evaluate-standing-queries",
  { expireInSeconds: 300, concurrency: 1 },
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

// Dead-man's switch: pings an external heartbeat monitor every few minutes so the
// alert fires from OUTSIDE when this system stops running. Never retried — a
// missed ping is the signal, and a retry storm would just spam the DLQ.
export const heartbeat = defineJob<Empty>("heartbeat", {
  retryLimit: 0,
  expireInSeconds: 30,
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
  // Every 5 min: the external monitor's "no ping for N minutes" alert is the only
  // thing that can page when the whole worker fleet is down.
  heartbeat: "*/5 * * * *",
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
