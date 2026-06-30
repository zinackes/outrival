import {
  pgTable,
  text,
  integer,
  doublePrecision,
  timestamp,
  index,
  jsonb,
} from "drizzle-orm/pg-core";
import type { InferSelectModel } from "drizzle-orm";

// Time-series / analytics tables. These were ClickHouse MergeTree tables; they
// now live in Postgres (single Neon database). Append-only logs, written
// best-effort by the workers and read back by the API/admin dashboards. No FK
// to competitors: keeping them schema-light preserves the best-effort "a logging
// failure never breaks a scrape/AI job" contract and lets ai_runs (which has no
// competitor) share the same shape. Column/table names stay snake_case to match
// the access layer. Indexes mirror the old ClickHouse ORDER BY keys.

const uuid = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());

// Pricing tiers captured per scrape (pipeline: extract-pricing). The "current"
// set = the most recent recorded_at batch for a competitor.
export const pricingHistory = pgTable(
  "pricing_history",
  {
    id: uuid(),
    competitorId: text("competitor_id").notNull(),
    planName: text("plan_name").notNull(),
    // Nullable: quote-based tiers ("Enterprise", "Contact sales", "Custom") carry
    // no public number. They're still real plans worth tracking, so we keep the
    // row (price = null) instead of dropping it — numeric readers filter null.
    price: doublePrecision("price"),
    currency: text("currency").notNull(),
    billingPeriod: text("billing_period").notNull(),
    status: text("status").notNull().default("unknown"),
    promotional: integer("promotional").notNull().default(0),
    observedRegion: text("observed_region").notNull().default("FR"),
    // patch-33 — free-trial facts, detected AI-free from the pricing page text and
    // stamped page-level onto every plan row of a scrape (like status/observedRegion).
    // null = not assessed (legacy rows). hasTrial/trialRequiresCard are 0/1 ints
    // (mirrors `promotional`); trialDays null = trial with no stated duration.
    hasTrial: integer("has_trial"),
    trialDays: integer("trial_days"),
    trialRequiresCard: integer("trial_requires_card"),
    recordedAt: timestamp("recorded_at").notNull().defaultNow(),
  },
  (t) => [index("pricing_history_competitor_recorded_idx").on(t.competitorId, t.recordedAt)],
);

export const jobCounts = pgTable(
  "job_counts",
  {
    id: uuid(),
    competitorId: text("competitor_id").notNull(),
    department: text("department").notNull(),
    count: integer("count").notNull(),
    recordedAt: timestamp("recorded_at").notNull().defaultNow(),
  },
  (t) => [index("job_counts_competitor_recorded_idx").on(t.competitorId, t.recordedAt)],
);

export const reviewScores = pgTable(
  "review_scores",
  {
    id: uuid(),
    competitorId: text("competitor_id").notNull(),
    source: text("source").notNull(),
    score: doublePrecision("score").notNull(),
    reviewCount: integer("review_count").notNull(),
    sentimentScore: doublePrecision("sentiment_score").notNull(),
    // patch-32: per-criterion sub-scores out of 5 (null when the page shows only
    // an overall rating).
    subEaseOfUse: doublePrecision("sub_ease_of_use"),
    subSupport: doublePrecision("sub_support"),
    subFeatures: doublePrecision("sub_features"),
    subValue: doublePrecision("sub_value"),
    // patch-32 / gap-B: recurring complaint themes clustered by the AI judge (a
    // repeated grievance = a competitive opening). Null when no complaints.
    complaintThemes: jsonb("complaint_themes").$type<
      Array<{ theme: string; prevalence: "low" | "medium" | "high" }>
    >(),
    recordedAt: timestamp("recorded_at").notNull().defaultNow(),
  },
  (t) => [index("review_scores_competitor_recorded_idx").on(t.competitorId, t.recordedAt)],
);

