import { logger } from "./job-logger";
import { getActiveProvider, getActiveModel, consumeUsage, withAiContext } from "@outrival/ai";
import {
  db,
  pricingHistory,
  planEntitlements,
  priceTiers,
  pricePoints,
  jobCounts,
  hiringMetrics,
  reviewScores,
  signalFeed,
  scrapeRuns,
  aiRuns,
  extractionRuns,
  backfillRuns,
  numericClaims,
  techStackHistory,
  platformDetectionRuns,
  aiVisibilityResults,
} from "@outrival/db";
import { and, desc, eq, gt, gte, inArray, lt, ne, sql } from "drizzle-orm";

// Time-series / analytics access for the workers. These tables used to live in
// ClickHouse; they are now plain Postgres tables in the same Neon database.
// Everything here stays best-effort: a logging/analytics failure must never break
// a scrape or an AI job (try/catch, never throws — except loggedAi, which rethrows
// the wrapped call so Trigger.dev still retries the job).

async function bestEffort(op: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    logger.error(`analytics ${op} failed`, { err: String(err) });
  }
}

async function bestEffortRead<T>(op: string, fn: () => Promise<T[]>): Promise<T[] | null> {
  try {
    return await fn();
  } catch (err) {
    logger.error(`analytics ${op} failed`, { err: String(err) });
    return null;
  }
}

export interface SignalFeedRow {
  org_id: string;
  competitor_id: string;
  category: string;
  severity: string;
  recorded_at: Date;
}

export async function insertSignalFeed(row: SignalFeedRow): Promise<void> {
  await bestEffort("signal_feed insert", () =>
    db.insert(signalFeed).values({
      orgId: row.org_id,
      competitorId: row.competitor_id,
      category: row.category,
      severity: row.severity,
      recordedAt: row.recorded_at,
    }),
  );
}

// --- Ops observability (patch-02). Best-effort, never throws. ---

export interface ScrapeRunRow {
  monitor_id: string;
  competitor_id: string;
  source_type: string;
  // `skipped` = a benign non-outcome that must NOT count as a failure: the source is
  // healthy but had nothing to record this cycle (no youtube channel, crt.sh down).
  status: "success" | "no_change" | "failed" | "skipped";
  level: number; // cascade level: 0/1 free, 2 datacenter egress
  attempts: number;
  failure_reason: string;
  // Collection doctrine: the site refused us (block/challenge/robots) and we stopped.
  refused?: boolean;
  refusal_reason?: string;
  duration_ms: number;
  recorded_at: Date;
}

export async function logScrapeRun(row: ScrapeRunRow): Promise<void> {
  await bestEffort("scrape_runs insert", () =>
    db.insert(scrapeRuns).values({
      monitorId: row.monitor_id,
      competitorId: row.competitor_id,
      sourceType: row.source_type,
      status: row.status,
      level: row.level,
      attempts: row.attempts,
      failureReason: row.failure_reason,
      refused: row.refused ?? false,
      refusalReason: row.refusal_reason ?? "",
      durationMs: row.duration_ms,
      recordedAt: row.recorded_at,
    }),
  );
}

export interface ExtractionRunRow {
  competitor_id: string;
  source_type: string;
  domain: string;
  resolution: string; // structured | cache | heal | ai_fallback (patch-30)
  extractor_version: number;
  ai_used: 0 | 1; // 0 for structured/cache, 1 for heal/ai_fallback
  recorded_at: Date;
}

// Staged extraction resolution per scrape (patch-30): which tier resolved the
// extraction, and whether an AI call was spent. Powers the /admin "extraction
// resolution" panel — the direct arbiter of extraction AI cost.
export async function logExtractionRun(row: ExtractionRunRow): Promise<void> {
  await bestEffort("extraction_runs insert", () =>
    db.insert(extractionRuns).values({
      competitorId: row.competitor_id,
      sourceType: row.source_type,
      domain: row.domain,
      resolution: row.resolution,
      extractorVersion: row.extractor_version,
      aiUsed: row.ai_used,
      recordedAt: row.recorded_at,
    }),
  );
}

// Archive-backfill outcome per run (2026-07-10 audit / first-signal SLO):
// records WHY a best-effort backfill ended — the queryable miss buckets behind
// docs/slos/onboarding-first-signal.md. See resolveBackfillOutcome (backfill-guard).
export interface BackfillRunRow {
  monitor_id: string;
  competitor_id: string;
  source_type: string;
  outcome: string;
  detail: string | null;
  archives_seeded: number;
  change_triggered: 0 | 1;
  duration_ms: number;
}

export async function logBackfillRun(row: BackfillRunRow): Promise<void> {
  await bestEffort("backfill_runs insert", () =>
    db.insert(backfillRuns).values({
      monitorId: row.monitor_id,
      competitorId: row.competitor_id,
      sourceType: row.source_type,
      outcome: row.outcome,
      detail: row.detail,
      archivesSeeded: row.archives_seeded,
      changeTriggered: row.change_triggered,
      durationMs: row.duration_ms,
      recordedAt: new Date(),
    }),
  );
}

