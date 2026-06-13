import { logger } from "@trigger.dev/sdk/v3";
import { getActiveProvider, consumeUsage } from "@outrival/ai";
import {
  db,
  pricingHistory,
  jobCounts,
  reviewScores,
  signalFeed,
  scrapeRuns,
  aiRuns,
  extractionRuns,
  numericClaims,
  techStackHistory,
  platformDetectionRuns,
} from "@outrival/db";
import { and, desc, eq, gt, gte, inArray, sql } from "drizzle-orm";

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
  status: "success" | "no_change" | "failed";
  level: number; // patch-20 cascade level: 0/1 free, 2/3/4 paid
  attempts: number;
  failure_reason: string;
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

// The job logs the AI run, never the @outrival/ai task (kept pure, no DB). The
// task returns null on a parse miss → "parse_failed"; a thrown call → "error".
export async function logAiRun(
  task: string,
  provider: string,
  model: string,
  status: AiRunStatus,
): Promise<void> {
  // Prefer the real pool provider the call ran on (cerebras|groq|hyperbolic),
  // captured by complete() in the same async context (patch-22). Falls back to the
  // static provider from AI_CONFIG when the pool didn't run (e.g. Claude fallback).
  const actual = getActiveProvider() ?? provider;
  // Read-and-clear the tokens accumulated by complete() since the last log point,
  // so this row carries the full cost of the task (incl. any self-check pass).
  const usage = consumeUsage();
  await bestEffort("ai_runs insert", () =>
    db.insert(aiRuns).values({
      task,
      provider: actual,
      model,
      status,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
      recordedAt: new Date(),
    }),
  );
}

// Wrap an @outrival/ai task call so its outcome lands in ai_runs (patch-02):
// a value → success, null → parse_failed, a throw (e.g. a 429 after the SDK's own
// retries) → error, rethrown so Trigger.dev still retries the job.
export async function loggedAi<T>(
  task: string,
  config: { provider: string; model: string },
  fn: () => Promise<T>,
): Promise<T> {
  try {
    const res = await fn();
    await logAiRun(task, config.provider, config.model, res == null ? "parse_failed" : "success");
    return res;
  } catch (err) {
    await logAiRun(task, config.provider, config.model, "error");
    throw err;
  }
}

// --- Ops health reads (patch-02, ops-health-check job). Best-effort: null on
//     error → the health check simply skips that threshold. ---

export interface ScrapeHealthWindow {
  total: number;
  failed: number;
  proxy: number; // paid scrapes (level >= 2: datacenter/residential/camoufox)
  residential: number; // level >= 3 (residential + camoufox) — the expensive tier
}

export async function getScrapeHealth(hours: number): Promise<ScrapeHealthWindow | null> {
  const rows = await bestEffortRead("getScrapeHealth", () =>
    db
      .select({
        total: sql<string>`count(*)`,
        failed: sql<string>`count(*) filter (where ${scrapeRuns.status} = 'failed')`,
        proxy: sql<string>`count(*) filter (where ${scrapeRuns.level} >= 2)`,
        residential: sql<string>`count(*) filter (where ${scrapeRuns.level} >= 3)`,
      })
      .from(scrapeRuns)
      .where(gte(scrapeRuns.recordedAt, sql`now() - make_interval(hours => ${hours})`)),
  );
  if (!rows || !rows[0]) return null;
  return {
    total: Number(rows[0].total),
    failed: Number(rows[0].failed),
    proxy: Number(rows[0].proxy),
    residential: Number(rows[0].residential),
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

export interface PricingHistoryRow {
  competitor_id: string;
  plan_name: string;
  price: number;
  currency: string;
  billing_period: string;
  // patch-11 taxonomy columns.
  status: string;
  promotional: number;
  observed_region: string;
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
        status: r.status,
        promotional: r.promotional,
        observedRegion: r.observed_region,
        recordedAt: r.recorded_at,
      })),
    ),
  );
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
        price: pricingHistory.price,
        recorded_at: sql<string>`${pricingHistory.recordedAt}::text`,
      })
      .from(pricingHistory)
      .where(
        and(
          inArray(pricingHistory.competitorId, competitorIds),
          gt(pricingHistory.price, 0),
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
