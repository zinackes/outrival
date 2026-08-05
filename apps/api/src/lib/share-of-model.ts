import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { aiVisibilityPrompts, competitors, messagingVersions, products } from "@outrival/db";
import {
  VISIBILITY_MIN_RUNS,
  VISIBILITY_WINDOW_DAYS,
  extractMentionSentences,
  rankVisibilitySubjects,
  visibilityTrend,
  visibilityWindowSeries,
  visibilityWindows,
  type SubjectMetrics,
  type VisibilityExtract,
  type VisibilityTrend,
} from "@outrival/shared";
import { db } from "./db";
import { analyticsQuery, sql } from "./analytics-safe";

/**
 * Share of Model for one competitor — Positioning Intelligence v2 P5.
 *
 * The `ai_visibility` runs have been writing `ai_visibility_results` on their own
 * cadence since phase 2. This file only READS them: no engine is queried here, no
 * model is called, and nothing on this response was generated. That is what lets
 * the section state a number without hedging it.
 *
 * Everything is measured over a WINDOW, never over a run. Asking an answer engine
 * the same question twice does not return the same answer, so a run-to-run delta
 * mostly measures the engine. Four weeks of runs averages that out — and when a
 * window does not hold enough runs to average anything, the response says so
 * instead of printing a rate computed off two answers.
 */

/** Past windows drawn in the sparkline, including the current one. */
const SERIES_WINDOWS = 6;

/** Stored answers scanned for verbatim extracts. Recent-first; the extractor
 *  de-duplicates and caps, so this only bounds the scan. */
const EXTRACT_SCAN = 40;

// ---------------------------------------------------------------------------
// Response shape
// ---------------------------------------------------------------------------

/** Counts that hold in every state, so the section can always say what is running. */
interface ShareOfModelBase {
  /** Active buyer-intent prompts on this workspace. */
  prompts: number;
  /** Answers recorded ABOUT this competitor, all engines, all time. */
  answers: number;
  lastRunAt: string | null;
}

/**
 * No visibility data about this competitor at all.
 *
 * The section still renders, stating what IS collected — the runs are real and
 * already cost money, and a reader told nothing assumes the capability is absent.
 * (Shape unchanged from P4, which the front already renders.)
 */
export interface ShareOfModelPending extends ShareOfModelBase {
  status: "not_ready";
}

/**
 * Answers exist, but the window does not hold enough runs to average.
 *
 * Distinct from `not_ready` on purpose: "we have not measured you enough yet" is a
 * different sentence from "nothing has run", and only one of them resolves by
 * waiting a fortnight.
 */
export interface ShareOfModelInsufficient extends ShareOfModelBase {
  status: "insufficient_data";
  /** Runs the current window holds. */
  nRuns: number;
  /** Runs it takes before a rate is worth printing. */
  minRuns: number;
  windowDays: number;
}

export interface SubjectStats {
  competitorId: string;
  name: string;
  isSelf: boolean;
  metrics: SubjectMetrics;
  /** Current window against the previous one, per metric. */
  trend: VisibilityTrend;
}

/** One prompt as the window's last run answered it. */
export interface PromptOutcome {
  promptId: string;
  prompt: string;
  engine: string;
  mentioned: boolean;
  /** The prompt itself names them, so this answer is seeded and excluded from
   *  the rate. Shown, because it is the reason a denominator can read 9 of 10. */
  promptNamed: boolean;
  rank: number | null;
  cited: boolean | null;
  sentiment: number | null;
  recordedAt: string;
}

/** What they say about themselves, beside what the engines say. */
export interface NarrativeGap {
  /** Their current hero headline, verbatim. */
  h1: string | null;
  /** Their loudest quantified claim, in the words the page printed. */
  claim: { rawText: string; observedAt: string } | null;
}

