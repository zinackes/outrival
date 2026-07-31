import {
  pgTable,
  text,
  integer,
  doublePrecision,
  timestamp,
  index,
  uniqueIndex,
  jsonb,
  boolean,
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
    // monthly | yearly | one_time | custom | usage. "usage" = the price is a
    // per-`unit` rate (metered or outcome-based), not a per-time subscription.
    billingPeriod: text("billing_period").notNull(),
    // Dimensional pricing (2026 models). unit = what a usage/per-seat price applies
    // to ("API call", "resolved conversation", "credit", "seat"); null = flat.
    // includedQuantity = units bundled into the plan (credit-pack size, included
    // calls); null = N/A. See docs/pricing-coverage-2026.md.
    unit: text("unit"),
    includedQuantity: doublePrecision("included_quantity"),
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
    // Permanent free plan / freemium tier advertised on the page (AI-free regex,
    // detect-free-plan). Distinct from has_trial: a free *plan* is a $0 tier, a free
    // *trial* is time-limited paid access. Stamped page-level like the trial facts.
    // Catches a free tier the priced-card extractor misses (e.g. a "Free" comparison
    // column with no price token). 0/1 int; null = pre-detection (legacy rows).
    hasFreePlan: integer("has_free_plan"),
    // Pricing Intelligence P3 — HOW the rate is structured, in the vocabulary the
    // billing engines share (Lago/Metronome). All three are null on a plain
    // subscription row, which is every legacy row: the columns describe a metered
    // plan and their absence is not a fact about the plan.
    //   standard   qty x unit_price
    //   graduated  each tier's own rate applies to the units inside it (a sum)
    //   volume     the reached tier's rate applies to ALL units
    //   package    priced in blocks ("$X per 1000")
    //   percentage a share of transacted value ("2.9% + $0.30")
    rateStructure: text("rate_structure"),
    // Monthly floor ("$50/mo minimum"): what the plan bills before a single unit
    // is consumed. Distinct from a base fee — it is not additive, it is a max().
    minimumAmount: doublePrecision("minimum_amount"),
    // The "2.9%" finally numeric. `price` then carries the FIXED part ($0.30), so
    // a percentage plan is one row with both halves. Excluded from cost modelling
    // (its meter is money, not a countable unit) — surfaced as a badge.
    percentageRate: doublePrecision("percentage_rate"),
    recordedAt: timestamp("recorded_at").notNull().defaultNow(),
  },
  (t) => [index("pricing_history_competitor_recorded_idx").on(t.competitorId, t.recordedAt)],
);

// Published volume breaks of a metered plan (Pricing Intelligence P3). One row =
// one band of the ladder ("0–10k @ $0.10"), captured from the SAME pricing page
// scrape as pricing_history and stamped with the SAME batch timestamp, so the two
// tables describe one capture. Written ONLY when the page publishes the ladder:
// an invalid or overlapping set is dropped whole rather than stored partially,
// because a half-read ladder computes a confidently wrong cost.
export const priceTiers = pgTable(
  "price_tiers",
  {
    id: uuid(),
    competitorId: text("competitor_id").notNull(),
    planName: text("plan_name").notNull(),
    // Normalised meter unit (unit-alias): "request", "gb", "seat"… An unnormalised
    // unit keeps the page's wording — the cost writer is what refuses to compare
    // across units it can't normalise.
    unit: text("unit"),
    fromQty: doublePrecision("from_qty").notNull(),
    // null = the last, unbounded band (∞).
    toQty: doublePrecision("to_qty"),
    unitPrice: doublePrecision("unit_price"),
    // Flat fee charged for entering the band (stair-step ladders).
    flatFee: doublePrecision("flat_fee"),
    recordedAt: timestamp("recorded_at").notNull().defaultNow(),
  },
  (t) => [
    index("price_tiers_competitor_recorded_idx").on(t.competitorId, t.recordedAt),
    index("price_tiers_competitor_plan_idx").on(t.competitorId, t.planName),
  ],
);