export interface PlatformDetectionRunRow {
  competitor_id: string;
  domain: string;
  stage: "a_static" | "b_browser"; // step A (no browser) vs step B (rendered)
  framework: string;
  cms: string;
  ats: string;
  pricing_widget: string;
  status_page: string;
  changelog: string;
  techs_found: number;
  duration_ms: number;
  recorded_at: Date;
}

// Platform detection outcome per run (patch-31): which stage resolved it and what
// it routed. Powers the /admin platform-detection panel (step A vs B share, routed
// connectors) — best-effort, a hiccup never blocks detection.
export async function logPlatformDetectionRun(row: PlatformDetectionRunRow): Promise<void> {
  await bestEffort("platform_detection_runs insert", () =>
    db.insert(platformDetectionRuns).values({
      competitorId: row.competitor_id,
      domain: row.domain,
      stage: row.stage,
      framework: row.framework,
      cms: row.cms,
      ats: row.ats,
      pricingWidget: row.pricing_widget,
      statusPage: row.status_page,
      changelog: row.changelog,
      techsFound: row.techs_found,
      durationMs: row.duration_ms,
      recordedAt: row.recorded_at,
    }),
  );
}

export type AiRunStatus = "success" | "parse_failed" | "error";

// Best-effort owner of the spend (cost attribution, 2026-07 audit). Pass what the
// call site already has in scope — never add a query just to fill this.
export interface AiRunAttribution {
  orgId?: string | null;
  competitorId?: string | null;
}

// The job logs the AI run, never the @outrival/ai task (kept pure, no DB). The
// task returns null on a parse miss → "parse_failed"; a thrown call → "error".
//
// MUST run inside withAiContext (loggedAi provides it) for the provider/model/
// token reads below to see what complete() marked: outside a context they fall
// back to the static labels and zero tokens (the pre-fix prod behaviour).
export async function logAiRun(
  task: string,
  provider: string,
  model: string,
  status: AiRunStatus,
  attribution?: AiRunAttribution,
): Promise<void> {
  // Prefer the real pool provider the call ran on (cerebras|groq|hyperbolic),
  // captured by complete() in the same async context (patch-22). Falls back to the
  // static provider from AI_CONFIG when the pool didn't run (e.g. Claude fallback).
  const actual = getActiveProvider() ?? provider;
  // Same for the model: AI_CONFIG.model is IGNORED on the pool path (callLLM picks
  // provider.fastModel ?? provider.model), so logging it attributed cost to a model
  // that never ran. Fall back to the static one only when the pool didn't run.
  const actualModel = getActiveModel() ?? model;
  // Read-and-clear the tokens accumulated by complete() since the last log point,
  // so this row carries the full cost of the task (incl. any self-check pass).
  const usage = consumeUsage();
  await bestEffort("ai_runs insert", () =>
    db.insert(aiRuns).values({
      task,
      provider: actual,
      model: actualModel,
      status,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
      orgId: attribution?.orgId ?? null,
      competitorId: attribution?.competitorId ?? null,
      recordedAt: new Date(),
    }),
  );
}

// Wrap an @outrival/ai task call so its outcome lands in ai_runs (patch-02):
// a value → success, null → parse_failed, a throw (e.g. a 429 after the SDK's own
// retries) → error, rethrown so Trigger.dev still retries the job.
// withAiContext establishes the token/provider scope in THIS frame — without it
// the marks complete() makes in its child frames never reach logAiRun (Bun and
// the Trigger runtime both drop the lazy enterWith; ai_runs logged 0 tokens).
export async function loggedAi<T>(
  task: string,
  config: { provider: string; model: string },
  fn: () => Promise<T>,
  attribution?: AiRunAttribution,
): Promise<T> {
  return withAiContext(async () => {
    try {
      const res = await fn();
      await logAiRun(
        task,
        config.provider,
        config.model,
        res == null ? "parse_failed" : "success",
        attribution,
      );
      return res;
    } catch (err) {
      await logAiRun(task, config.provider, config.model, "error", attribution);
      throw err;
    }
  });
}

// --- Ops health reads (patch-02, ops-health-check job). Best-effort: null on
//     error → the health check simply skips that threshold. ---

export interface ScrapeHealthWindow {
  total: number;
  failed: number;
  proxy: number; // paid scrapes (level >= 2: datacenter egress)
  refused: number; // collection doctrine: the site refused us (block/challenge/robots)
}

export async function getScrapeHealth(hours: number): Promise<ScrapeHealthWindow | null> {
  const rows = await bestEffortRead("getScrapeHealth", () =>
    db
      .select({
        total: sql<string>`count(*)`,
        failed: sql<string>`count(*) filter (where ${scrapeRuns.status} = 'failed')`,
        proxy: sql<string>`count(*) filter (where ${scrapeRuns.level} >= 2)`,
        refused: sql<string>`count(*) filter (where ${scrapeRuns.refused} = true)`,
      })
      .from(scrapeRuns)
      .where(gte(scrapeRuns.recordedAt, sql`now() - make_interval(hours => ${hours})`)),
  );
  if (!rows || !rows[0]) return null;
  return {
    total: Number(rows[0].total),
    failed: Number(rows[0].failed),
    proxy: Number(rows[0].proxy),
    refused: Number(rows[0].refused),
  };
}