// AI Visibility / "Share of Model" results (see docs/ai-visibility.md). One row per
// (prompt × engine × mentioned subject) captured on a run: did this competitor (self
// or external) appear in the engine's answer, at what rank, cited or not. Append-only,
// best-effort, no FK — like every table here. Share-of-voice is derived at read time
// (mentions / prompts, per engine). Read primarily per-org (the visibility page), so
// it carries an (org, recorded) index in addition to the per-competitor one.
export const aiVisibilityResults = pgTable(
  "ai_visibility_results",
  {
    id: uuid(),
    orgId: text("org_id").notNull(),
    promptId: text("prompt_id").notNull(),
    // The mentioned subject — a competitor row id (self or external).
    competitorId: text("competitor_id").notNull(),
    // chatgpt | perplexity | claude | gemini | google_aio (text, schema-light).
    engine: text("engine").notNull(),
    // 0/1 (mirrors pricing_history.promotional/has_trial int-bool convention).
    mentioned: integer("mentioned").notNull().default(0),
    // Order of first mention in the answer (1 = first). Null when not mentioned.
    rank: integer("rank"),
    // 1 when the subject appeared as a linked/cited source (not just text). Null = n/a.
    cited: integer("cited"),
    sentimentScore: doublePrecision("sentiment_score"),
    // Truncated answer text kept as evidence ("show the work"). Null to save space.
    answerExcerpt: text("answer_excerpt"),
    // Groups all rows written by one engine×prompt sweep, so a run is queryable as a unit.
    runId: text("run_id").notNull(),
    recordedAt: timestamp("recorded_at").notNull().defaultNow(),
  },
  (t) => [
    index("ai_visibility_results_org_recorded_idx").on(t.orgId, t.recordedAt),
    index("ai_visibility_results_competitor_recorded_idx").on(t.competitorId, t.recordedAt),
  ],
);

export type AiVisibilityResult = InferSelectModel<typeof aiVisibilityResults>;

export const signalFeed = pgTable(
  "signal_feed",
  {
    id: uuid(),
    orgId: text("org_id").notNull(),
    competitorId: text("competitor_id").notNull(),
    category: text("category").notNull(),
    severity: text("severity").notNull(),
    recordedAt: timestamp("recorded_at").notNull().defaultNow(),
  },
  (t) => [
    index("signal_feed_org_recorded_idx").on(t.orgId, t.recordedAt),
    index("signal_feed_recorded_idx").on(t.recordedAt),
  ],
);

// Ops observability (patch-02, extended patch-20). Append-only run logs powering
// the /admin health dashboard: scraping reliability, cascade-level distribution
// (proxy cost), failure reasons.
export const scrapeRuns = pgTable(
  "scrape_runs",
  {
    id: uuid(),
    monitorId: text("monitor_id").notNull(),
    competitorId: text("competitor_id").notNull(),
    sourceType: text("source_type").notNull(),
    status: text("status").notNull(), // success | no_change | failed
    level: integer("level").notNull().default(0), // patch-20 cascade level: 0/1 free, 2/3/4 paid
    attempts: integer("attempts").notNull().default(1),
    failureReason: text("failure_reason").notNull().default(""),
    durationMs: integer("duration_ms").notNull(),
    recordedAt: timestamp("recorded_at").notNull().defaultNow(),
  },
  (t) => [
    index("scrape_runs_recorded_idx").on(t.recordedAt),
    index("scrape_runs_monitor_recorded_idx").on(t.monitorId, t.recordedAt),
  ],
);

export const aiRuns = pgTable(
  "ai_runs",
  {
    id: uuid(),
    task: text("task").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    status: text("status").notNull(), // success | parse_failed | error
    confidence: text("confidence").notNull().default(""), // low | medium | high | '' (patch-24)
    selfCheckPassed: integer("self_check_passed").notNull().default(-1), // -1 not run | 0 failed | 1 passed
    groundingScore: doublePrecision("grounding_score").notNull().default(-1), // ratio of valid citations, -1 = ungrounded
    // Token usage per run for cost attribution (2026-06). 0 = uncaptured (degraded
    // pool / provider returned no usage). Summed across a task's internal calls
    // (e.g. classify + self-check) via consumeUsage(); see provider-context.ts.
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    recordedAt: timestamp("recorded_at").notNull().defaultNow(),
  },
  (t) => [index("ai_runs_recorded_idx").on(t.recordedAt)],
);