export interface ShareOfModelReady extends ShareOfModelBase {
  status: "ready";
  windowDays: number;
  windowStart: string;
  windowEnd: string;
  /** This competitor's window. */
  competitor: SubjectStats;
  /** The self product it is measured against. Null when the tracking product has
   *  no self competitor — the section then shows their side alone. */
  self: SubjectStats | null;
  /** "#3 of 6 tracked subjects" — the competitor's standing this window. */
  position: number;
  tracked: number;
  /** Mention rate per past window, oldest first. A window under the run minimum
   *  carries a null rate rather than a point drawn off two answers. */
  series: Array<{ windowStart: string; mentionRate: number | null; nRuns: number }>;
  /** The window's last run, one row per prompt and engine. */
  promptOutcomes: PromptOutcome[];
  /** Verbatim sentences from the stored answers. EMPTY when no answer text was
   *  persisted — the sub-section is then absent, never reconstructed. */
  extracts: VisibilityExtract[];
  narrative: NarrativeGap;
}

export type ShareOfModel = ShareOfModelPending | ShareOfModelInsufficient | ShareOfModelReady;

// ---------------------------------------------------------------------------
// Row shapes as the SQL returns them
// ---------------------------------------------------------------------------

interface HeadlineRow {
  answers: number;
  last_run: string | null;
}
interface ScopeRow {
  product_id: string | null;
}
interface WindowRow {
  competitorId: string;
  isCurrent: boolean;
  answers: number;
  mentions: number;
  avgRank: number | null;
  citedRate: number | null;
  avgSentiment: number | null;
  nRuns: number;
  engines: string[] | null;
}
interface SeriesRow {
  bucket: number;
  answers: number;
  mentions: number;
  nRuns: number;
}
interface PromptRow {
  promptId: string;
  engine: string;
  mentioned: number;
  promptNamed: number;
  rank: number | null;
  cited: number | null;
  sentiment: number | null;
  recordedAt: string;
}
interface ExcerptRow {
  engine: string;
  recordedAt: string;
  answerExcerpt: string | null;
}
interface ClaimRow {
  raw_text: string;
  observed_at: string;
}

const num = (v: unknown): number => (v == null ? 0 : Number(v));
const nullableNum = (v: unknown): number | null => (v == null ? null : Number(v));

function metricsOf(row: WindowRow | undefined): SubjectMetrics {
  if (!row || num(row.answers) === 0) {
    return {
      answers: 0,
      mentions: 0,
      mentionRate: 0,
      avgRank: null,
      citedRate: null,
      avgSentiment: null,
      nRuns: num(row?.nRuns),
      engines: (row?.engines ?? []).slice().sort(),
    };
  }
  const answers = num(row.answers);
  const mentions = num(row.mentions);
  return {
    answers,
    mentions,
    mentionRate: mentions / answers,
    avgRank: nullableNum(row.avgRank),
    citedRate: nullableNum(row.citedRate),
    avgSentiment: nullableNum(row.avgSentiment),
    nRuns: num(row.nRuns),
    engines: (row.engines ?? []).slice().sort(),
  };
}

// ---------------------------------------------------------------------------
// The read
// ---------------------------------------------------------------------------