export async function getAiParseHealth(
  hours: number,
): Promise<{ total: number; parseFailed: number } | null> {
  const rows = await bestEffortRead("getAiParseHealth", () =>
    db
      .select({
        total: sql<string>`count(*)`,
        parse_failed: sql<string>`count(*) filter (where ${aiRuns.status} = 'parse_failed')`,
      })
      .from(aiRuns)
      .where(gte(aiRuns.recordedAt, sql`now() - make_interval(hours => ${hours})`)),
  );
  if (!rows || !rows[0]) return null;
  return { total: Number(rows[0].total), parseFailed: Number(rows[0].parse_failed) };
}

export async function getRecentSignalCount(hours: number): Promise<number | null> {
  const rows = await bestEffortRead("getRecentSignalCount", () =>
    db
      .select({ c: sql<string>`count(*)` })
      .from(signalFeed)
      .where(gte(signalFeed.recordedAt, sql`now() - make_interval(hours => ${hours})`)),
  );
  if (!rows || !rows[0]) return null;
  return Number(rows[0].c);
}

// All-quiet weekly digest (Lever 6): best-effort count of this org's scrape_runs
// in [start, end). 0 both on failure and on a genuinely idle window — the caller
// treats them the same (omit the "M times" clause).
export async function getWeeklyCheckCount(
  competitorIds: string[],
  start: Date,
  end: Date,
): Promise<number> {
  if (competitorIds.length === 0) return 0;
  const rows = await bestEffortRead("getWeeklyCheckCount", () =>
    db
      .select({ c: sql<string>`count(*)` })
      .from(scrapeRuns)
      .where(
        and(
          inArray(scrapeRuns.competitorId, competitorIds),
          gte(scrapeRuns.recordedAt, start),
          lt(scrapeRuns.recordedAt, end),
        ),
      ),
  );
  if (!rows || !rows[0]) return 0;
  return Number(rows[0].c);
}

export interface PricingHistoryRow {
  competitor_id: string;
  plan_name: string;
  // null for quote-based tiers (Enterprise / "Contact sales" / Custom).
  price: number | null;
  currency: string;
  billing_period: string;
  // Dimensional pricing (2026 models). unit = what a usage/per-seat price applies to
  // ("API call", "resolved conversation", "credit", "seat"); null = flat. included_
  // quantity = units bundled into the plan; null = N/A. See docs/pricing-coverage-2026.md.
  unit?: string | null;
  included_quantity?: number | null;
  // patch-11 taxonomy columns.
  status: string;
  promotional: number;
  observed_region: string;
  // patch-33 — page-level free-trial facts, identical across a batch's plan rows.
  has_trial?: number | null;
  trial_days?: number | null;
  trial_requires_card?: number | null;
  // Permanent free plan advertised on the page (detect-free-plan). Page-level, like
  // the trial facts. 0/1; null = not assessed.
  has_free_plan?: number | null;
  // Pricing Intelligence P3 — HOW a metered plan charges. All null on a plain
  // subscription, which is every legacy row: these describe a metered plan and
  // their absence is not a fact about the plan.
  rate_structure?: string | null;
  minimum_amount?: number | null;
  percentage_rate?: number | null;
  recorded_at: Date;
}

export async function insertPricingHistory(rows: PricingHistoryRow[]): Promise<void> {
  if (rows.length === 0) return;
  await bestEffort("pricing_history insert", () =>
    db.insert(pricingHistory).values(
      rows.map((r) => ({
        competitorId: r.competitor_id,
        planName: r.plan_name,
        price: r.price,
        currency: r.currency,
        billingPeriod: r.billing_period,
        unit: r.unit ?? null,
        includedQuantity: r.included_quantity ?? null,
        status: r.status,
        promotional: r.promotional,
        observedRegion: r.observed_region,
        hasTrial: r.has_trial ?? null,
        trialDays: r.trial_days ?? null,
        trialRequiresCard: r.trial_requires_card ?? null,
        hasFreePlan: r.has_free_plan ?? null,
        rateStructure: r.rate_structure ?? null,
        minimumAmount: r.minimum_amount ?? null,
        percentageRate: r.percentage_rate ?? null,
        recordedAt: r.recorded_at,
      })),
    ),
  );
}

// One features × plans matrix row (Pricing Intelligence P2), snake_case like
// PricingHistoryRow so the shared differ reads both sides without mapping.
// recorded_at MUST be the same batch timestamp as the pricing_history rows of
// the same run — the two tables describe one capture.
export interface PlanEntitlementRow {
  competitor_id: string;
  plan_name: string;
  feature_slug: string;
  feature_label: string;
  kind: string;
  value_num: number | null;
  value_text: string | null;
  unit: string | null;
  reset_period: string | null;
  is_canonical: number;
  recorded_at: Date;
}

export async function insertPlanEntitlements(rows: PlanEntitlementRow[]): Promise<void> {
  if (rows.length === 0) return;
  await bestEffort("plan_entitlements insert", () =>
    db.insert(planEntitlements).values(
      rows.map((r) => ({
        competitorId: r.competitor_id,
        planName: r.plan_name,
        featureSlug: r.feature_slug,
        featureLabel: r.feature_label,
        kind: r.kind,
        valueNum: r.value_num,
        valueText: r.value_text,
        unit: r.unit,
        resetPeriod: r.reset_period,
        isCanonical: r.is_canonical,
        recordedAt: r.recorded_at,
      })),
    ),
  );
}