// Staged extraction resolution per scrape (patch-30): which tier resolved the
// extraction and whether an AI call was spent. The /admin dashboard reads the %
// per resolution over a window — the direct arbiter of extraction AI cost.
export const extractionRuns = pgTable(
  "extraction_runs",
  {
    id: uuid(),
    competitorId: text("competitor_id").notNull(),
    sourceType: text("source_type").notNull(),
    domain: text("domain").notNull(),
    resolution: text("resolution").notNull(), // structured | cache | heal | ai_fallback
    extractorVersion: integer("extractor_version").notNull().default(0),
    aiUsed: integer("ai_used").notNull().default(0), // 0 for structured/cache, 1 for heal/ai_fallback
    recordedAt: timestamp("recorded_at").notNull().defaultNow(),
  },
  (t) => [index("extraction_runs_recorded_idx").on(t.recordedAt)],
);

// Quantified homepage claims tracked over time (patch-17): "15,000 teams",
// "99.9% uptime". The worker reads the last value per (competitor, pattern, unit,
// context) to detect a significant variation.
export const numericClaims = pgTable(
  "numeric_claims",
  {
    id: uuid(),
    competitorId: text("competitor_id").notNull(),
    monitorId: text("monitor_id").notNull(),
    pattern: text("pattern").notNull(), // user_count | uptime | scale | satisfaction | savings | other_metric
    unit: text("unit").notNull(),
    context: text("context").notNull(),
    value: doublePrecision("value").notNull(),
    rawText: text("raw_text").notNull(),
    observedAt: timestamp("observed_at").notNull().defaultNow(),
  },
  (t) => [index("numeric_claims_competitor_observed_idx").on(t.competitorId, t.observedAt)],
);

// Tech-stack appearance/disappearance timeline (patch-18). Postgres
// tech_stack_entries holds the present state, this holds the history.
export const techStackHistory = pgTable(
  "tech_stack_history",
  {
    id: uuid(),
    competitorId: text("competitor_id").notNull(),
    techId: text("tech_id").notNull(),
    event: text("event").notNull(), // appeared | disappeared
    importance: text("importance").notNull(), // high | medium | low
    recordedAt: timestamp("recorded_at").notNull().defaultNow(),
  },
  (t) => [index("tech_stack_history_competitor_recorded_idx").on(t.competitorId, t.recordedAt)],
);

// Platform detection outcomes per run (patch-31). The /admin panel reads the %
// resolved at step A (static) vs step B (browser) and what each run routed.
export const platformDetectionRuns = pgTable(
  "platform_detection_runs",
  {
    id: uuid(),
    competitorId: text("competitor_id").notNull(),
    domain: text("domain").notNull(),
    stage: text("stage").notNull(), // a_static | b_browser
    framework: text("framework").notNull().default(""),
    cms: text("cms").notNull().default(""),
    ats: text("ats").notNull().default(""),
    pricingWidget: text("pricing_widget").notNull().default(""),
    statusPage: text("status_page").notNull().default(""),
    changelog: text("changelog").notNull().default(""),
    techsFound: integer("techs_found").notNull().default(0),
    durationMs: integer("duration_ms").notNull().default(0),
    recordedAt: timestamp("recorded_at").notNull().defaultNow(),
  },
  (t) => [index("platform_detection_runs_recorded_idx").on(t.recordedAt)],
);

export type PricingHistory = InferSelectModel<typeof pricingHistory>;
export type JobCount = InferSelectModel<typeof jobCounts>;
export type ReviewScore = InferSelectModel<typeof reviewScores>;
export type SignalFeed = InferSelectModel<typeof signalFeed>;
export type ScrapeRun = InferSelectModel<typeof scrapeRuns>;
export type AiRun = InferSelectModel<typeof aiRuns>;
export type ExtractionRun = InferSelectModel<typeof extractionRuns>;
export type NumericClaim = InferSelectModel<typeof numericClaims>;
export type TechStackHistory = InferSelectModel<typeof techStackHistory>;
export type PlatformDetectionRun = InferSelectModel<typeof platformDetectionRuns>;