export async function shareOfModelFor(args: {
  competitorId: string;
  orgId: string;
  now?: Date;
}): Promise<ShareOfModel> {
  const { competitorId, orgId } = args;
  const now = args.now ?? new Date();
  const { current, previous } = visibilityWindows(now);

  const [promptCount, headline, scope] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(aiVisibilityPrompts)
      .where(and(eq(aiVisibilityPrompts.orgId, orgId), eq(aiVisibilityPrompts.isActive, true))),
    analyticsQuery<HeadlineRow>(sql`
      SELECT count(*)::int AS answers,
             (max(recorded_at) AT TIME ZONE 'UTC')::text AS last_run
      FROM ai_visibility_results
      WHERE competitor_id = ${competitorId}
    `),
    // patch-28: a competitor can be tracked under more than one SKU, each with its
    // own prompt set, its own self and its own baseline. Mixing them would average
    // two different questions into one rate, so the window is scoped to the product
    // that measured them LAST — the one whose numbers are current. Legacy rows carry
    // no product_id, and `IS NOT DISTINCT FROM` keeps them queryable as their own scope.
    analyticsQuery<ScopeRow>(sql`
      SELECT product_id
      FROM ai_visibility_results
      WHERE competitor_id = ${competitorId}
      ORDER BY recorded_at DESC
      LIMIT 1
    `),
  ]);

  const base: ShareOfModelBase = {
    prompts: num(promptCount[0]?.n),
    answers: num(headline[0]?.answers),
    lastRunAt: headline[0]?.last_run ?? null,
  };
  if (base.answers === 0) return { ...base, status: "not_ready" };

  const productId = scope[0]?.product_id ?? null;
  const productScope = productId
    ? sql`AND product_id = ${productId}`
    : sql`AND product_id IS NULL`;

  const windows = await analyticsQuery<WindowRow>(sql`
    SELECT competitor_id AS "competitorId",
           (recorded_at >= ${current.start.toISOString()}) AS "isCurrent",
           count(*) FILTER (WHERE prompt_named = 0)::int AS answers,
           count(*) FILTER (WHERE prompt_named = 0 AND mentioned = 1)::int AS mentions,
           avg(rank) FILTER (WHERE prompt_named = 0 AND mentioned = 1) AS "avgRank",
           avg(cited) FILTER (WHERE prompt_named = 0 AND mentioned = 1) AS "citedRate",
           avg(sentiment_score) FILTER (WHERE prompt_named = 0 AND mentioned = 1)
             AS "avgSentiment",
           count(DISTINCT run_id) FILTER (WHERE prompt_named = 0)::int AS "nRuns",
           array_agg(DISTINCT engine) FILTER (WHERE prompt_named = 0) AS engines
    FROM ai_visibility_results
    WHERE org_id = ${orgId} ${productScope}
      AND recorded_at >= ${previous.start.toISOString()}
      AND recorded_at < ${current.end.toISOString()}
    GROUP BY 1, 2
  `);

  const currentByCompetitor = new Map<string, WindowRow>();
  const previousByCompetitor = new Map<string, WindowRow>();
  for (const row of windows) {
    (row.isCurrent ? currentByCompetitor : previousByCompetitor).set(row.competitorId, row);
  }

  const ourMetrics = metricsOf(currentByCompetitor.get(competitorId));
  if (ourMetrics.nRuns < VISIBILITY_MIN_RUNS) {
    return {
      ...base,
      status: "insufficient_data",
      nRuns: ourMetrics.nRuns,
      minRuns: VISIBILITY_MIN_RUNS,
      windowDays: VISIBILITY_WINDOW_DAYS,
    };
  }

  // The self this competitor is measured against is the tracking product's own
  // self-competitor, never "the org's self": a multi-SKU workspace has one per SKU.
  const selfId = await selfCompetitorIdOf(orgId, productId);
  const subjectIds = [...new Set([...currentByCompetitor.keys(), ...previousByCompetitor.keys()])];
  const names = subjectIds.length
    ? await db
        .select({ id: competitors.id, name: competitors.name })
        .from(competitors)
        .where(
          and(
            eq(competitors.orgId, orgId),
            isNull(competitors.deletedAt),
            inArray(competitors.id, subjectIds),
          ),
        )
    : [];
  const nameById = new Map(names.map((n) => [n.id, n.name]));

  // Rank over the subjects that still exist — a deleted competitor's rows linger in
  // the append-only table, and counting them would inflate "of 6 tracked subjects".
  // The ordering itself is the shared one, so this board and the worker's agree.
  const ranked = rankVisibilitySubjects(
    names.map((n) => ({
      id: n.id,
      name: n.name,
      isSelf: n.id === selfId,
      metrics: metricsOf(currentByCompetitor.get(n.id)),
    })),
  );
  const position = ranked.subjects.findIndex((s) => s.id === competitorId) + 1;

  const statsFor = (id: string): SubjectStats => ({
    competitorId: id,
    name: nameById.get(id) ?? "Unknown",
    isSelf: id === selfId,
    metrics: metricsOf(currentByCompetitor.get(id)),
    trend: visibilityTrend(
      metricsOf(currentByCompetitor.get(id)),
      metricsOf(previousByCompetitor.get(id)),
    ),
  });

  const series = visibilityWindowSeries(now, SERIES_WINDOWS);
  const seriesSpanSeconds = VISIBILITY_WINDOW_DAYS * 86_400;

  const [seriesRows, promptRows, excerptRows, claimRows, headlineRows] = await Promise.all([
    // Bucketed in SQL: distance back from the series end, in whole windows. Bucket 0
    // is the newest, so the display order is the reverse.
    analyticsQuery<SeriesRow>(sql`
      SELECT floor(
               extract(epoch from (${series[series.length - 1]!.end.toISOString()}::timestamp
                                   - recorded_at)) / ${seriesSpanSeconds}
             )::int AS bucket,
             count(*) FILTER (WHERE prompt_named = 0)::int AS answers,
             count(*) FILTER (WHERE prompt_named = 0 AND mentioned = 1)::int AS mentions,
             count(DISTINCT run_id) FILTER (WHERE prompt_named = 0)::int AS "nRuns"
      FROM ai_visibility_results
      WHERE competitor_id = ${competitorId} ${productScope}
        AND recorded_at >= ${series[0]!.start.toISOString()}
        AND recorded_at < ${series[series.length - 1]!.end.toISOString()}
      GROUP BY 1
    `),
    // The window's LAST run, whole. A per-prompt table assembled from the whole
    // window would show one prompt's answer from Tuesday next to another's from three
    // weeks ago and read as a single sitting.
    analyticsQuery<PromptRow>(sql`
      WITH latest AS (
        SELECT run_id
        FROM ai_visibility_results
        WHERE competitor_id = ${competitorId} ${productScope}
          AND recorded_at >= ${current.start.toISOString()}
          AND recorded_at < ${current.end.toISOString()}
        ORDER BY recorded_at DESC
        LIMIT 1
      )
      SELECT r.prompt_id AS "promptId", r.engine, r.mentioned,
             r.prompt_named AS "promptNamed", r.rank, r.cited,
             r.sentiment_score AS "sentiment",
             to_char(r.recorded_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "recordedAt"
      FROM ai_visibility_results r
      JOIN latest l ON l.run_id = r.run_id
      WHERE r.competitor_id = ${competitorId}
      ORDER BY r.engine
    `),
    // Only the answers that named them describe them. `answer_excerpt` is null on
    // rows written before excerpts were kept, and those simply yield no extract.
    //
    // `recorded_at` is a naive timestamp already holding UTC, so formatting it
    // verbatim with a Z is the one rendering that cannot drift with the session's
    // timezone — a timestamptz cast to text renders in whatever zone the pooled
    // connection happens to carry.
    analyticsQuery<ExcerptRow>(sql`
      SELECT engine, to_char(recorded_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "recordedAt",
             answer_excerpt AS "answerExcerpt"
      FROM ai_visibility_results
      WHERE competitor_id = ${competitorId} ${productScope}
        AND recorded_at >= ${current.start.toISOString()}
        AND recorded_at < ${current.end.toISOString()}
        AND mentioned = 1 AND answer_excerpt IS NOT NULL
      ORDER BY recorded_at DESC
      LIMIT ${EXTRACT_SCAN}
    `),
    analyticsQuery<ClaimRow>(sql`
      SELECT raw_text, to_char(observed_at, 'YYYY-MM-DD') AS observed_at
      FROM numeric_claims
      WHERE competitor_id = ${competitorId}
      ORDER BY observed_at DESC
      LIMIT 1
    `),
    // The left column of the narrative gap. Read here rather than threaded in from
    // the caller so the two halves of the juxtaposition are assembled in one place:
    // a headline shown beside a mention rate measured over a different window would
    // be the one thing this section must never do.
    db
      .select({ h1: messagingVersions.h1 })
      .from(messagingVersions)
      .where(eq(messagingVersions.competitorId, competitorId))
      .orderBy(desc(messagingVersions.capturedAt))
      .limit(1),
  ]);

  const promptTexts = promptRows.length
    ? await db
        .select({ id: aiVisibilityPrompts.id, prompt: aiVisibilityPrompts.prompt })
        .from(aiVisibilityPrompts)
        .where(
          and(
            eq(aiVisibilityPrompts.orgId, orgId),
            inArray(aiVisibilityPrompts.id, [...new Set(promptRows.map((r) => r.promptId))]),
          ),
        )
    : [];
  const promptById = new Map(promptTexts.map((p) => [p.id, p.prompt]));

  const seriesByBucket = new Map(seriesRows.map((r) => [num(r.bucket), r]));
  const ourName = nameById.get(competitorId) ?? "Unknown";

  return {
    ...base,
    status: "ready",
    windowDays: VISIBILITY_WINDOW_DAYS,
    windowStart: current.start.toISOString(),
    windowEnd: current.end.toISOString(),
    competitor: statsFor(competitorId),
    self: selfId && nameById.has(selfId) ? statsFor(selfId) : null,
    position: position > 0 ? position : ranked.tracked,
    tracked: ranked.tracked,
    series: series.map((w, i) => {
      const row = seriesByBucket.get(series.length - 1 - i);
      const answers = num(row?.answers);
      const nRuns = num(row?.nRuns);
      return {
        windowStart: w.start.toISOString(),
        // A window that never met the run minimum draws no point. A sparkline that
        // dips to 0% because the engine was quota-starved that fortnight tells the
        // reader a story the data does not support.
        mentionRate: nRuns >= VISIBILITY_MIN_RUNS && answers > 0 ? num(row?.mentions) / answers : null,
        nRuns,
      };
    }),
    promptOutcomes: promptRows
      // A deleted prompt's rows linger in the append-only table; drop them rather
      // than printing "(removed prompt)" in an evidence table.
      .filter((r) => promptById.has(r.promptId))
      .map((r) => ({
        promptId: r.promptId,
        prompt: promptById.get(r.promptId) as string,
        engine: r.engine,
        mentioned: num(r.mentioned) === 1,
        promptNamed: num(r.promptNamed) === 1,
        rank: nullableNum(r.rank),
        cited: r.cited == null ? null : num(r.cited) === 1,
        sentiment: nullableNum(r.sentiment),
        recordedAt: r.recordedAt,
      }))
      .sort((a, b) => a.prompt.localeCompare(b.prompt) || a.engine.localeCompare(b.engine)),
    extracts: extractMentionSentences(
      excerptRows.map((r) => ({
        engine: r.engine,
        recordedAt: new Date(r.recordedAt),
        answerExcerpt: r.answerExcerpt,
      })),
      ourName,
    ),
    narrative: {
      h1: headlineRows[0]?.h1 ?? null,
      claim: claimRows[0]
        ? { rawText: claimRows[0].raw_text, observedAt: claimRows[0].observed_at }
        : null,
    },
  };
}

/**
 * The self-competitor of the product that measured this competitor last.
 *
 * Falls back to the org's primary product when the rows predate per-product runs
 * (`product_id` null), because that is the product those runs were made for.
 */
async function selfCompetitorIdOf(orgId: string, productId: string | null): Promise<string | null> {
  const row = productId
    ? await db.query.products.findFirst({
        where: and(eq(products.id, productId), eq(products.orgId, orgId)),
        columns: { selfCompetitorId: true },
      })
    : await db.query.products.findFirst({
        where: eq(products.orgId, orgId),
        columns: { selfCompetitorId: true },
        orderBy: (p, { asc, desc: d }) => [d(p.isPrimary), asc(p.position), asc(p.createdAt)],
      });
  return row?.selfCompetitorId ?? null;
}