// The latest stored entitlement batch — the diff baseline. Called BEFORE the
// fresh batch is inserted, like getPreviousPricing. Best-effort: null on miss.
export async function getPreviousEntitlements(
  competitorId: string,
): Promise<PlanEntitlementRow[] | null> {
  const rows = await bestEffortRead<PlanEntitlementRow>("getPreviousEntitlements", () =>
    db
      .select({
        competitor_id: planEntitlements.competitorId,
        plan_name: planEntitlements.planName,
        feature_slug: planEntitlements.featureSlug,
        feature_label: planEntitlements.featureLabel,
        kind: planEntitlements.kind,
        value_num: planEntitlements.valueNum,
        value_text: planEntitlements.valueText,
        unit: planEntitlements.unit,
        reset_period: planEntitlements.resetPeriod,
        is_canonical: planEntitlements.isCanonical,
        recorded_at: planEntitlements.recordedAt,
      })
      .from(planEntitlements)
      .where(
        and(
          eq(planEntitlements.competitorId, competitorId),
          eq(
            planEntitlements.recordedAt,
            sql`(select max(recorded_at) from plan_entitlements where competitor_id = ${competitorId})`,
          ),
        ),
      )
      .orderBy(planEntitlements.planName, planEntitlements.featureLabel),
  );
  return rows && rows.length > 0 ? rows : null;
}

// One published volume band (Pricing Intelligence P3). Same batch timestamp as
// the pricing_history rows of the run — one capture, one moment.
export interface PriceTierRow {
  competitor_id: string;
  plan_name: string;
  unit: string | null;
  from_qty: number;
  to_qty: number | null;
  unit_price: number | null;
  flat_fee: number | null;
  recorded_at: Date;
}

export async function insertPriceTiers(rows: PriceTierRow[]): Promise<void> {
  if (rows.length === 0) return;
  await bestEffort("price_tiers insert", () =>
    db.insert(priceTiers).values(
      rows.map((r) => ({
        competitorId: r.competitor_id,
        planName: r.plan_name,
        unit: r.unit,
        fromQty: r.from_qty,
        toQty: r.to_qty,
        unitPrice: r.unit_price,
        flatFee: r.flat_fee,
        recordedAt: r.recorded_at,
      })),
    ),
  );
}

// What a metered plan costs at a reference volume — the row that lets a
// usage-based competitor enter a price comparison at all.
export interface PricePointRow {
  competitor_id: string;
  plan_name: string;
  meter_unit: string;
  reference_qty: number;
  effective_monthly_cost: number;
  currency: string;
  method: "computed_from_tiers" | "calculator_probe" | "published";
  recorded_at: Date;
}

export async function insertPricePoints(rows: PricePointRow[]): Promise<void> {
  if (rows.length === 0) return;
  await bestEffort("price_points insert", () =>
    db.insert(pricePoints).values(
      rows.map((r) => ({
        competitorId: r.competitor_id,
        planName: r.plan_name,
        meterUnit: r.meter_unit,
        referenceQty: r.reference_qty,
        effectiveMonthlyCost: r.effective_monthly_cost,
        currency: r.currency,
        method: r.method,
        recordedAt: r.recorded_at,
      })),
    ),
  );
}

// The latest stored ladder — the diff baseline, read BEFORE the fresh batch is
// inserted, like getPreviousPricing / getPreviousEntitlements.
export async function getPreviousPriceTiers(
  competitorId: string,
): Promise<PriceTierRow[] | null> {
  const rows = await bestEffortRead<PriceTierRow>("getPreviousPriceTiers", () =>
    db
      .select({
        competitor_id: priceTiers.competitorId,
        plan_name: priceTiers.planName,
        unit: priceTiers.unit,
        from_qty: priceTiers.fromQty,
        to_qty: priceTiers.toQty,
        unit_price: priceTiers.unitPrice,
        flat_fee: priceTiers.flatFee,
        recorded_at: priceTiers.recordedAt,
      })
      .from(priceTiers)
      .where(
        and(
          eq(priceTiers.competitorId, competitorId),
          eq(
            priceTiers.recordedAt,
            sql`(select max(recorded_at) from price_tiers where competitor_id = ${competitorId})`,
          ),
        ),
      )
      .orderBy(priceTiers.planName, priceTiers.fromQty),
  );
  return rows && rows.length > 0 ? rows : null;
}

export interface LatestTrial {
  has_trial: boolean;
  days: number | null;
  requires_credit_card: boolean | null;
}

// Latest detected free-trial state for a competitor (from the most recent pricing
// scrape). Used to feed the battle card. Best-effort: null on miss/error or when
// the latest batch never recorded a trial assessment (legacy rows).
export async function getLatestTrial(competitorId: string): Promise<LatestTrial | null> {
  const rows = await bestEffortRead<{
    has_trial: number | null;
    trial_days: number | null;
    trial_requires_card: number | null;
  }>("getLatestTrial", () =>
    db
      .select({
        has_trial: pricingHistory.hasTrial,
        trial_days: pricingHistory.trialDays,
        trial_requires_card: pricingHistory.trialRequiresCard,
      })
      .from(pricingHistory)
      .where(eq(pricingHistory.competitorId, competitorId))
      .orderBy(desc(pricingHistory.recordedAt))
      .limit(1),
  );
  const r = rows?.[0];
  if (!r || r.has_trial == null) return null;
  return {
    has_trial: r.has_trial === 1,
    days: r.trial_days,
    requires_credit_card: r.trial_requires_card == null ? null : r.trial_requires_card === 1,
  };
}