// What a metered plan actually COSTS at a reference volume (Pricing Intelligence
// P3) — the row that lets a usage-based competitor enter a price comparison at
// all. Computed deterministically from the tiers (zero AI); `method` records where
// the number came from, because a probed or published figure carries different
// authority than one we derived.
export const pricePoints = pgTable(
  "price_points",
  {
    id: uuid(),
    competitorId: text("competitor_id").notNull(),
    planName: text("plan_name").notNull(),
    // Normalised unit only. A meter we cannot normalise writes NO point: an
    // unknown unit compared against a known one is arithmetic on two things that
    // are not the same thing.
    meterUnit: text("meter_unit").notNull(),
    referenceQty: doublePrecision("reference_qty").notNull(),
    effectiveMonthlyCost: doublePrecision("effective_monthly_cost").notNull(),
    currency: text("currency").notNull(),
    // computed_from_tiers | calculator_probe (P4) | published
    method: text("method").notNull(),
    recordedAt: timestamp("recorded_at").notNull().defaultNow(),
  },
  (t) => [
    index("price_points_competitor_recorded_idx").on(t.competitorId, t.recordedAt),
    index("price_points_competitor_unit_idx").on(t.competitorId, t.meterUnit),
  ],
);

// The features × plans matrix (Pricing Intelligence P2 — Stigg entitlement model).
// One row = (plan, feature, value) captured from the SAME pricing page scrape as
// pricing_history; recorded_at carries the SAME batch timestamp so the two tables
// describe one capture. feature_label is the page's VERBATIM wording (the proof);
// feature_slug is the catalog-canonical slug when the label resolved
// (is_canonical=1), else a slugified fallback. kind: boolean (on/off) | config
// (fixed value, e.g. 30-day retention) | metered (limit, optionally with a
// reset_period). Append-only batches, latest batch = the current matrix.
export const planEntitlements = pgTable(
  "plan_entitlements",
  {
    id: uuid(),
    competitorId: text("competitor_id").notNull(),
    planName: text("plan_name").notNull(),
    featureSlug: text("feature_slug").notNull(),
    featureLabel: text("feature_label").notNull(),
    kind: text("kind").notNull(), // boolean | config | metered
    valueNum: doublePrecision("value_num"),
    valueText: text("value_text"),
    unit: text("unit"),
    resetPeriod: text("reset_period"),
    isCanonical: integer("is_canonical").notNull().default(0), // 1 = catalog slug
    recordedAt: timestamp("recorded_at").notNull().defaultNow(),
  },
  (t) => [
    index("plan_entitlements_competitor_recorded_idx").on(t.competitorId, t.recordedAt),
    index("plan_entitlements_competitor_feature_idx").on(t.competitorId, t.featureSlug),
  ],
);
export type PlanEntitlement = InferSelectModel<typeof planEntitlements>;

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