export interface PricingTierRow {
  planName: string;
  price: number;
  currency: string;
  billingPeriod: string;
}

// Latest captured pricing tiers for a competitor: the most recent price per
// (plan, billing period) from pricing_history. Feeds the battle card real,
// current tiers to ground pricing comparisons instead of the model guessing.
// Best-effort: [] on miss/error or when pricing was never scraped.
export async function getLatestPricingTiers(competitorId: string): Promise<PricingTierRow[]> {
  const rows = await bestEffortRead<{
    plan_name: string | null;
    price: number | null;
    currency: string | null;
    billing_period: string | null;
  }>("getLatestPricingTiers", () =>
    db
      .select({
        plan_name: pricingHistory.planName,
        price: pricingHistory.price,
        currency: pricingHistory.currency,
        billing_period: pricingHistory.billingPeriod,
      })
      .from(pricingHistory)
      .where(eq(pricingHistory.competitorId, competitorId))
      .orderBy(desc(pricingHistory.recordedAt))
      .limit(60),
  );
  if (!rows) return [];
  // Rows are newest-first; keep the first (most recent) seen per plan+period.
  const seen = new Map<string, PricingTierRow>();
  for (const r of rows) {
    if (!r.plan_name || r.price == null) continue;
    const period = r.billing_period ?? "monthly";
    const key = `${r.plan_name}|${period}`;
    if (seen.has(key)) continue;
    seen.set(key, {
      planName: r.plan_name,
      price: r.price,
      currency: r.currency ?? "USD",
      billingPeriod: period,
    });
  }
  return [...seen.values()];
}

export interface ReviewScoreSummary {
  source: string;
  score: number | null;
  reviewCount: number | null;
  subScores: {
    easeOfUse: number | null;
    support: number | null;
    features: number | null;
    value: number | null;
  };
  complaintThemes: Array<{ theme: string; prevalence: string }>;
}

// Latest review-score row for a competitor (rating + per-criterion sub-scores +
// clustered complaint themes). Feeds the battle card the real, sourced review
// signal instead of the model inventing satisfaction claims. Best-effort: null on
// miss/error or when no review source is enabled.
export async function getLatestReviewScore(competitorId: string): Promise<ReviewScoreSummary | null> {
  const rows = await bestEffortRead<{
    source: string;
    score: number | null;
    review_count: number | null;
    sub_ease_of_use: number | null;
    sub_support: number | null;
    sub_features: number | null;
    sub_value: number | null;
    complaint_themes: unknown;
  }>("getLatestReviewScore", () =>
    db
      .select({
        source: reviewScores.source,
        score: reviewScores.score,
        review_count: reviewScores.reviewCount,
        sub_ease_of_use: reviewScores.subEaseOfUse,
        sub_support: reviewScores.subSupport,
        sub_features: reviewScores.subFeatures,
        sub_value: reviewScores.subValue,
        complaint_themes: reviewScores.complaintThemes,
      })
      .from(reviewScores)
      .where(eq(reviewScores.competitorId, competitorId))
      .orderBy(desc(reviewScores.recordedAt))
      .limit(1),
  );
  const r = rows?.[0];
  if (!r) return null;
  const themes = Array.isArray(r.complaint_themes)
    ? (r.complaint_themes as Array<{ theme: string; prevalence: string }>)
    : [];
  return {
    source: r.source,
    score: r.score,
    reviewCount: r.review_count,
    subScores: {
      easeOfUse: r.sub_ease_of_use,
      support: r.sub_support,
      features: r.sub_features,
      value: r.sub_value,
    },
    complaintThemes: themes,
  };
}

export interface ReviewThemeSeriesRow {
  source: string;
  /** Star/trust score (1–5), notNull on every review_scores row. */
  score: number;
  /** Total review count at capture time, notNull. */
  reviewCount: number;
  themes: Array<{ theme: string; prevalence: string }>;
  recordedAt: Date;
}

// review_scores complaint-theme series for a competitor over a lookback window,
// oldest-first — feeds the sliding-window inflection detector (detect-review-theme-
// shifts) and the battle-card objection injection. Best-effort ([] on error). Rows
// with no clustered themes carry an empty array (kept — they count as scrapes in the
// window denominator).
export async function getReviewScoreSeries(
  competitorId: string,
  sinceDays: number,
): Promise<ReviewThemeSeriesRow[]> {
  const since = new Date(Date.now() - sinceDays * 86_400_000);
  const rows = await bestEffortRead<{
    source: string;
    score: number;
    review_count: number;
    complaint_themes: unknown;
    recorded_at: Date;
  }>("getReviewScoreSeries", () =>
    db
      .select({
        source: reviewScores.source,
        score: reviewScores.score,
        review_count: reviewScores.reviewCount,
        complaint_themes: reviewScores.complaintThemes,
        recorded_at: reviewScores.recordedAt,
      })
      .from(reviewScores)
      .where(and(eq(reviewScores.competitorId, competitorId), gte(reviewScores.recordedAt, since)))
      .orderBy(reviewScores.recordedAt),
  );
  return (rows ?? []).map((r) => ({
    source: r.source,
    score: r.score,
    reviewCount: r.review_count,
    themes: Array.isArray(r.complaint_themes)
      ? (r.complaint_themes as Array<{ theme: string; prevalence: string }>)
      : [],
    recordedAt: r.recorded_at,
  }));
}

export interface JobCountRow {
  competitor_id: string;
  department: string;
  count: number;
  recorded_at: Date;
}

export async function insertJobCounts(rows: JobCountRow[]): Promise<void> {
  if (rows.length === 0) return;
  await bestEffort("job_counts insert", () =>
    db.insert(jobCounts).values(
      rows.map((r) => ({
        competitorId: r.competitor_id,
        department: r.department,
        count: r.count,
        recordedAt: r.recorded_at,
      })),
    ),
  );
}

export interface HiringMetricRow {
  competitor_id: string;
  department_bucket: string;
  open_count: number;
  /** ISO-week key "YYYY-MM-DD" (Monday, UTC) — the weekly idempotency bucket. */
  week_start: string;
  recorded_at: Date;
}

/**
 * Upsert weekly per-bucket hiring velocity. Idempotent by (competitor, bucket,
 * ISO week): a second scrape in the same week overwrites the row instead of
 * appending, so the series carries one authoritative open-count per week and a
 * re-run never doubles a data point.
 */
export async function upsertHiringMetrics(rows: HiringMetricRow[]): Promise<void> {
  if (rows.length === 0) return;
  await bestEffort("hiring_metrics upsert", () =>
    db
      .insert(hiringMetrics)
      .values(
        rows.map((r) => ({
          competitorId: r.competitor_id,
          departmentBucket: r.department_bucket,
          openCount: r.open_count,
          weekStart: r.week_start,
          recordedAt: r.recorded_at,
        })),
      )
      .onConflictDoUpdate({
        target: [
          hiringMetrics.competitorId,
          hiringMetrics.departmentBucket,
          hiringMetrics.weekStart,
        ],
        set: {
          openCount: sql`excluded.open_count`,
          recordedAt: sql`excluded.recorded_at`,
        },
      }),
  );
}

export interface HiringMetricSeriesRow {
  department_bucket: string;
  open_count: number;
  week_start: string;
}

/**
 * Read a competitor's weekly hiring velocity for the last `weeks` ISO weeks,
 * ordered by week ascending — the input the inflection detector consumes.
 */
export async function getHiringMetricsSeries(
  competitorId: string,
  weeks: number,
): Promise<HiringMetricSeriesRow[]> {
  const since = new Date(Date.now() - weeks * 7 * 86_400_000);
  const rows = await bestEffortRead<HiringMetricSeriesRow>("getHiringMetricsSeries", () =>
    db
      .select({
        department_bucket: hiringMetrics.departmentBucket,
        open_count: hiringMetrics.openCount,
        week_start: hiringMetrics.weekStart,
      })
      .from(hiringMetrics)
      .where(and(eq(hiringMetrics.competitorId, competitorId), gte(hiringMetrics.recordedAt, since)))
      .orderBy(hiringMetrics.weekStart),
  );
  return rows ?? [];
}

export interface ReviewScoreRow {
  competitor_id: string;
  source: string;
  score: number;
  review_count: number;
  sentiment_score: number;
  // patch-32 — per-criterion sub-scores out of 5, null when not shown on the page.
  sub_ease_of_use?: number | null;
  sub_support?: number | null;
  sub_features?: number | null;
  sub_value?: number | null;
  // gap-B — recurring complaint themes (AI-judge clusters), null/empty when none.
  complaint_themes?: Array<{ theme: string; prevalence: "low" | "medium" | "high" }> | null;
  recorded_at: Date;
}

export async function insertReviewScore(row: ReviewScoreRow): Promise<void> {
  await bestEffort("review_scores insert", () =>
    db.insert(reviewScores).values({
      competitorId: row.competitor_id,
      source: row.source,
      score: row.score,
      reviewCount: row.review_count,
      sentimentScore: row.sentiment_score,
      subEaseOfUse: row.sub_ease_of_use ?? null,
      subSupport: row.sub_support ?? null,
      subFeatures: row.sub_features ?? null,
      subValue: row.sub_value ?? null,
      complaintThemes: row.complaint_themes ?? null,
      recordedAt: row.recorded_at,
    }),
  );
}

export interface AiVisibilityResultRow {
  org_id: string;
  prompt_id: string;
  competitor_id: string;
  product_id?: string | null;
  engine: string;
  mentioned: boolean;
  // The prompt text names this subject → contaminated pair, excluded from organic SoV.
  prompt_named?: boolean;
  rank?: number | null;
  cited?: boolean | null;
  sentiment_score?: number | null;
  answer_excerpt?: string | null;
  run_id: string;
  recorded_at: Date;
}