// Hiring velocity per canonical department bucket (hiring-velocity feature). Unlike
// job_counts (raw ATS department label, appended once per scrape), this is keyed by
// (competitor, bucket, ISO week) with an UPSERT: every scrape in the same week
// overwrites the row so the series carries one authoritative open-count per week —
// the input the inflection detector needs, and the source of the per-bucket
// sparklines. Written only on authoritative ATS runs.
export const hiringMetrics = pgTable(
  "hiring_metrics",
  {
    id: uuid(),
    competitorId: text("competitor_id").notNull(),
    // One of DEPARTMENT_BUCKETS (@outrival/scrapers/jobs-hiring).
    departmentBucket: text("department_bucket").notNull(),
    openCount: integer("open_count").notNull(),
    // ISO-week key "YYYY-MM-DD" (Monday, UTC) — the weekly idempotency bucket.
    weekStart: text("week_start").notNull(),
    recordedAt: timestamp("recorded_at").notNull().defaultNow(),
  },
  (t) => [
    // Idempotency: one row per (competitor, bucket, ISO week) — the upsert target.
    uniqueIndex("hiring_metrics_competitor_bucket_week_uk").on(
      t.competitorId,
      t.departmentBucket,
      t.weekStart,
    ),
    index("hiring_metrics_competitor_recorded_idx").on(t.competitorId, t.recordedAt),
  ],
);
export type HiringMetric = InferSelectModel<typeof hiringMetrics>;

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
    // patch-28 multi-SKU (phase B) — the product (SKU) this row belongs to. Per-product
    // runs; null on pre-B historical rows. No FK (analytics convention) — reads that
    // filter by product_id simply skip the legacy null rows.
    productId: text("product_id"),
    // chatgpt | perplexity | claude | gemini | google_aio (text, schema-light).
    engine: text("engine").notNull(),
    // 0/1 (mirrors pricing_history.promotional/has_trial int-bool convention).
    mentioned: integer("mentioned").notNull().default(0),
    // 1 when the prompt text itself names this subject (a "compare X vs Y" prompt). Such
    // a (prompt, subject) pair is contaminated — naming a brand guarantees it appears —
    // so it is EXCLUDED from that subject's organic share-of-voice (numerator + denominator).
    // Computed once at write time; legacy rows default to 0 (treated as organic).
    promptNamed: integer("prompt_named").notNull().default(0),
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
    index("ai_visibility_results_org_product_recorded_idx").on(
      t.orgId,
      t.productId,
      t.recordedAt,
    ),
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
    level: integer("level").notNull().default(0), // cascade level: 0/1 free, 2 datacenter egress
    attempts: integer("attempts").notNull().default(1),
    failureReason: text("failure_reason").notNull().default(""),
    // Collection doctrine: a run where the site explicitly refused us (block /
    // challenge / robots Disallow) and we stopped — distinct from a transient
    // failure, so refusal rate is queryable separately in /admin.
    refused: boolean("refused").notNull().default(false),
    refusalReason: text("refusal_reason").notNull().default(""),
    durationMs: integer("duration_ms").notNull(),
    recordedAt: timestamp("recorded_at").notNull().defaultNow(),
  },
  (t) => [
    index("scrape_runs_recorded_idx").on(t.recordedAt),
    index("scrape_runs_monitor_recorded_idx").on(t.monitorId, t.recordedAt),
    // Activity timeline filters `competitor_id IN (...) ORDER BY recorded_at DESC`
    // (org-scoped over the whole history) — without this it's a near-full scan.
    index("scrape_runs_competitor_recorded_idx").on(t.competitorId, t.recordedAt),
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
    // Cost attribution per customer (2026-07 audit): best-effort owner of the
    // spend. org_id when the job knows the org, competitor_id when it only knows
    // the competitor — per-org readers resolve the rest via the competitors
    // table. Nullable, no FK (append-only best-effort logging, like the rest).
    orgId: text("org_id"),
    competitorId: text("competitor_id"),
    recordedAt: timestamp("recorded_at").notNull().defaultNow(),
  },
  (t) => [
    index("ai_runs_recorded_idx").on(t.recordedAt),
    index("ai_runs_org_recorded_idx").on(t.orgId, t.recordedAt),
  ],
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

// Archive-backfill outcome per run (2026-07-10 audit / first-signal SLO). The
// backfill job is best-effort with many silent exits — this records WHY each run
// ended (no archive, deny page, void capture, trivial diff, success…) so the
// SLO's miss buckets are queryable instead of invisible. outcome: self |
// no_live_snapshot | no_url | no_current_html | no_archive_capture |
// no_significant_change | change_triggered | error.
export const backfillRuns = pgTable(
  "backfill_runs",
  {
    id: uuid(),
    monitorId: text("monitor_id").notNull(),
    competitorId: text("competitor_id").notNull(),
    sourceType: text("source_type").notNull(),
    outcome: text("outcome").notNull(),
    detail: text("detail"),
    archivesSeeded: integer("archives_seeded").notNull().default(0),
    changeTriggered: integer("change_triggered").notNull().default(0), // 0/1
    durationMs: integer("duration_ms").notNull().default(0),
    recordedAt: timestamp("recorded_at").notNull().defaultNow(),
  },
  (t) => [
    index("backfill_runs_recorded_idx").on(t.recordedAt),
    index("backfill_runs_competitor_recorded_idx").on(t.competitorId, t.recordedAt),
  ],
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
export type PriceTier = InferSelectModel<typeof priceTiers>;
export type PricePoint = InferSelectModel<typeof pricePoints>;
export type JobCount = InferSelectModel<typeof jobCounts>;
export type ReviewScore = InferSelectModel<typeof reviewScores>;
export type SignalFeed = InferSelectModel<typeof signalFeed>;
export type ScrapeRun = InferSelectModel<typeof scrapeRuns>;
export type AiRun = InferSelectModel<typeof aiRuns>;
export type ExtractionRun = InferSelectModel<typeof extractionRuns>;
export type BackfillRun = InferSelectModel<typeof backfillRuns>;
export type NumericClaim = InferSelectModel<typeof numericClaims>;
export type TechStackHistory = InferSelectModel<typeof techStackHistory>;
export type PlatformDetectionRun = InferSelectModel<typeof platformDetectionRuns>;