// AI Visibility / "Share of Model" results (docs/ai-visibility.md). One row per
// (prompt × engine × subject) sweep. Booleans map to the 0/1 int convention of this
// table; cited is nullable (n/a when not mentioned). Best-effort like the rest.
export async function insertAiVisibilityResults(rows: AiVisibilityResultRow[]): Promise<void> {
  if (rows.length === 0) return;
  await bestEffort("ai_visibility_results insert", () =>
    db.insert(aiVisibilityResults).values(
      rows.map((r) => ({
        orgId: r.org_id,
        promptId: r.prompt_id,
        competitorId: r.competitor_id,
        productId: r.product_id ?? null,
        engine: r.engine,
        mentioned: r.mentioned ? 1 : 0,
        promptNamed: r.prompt_named ? 1 : 0,
        rank: r.rank ?? null,
        cited: r.cited == null ? null : r.cited ? 1 : 0,
        sentimentScore: r.sentiment_score ?? null,
        answerExcerpt: r.answer_excerpt ?? null,
        runId: r.run_id,
        recordedAt: r.recorded_at,
      })),
    ),
  );
}

export interface AiVisibilityRunRow {
  competitorId: string;
  engine: string;
  promptId: string;
  mentioned: boolean;
  promptNamed: boolean;
  rank: number | null;
}

// The previous run's rows for an org (the most recent run_id that isn't the current
// one), for the phase-3 diff. patch-28 (phase B): scoped to one product when given, so
// the baseline for a product's deltas is its own prior run, not another SKU's. Best-effort:
// null on error → caller treats it as "no baseline" and emits no signals.
export async function getPreviousAiVisibilityRun(
  orgId: string,
  currentRunId: string,
  productId?: string | null,
): Promise<AiVisibilityRunRow[] | null> {
  return bestEffortRead("getPreviousAiVisibilityRun", async () => {
    const latest = await db
      .select({ runId: aiVisibilityResults.runId })
      .from(aiVisibilityResults)
      .where(
        and(
          eq(aiVisibilityResults.orgId, orgId),
          ne(aiVisibilityResults.runId, currentRunId),
          productId ? eq(aiVisibilityResults.productId, productId) : undefined,
        ),
      )
      .orderBy(desc(aiVisibilityResults.recordedAt))
      .limit(1);
    const prevRunId = latest[0]?.runId;
    if (!prevRunId) return [];
    const rows = await db
      .select({
        competitorId: aiVisibilityResults.competitorId,
        engine: aiVisibilityResults.engine,
        promptId: aiVisibilityResults.promptId,
        mentioned: aiVisibilityResults.mentioned,
        promptNamed: aiVisibilityResults.promptNamed,
        rank: aiVisibilityResults.rank,
      })
      .from(aiVisibilityResults)
      .where(
        and(
          eq(aiVisibilityResults.runId, prevRunId),
          productId ? eq(aiVisibilityResults.productId, productId) : undefined,
        ),
      );
    return rows.map((r) => ({
      competitorId: r.competitorId,
      engine: r.engine,
      promptId: r.promptId,
      mentioned: r.mentioned !== 0,
      promptNamed: r.promptNamed !== 0,
      rank: r.rank,
    }));
  });
}

// Previous-state reads for the per-source summary. Called BEFORE inserting the
// fresh batch, so "latest" is the prior scrape. Best-effort: null on miss.
export async function getPreviousPricing(
  competitorId: string,
): Promise<PricingHistoryRow[] | null> {
  const rows = await bestEffortRead<PricingHistoryRow>("getPreviousPricing", () =>
    db
      .select({
        competitor_id: pricingHistory.competitorId,
        plan_name: pricingHistory.planName,
        price: pricingHistory.price,
        currency: pricingHistory.currency,
        billing_period: pricingHistory.billingPeriod,
        // Dimensional + page-level facts: the deterministic batch differ
        // (diffPricingBatches, Pricing Intelligence P1) compares them, so the
        // baseline read must carry them like the fresh batch does.
        unit: pricingHistory.unit,
        included_quantity: pricingHistory.includedQuantity,
        has_trial: pricingHistory.hasTrial,
        trial_days: pricingHistory.trialDays,
        trial_requires_card: pricingHistory.trialRequiresCard,
        has_free_plan: pricingHistory.hasFreePlan,
        rate_structure: pricingHistory.rateStructure,
        minimum_amount: pricingHistory.minimumAmount,
        percentage_rate: pricingHistory.percentageRate,
        status: pricingHistory.status,
        promotional: pricingHistory.promotional,
        observed_region: pricingHistory.observedRegion,
        recorded_at: pricingHistory.recordedAt,
      })
      .from(pricingHistory)
      .where(
        and(
          eq(pricingHistory.competitorId, competitorId),
          eq(
            pricingHistory.recordedAt,
            sql`(select max(recorded_at) from pricing_history where competitor_id = ${competitorId})`,
          ),
        ),
      )
      .orderBy(pricingHistory.price),
  );
  return rows && rows.length > 0 ? rows : null;
}

export async function getPreviousReviewScore(
  competitorId: string,
  source: string,
): Promise<number | null> {
  const rows = await bestEffortRead<{ score: number }>("getPreviousReviewScore", () =>
    db
      .select({ score: reviewScores.score })
      .from(reviewScores)
      .where(and(eq(reviewScores.competitorId, competitorId), eq(reviewScores.source, source)))
      .orderBy(desc(reviewScores.recordedAt))
      .limit(1),
  );
  return rows && rows.length > 0 ? (rows[0]?.score ?? null) : null;
}

// --- Numeric claims (patch-17). Append-only tracking of quantified homepage
//     claims ("15,000 teams", "99.9% uptime"). Best-effort. ---

export interface NumericClaimRow {
  competitor_id: string;
  monitor_id: string;
  pattern: string;
  unit: string;
  context: string;
  value: number;
  raw_text: string;
  observed_at: Date;
}

export async function insertNumericClaims(rows: NumericClaimRow[]): Promise<void> {
  if (rows.length === 0) return;
  await bestEffort("numeric_claims insert", () =>
    db.insert(numericClaims).values(
      rows.map((r) => ({
        competitorId: r.competitor_id,
        monitorId: r.monitor_id,
        pattern: r.pattern,
        unit: r.unit,
        context: r.context,
        value: r.value,
        rawText: r.raw_text,
        observedAt: r.observed_at,
      })),
    ),
  );
}

// --- Tech stack history (patch-18). Append-only appearance/disappearance
//     timeline; Postgres tech_stack_entries holds the present state. Best-effort. ---

export interface TechStackHistoryRow {
  competitor_id: string;
  tech_id: string;
  event: "appeared" | "disappeared";
  importance: string;
  recorded_at: Date;
}

export async function insertTechStackHistory(rows: TechStackHistoryRow[]): Promise<void> {
  if (rows.length === 0) return;
  await bestEffort("tech_stack_history insert", () =>
    db.insert(techStackHistory).values(
      rows.map((r) => ({
        competitorId: r.competitor_id,
        techId: r.tech_id,
        event: r.event,
        importance: r.importance,
        recordedAt: r.recorded_at,
      })),
    ),
  );
}

export interface LastNumericClaim {
  pattern: string;
  unit: string;
  context: string;
  value: number;
}

// Latest value per (pattern, unit, context) for a competitor. Called BEFORE
// inserting the current scrape's claims, so it reflects the prior observation.
export async function getLastNumericClaims(
  competitorId: string,
): Promise<LastNumericClaim[] | null> {
  return bestEffortRead<LastNumericClaim>("getLastNumericClaims", () =>
    db
      .selectDistinctOn([numericClaims.pattern, numericClaims.unit, numericClaims.context], {
        pattern: numericClaims.pattern,
        unit: numericClaims.unit,
        context: numericClaims.context,
        value: numericClaims.value,
      })
      .from(numericClaims)
      .where(eq(numericClaims.competitorId, competitorId))
      .orderBy(
        numericClaims.pattern,
        numericClaims.unit,
        numericClaims.context,
        desc(numericClaims.observedAt),
      ),
  );
}

// --- Sectoral analysis reads (patch-13). Best-effort: null on error, in which
//     case the pricing/positioning detectors simply produce nothing. ---

export interface PricingHistoryPointRow {
  competitor_id: string;
  plan_name: string;
  price: number;
  recorded_at: string;
}

export async function getPricingHistorySince(
  competitorIds: string[],
  days: number,
): Promise<PricingHistoryPointRow[] | null> {
  if (competitorIds.length === 0) return [];
  return bestEffortRead<PricingHistoryPointRow>("getPricingHistorySince", () =>
    db
      .select({
        competitor_id: pricingHistory.competitorId,
        plan_name: pricingHistory.planName,
        // The WHERE clause filters price > 0, so this is always non-null here —
        // assert it so the sectoral chain stays numeric (the column is nullable).
        price: sql<number>`${pricingHistory.price}`,
        recorded_at: sql<string>`${pricingHistory.recordedAt}::text`,
      })
      .from(pricingHistory)
      .where(
        and(
          inArray(pricingHistory.competitorId, competitorIds),
          gt(pricingHistory.price, 0),
          // Comparable periods only: a usage rate ($0.10 / API call) must never be
          // averaged into the sector-wide price-trend median alongside monthly
          // subscription prices. Mirrors shared isComparablePricePeriod.
          inArray(pricingHistory.billingPeriod, ["monthly", "yearly", "one_time"]),
          gte(pricingHistory.recordedAt, sql`now() - make_interval(days => ${days})`),
        ),
      )
      .orderBy(pricingHistory.recordedAt),
  );
}

export interface PricingStatusPointRow {
  competitor_id: string;
  status: string;
  recorded_at: string;
}

export async function getPricingStatusHistorySince(
  competitorIds: string[],
  days: number,
): Promise<PricingStatusPointRow[] | null> {
  if (competitorIds.length === 0) return [];
  return bestEffortRead<PricingStatusPointRow>("getPricingStatusHistorySince", () =>
    db
      .select({
        competitor_id: pricingHistory.competitorId,
        status: pricingHistory.status,
        recorded_at: sql<string>`${pricingHistory.recordedAt}::text`,
      })
      .from(pricingHistory)
      .where(
        and(
          inArray(pricingHistory.competitorId, competitorIds),
          sql`${pricingHistory.status} != ''`,
          gte(pricingHistory.recordedAt, sql`now() - make_interval(days => ${days})`),
        ),
      )
      .orderBy(pricingHistory.recordedAt),
  );
}
