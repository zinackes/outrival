// AI Visibility metrics — Positioning Intelligence v2 P5 (docs/ai-visibility.md).
//
// Pure functions over the rows `ai_visibility_results` already holds. Nothing here
// queries, and nothing here calls a model: the runs happen on their own cadence and
// this file only reads what they wrote.
//
// The unit of measurement is a WINDOW, never a run. A single run is one sweep of a
// prompt set through an answer engine, and an LLM asked the same question twice does
// not answer it the same way — so a run-to-run delta measures the engine's variance
// far more often than it measures a market move. Averaging over 28 days of runs is
// what makes a shift readable at all.

/** Rolling window, in days. Four weeks: long enough to average out engine variance,
 *  short enough that a move inside a quarter is still visible. */
export const VISIBILITY_WINDOW_DAYS = 28;

/** Runs a window must hold, on BOTH sides, before a shift between them is trusted.
 *  Under this, a single flaky run moves the average by more than the threshold. */
export const VISIBILITY_MIN_RUNS = 8;

/** |Δ mention rate| that makes a shift, in PERCENTAGE POINTS (58% → 31% is 27). */
export const VISIBILITY_SHIFT_MENTION_POINTS = 15;

/** |Δ average rank| that makes a shift, in positions. */
export const VISIBILITY_SHIFT_RANK_POSITIONS = 2;

/** One shift per subject per this many days. Same length as the window, so two
 *  consecutive signals can never be computed off overlapping data. */
export const VISIBILITY_SHIFT_COOLDOWN_DAYS = 28;

/** Verbatim extracts kept per window, and how long one may run. */
export const VISIBILITY_MAX_EXTRACTS = 3;
export const VISIBILITY_EXTRACT_MAX_CHARS = 200;

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

/** A half-open interval `[start, end)`, both instants at a UTC midnight. */
export interface VisibilityWindow {
  start: Date;
  end: Date;
}

/**
 * The current and previous windows as of `now`.
 *
 * Both edges snap to UTC midnight, and `end` is the midnight that STARTS the day
 * after `now` — so the day in progress counts, and the bounds only move once per
 * UTC day rather than sliding under the reader with every request. Two calls made
 * an hour apart return the same window, which is what makes "58% → 31%" mean the
 * same thing to the endpoint that renders it and the job that signalled on it.
 *
 * Snapping in UTC (never in the server's zone) is what keeps a month edge stable:
 * a run recorded 2026-03-01T00:30:00Z belongs to March everywhere, including on a
 * box running in Europe/Paris where local midnight came an hour earlier.
 */
export function visibilityWindows(
  now: Date,
  days: number = VISIBILITY_WINDOW_DAYS,
): { current: VisibilityWindow; previous: VisibilityWindow } {
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0),
  );
  const span = days * DAY_MS;
  const currentStart = new Date(end.getTime() - span);
  return {
    current: { start: currentStart, end },
    previous: { start: new Date(currentStart.getTime() - span), end: currentStart },
  };
}

/** The `n` windows ending at `now`, oldest first — the sparkline's buckets. */
export function visibilityWindowSeries(
  now: Date,
  count: number,
  days: number = VISIBILITY_WINDOW_DAYS,
): VisibilityWindow[] {
  const { current } = visibilityWindows(now, days);
  const span = days * DAY_MS;
  const out: VisibilityWindow[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const start = new Date(current.start.getTime() - i * span);
    out.push({ start, end: new Date(start.getTime() + span) });
  }
  return out;
}

/** Which bucket of `series` an instant falls in, or -1 when it falls outside. */
export function windowIndexOf(series: VisibilityWindow[], at: Date): number {
  const t = at.getTime();
  return series.findIndex((w) => t >= w.start.getTime() && t < w.end.getTime());
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

/** One verdict the extraction wrote: what one answer said about one subject. */
export interface VisibilityAnswer {
  competitorId: string;
  runId: string;
  promptId: string;
  engine: string;
  recordedAt: Date;
  mentioned: boolean;
  /**
   * The prompt text itself names this subject ("Acme vs Beta"). Naming a brand
   * guarantees it appears, so the pair is not an organic test of that subject and
   * is dropped from BOTH sides of its mention rate — the same exclusion the run
   * table records at write time in `prompt_named`.
   */
  promptNamed: boolean;
  rank: number | null;
  cited: boolean | null;
  /** 0 (negative) to 100 (positive), as the extraction scores it. */
  sentiment: number | null;
}

export interface SubjectMetrics {
  /** Organic answers held about this subject in the window (the denominator). */
  answers: number;
  /** Of those, how many named it. */
  mentions: number;
  /** mentions / answers, 0..1. Zero answers reads 0 — the caller gates on nRuns. */
  mentionRate: number;
  /** Average position of first mention, over the answers that mentioned it. */
  avgRank: number | null;
  /** Of the answers that mentioned it, the share that linked it as a source. */
  citedRate: number | null;
  /** 0..100, over the answers that mentioned it and scored a tone. */
  avgSentiment: number | null;
  /** Distinct runs behind the numbers. The gate for every claim on this page. */
  nRuns: number;
  /** Engines that contributed, sorted — the "(Gemini+Perplexity)" of the copy. */
  engines: string[];
}

export const EMPTY_SUBJECT_METRICS: SubjectMetrics = {
  answers: 0,
  mentions: 0,
  mentionRate: 0,
  avgRank: null,
  citedRate: null,
  avgSentiment: null,
  nRuns: 0,
  engines: [],
};

/**
 * Roll a subject's answers up into its window metrics.
 *
 * `mentionRate` divides by the ORGANIC answers only. A subject named by every
 * prompt would otherwise score a flattering 100% for having been handed its own
 * answer; here it scores on the questions that did not mention it, which is the
 * only number a buyer's question actually tests.
 *
 * `citedRate`, `avgRank` and `avgSentiment` are conditioned on being mentioned —
 * they answer "when they show up, how do they show up", and averaging a null rank
 * over absences would drag every subject toward the same middle.
 */
export function subjectMetrics(rows: readonly VisibilityAnswer[]): SubjectMetrics {
  const organic = rows.filter((r) => !r.promptNamed);
  if (organic.length === 0) return { ...EMPTY_SUBJECT_METRICS };

  const runs = new Set<string>();
  const engines = new Set<string>();
  let mentions = 0;
  let rankSum = 0;
  let rankCount = 0;
  let citedKnown = 0;
  let citedTrue = 0;
  let sentimentSum = 0;
  let sentimentCount = 0;

  for (const r of organic) {
    runs.add(r.runId);
    engines.add(r.engine);
    if (!r.mentioned) continue;
    mentions++;
    if (r.rank != null) {
      rankSum += r.rank;
      rankCount++;
    }
    if (r.cited != null) {
      citedKnown++;
      if (r.cited) citedTrue++;
    }
    if (r.sentiment != null) {
      sentimentSum += r.sentiment;
      sentimentCount++;
    }
  }

  return {
    answers: organic.length,
    mentions,
    mentionRate: mentions / organic.length,
    avgRank: rankCount > 0 ? rankSum / rankCount : null,
    citedRate: citedKnown > 0 ? citedTrue / citedKnown : null,
    avgSentiment: sentimentCount > 0 ? sentimentSum / sentimentCount : null,
    nRuns: runs.size,
    engines: [...engines].sort(),
  };
}

// ---------------------------------------------------------------------------
// Share of Model
// ---------------------------------------------------------------------------

export interface VisibilitySubject {
  id: string;
  name: string;
  isSelf: boolean;
}

export interface RankedSubject extends VisibilitySubject {
  metrics: SubjectMetrics;
  /** 1-based standing among the tracked subjects, by mention rate. */
  position: number;
}

export interface ShareOfModelResult {
  subjects: RankedSubject[];
  /** The denominator of "#3 of 6 tracked subjects". */
  tracked: number;
}

/**
 * Rank subjects whose metrics are already computed.
 *
 * Split out from `shareOfModel` because the two callers arrive from opposite
 * directions: the worker holds the rows and rolls them up here, while the endpoint
 * aggregates in SQL and arrives with the metrics already made. Both must order the
 * board identically, so the ordering lives in one place.
 *
 * By mention rate, then by average rank (a subject named as often but earlier
 * stands higher), then by id so two subjects with identical numbers do not swap
 * places between two requests. A subject with no rows still gets a row and a
 * position: "they were named in none of them" is the finding, not a gap.
 */
export function rankVisibilitySubjects(
  scored: ReadonlyArray<VisibilitySubject & { metrics: SubjectMetrics }>,
): ShareOfModelResult {
  const sorted = [...scored].sort(
    (a, b) =>
      b.metrics.mentionRate - a.metrics.mentionRate ||
      (a.metrics.avgRank ?? Infinity) - (b.metrics.avgRank ?? Infinity) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  return {
    subjects: sorted.map((s, i) => ({ ...s, position: i + 1 })),
    tracked: sorted.length,
  };
}

/** Every tracked subject's window metrics, rolled up from rows and ranked. */
export function shareOfModel(
  rows: readonly VisibilityAnswer[],
  subjects: readonly VisibilitySubject[],
): ShareOfModelResult {
  const byId = new Map<string, VisibilityAnswer[]>();
  for (const r of rows) {
    const arr = byId.get(r.competitorId);
    if (arr) arr.push(r);
    else byId.set(r.competitorId, [r]);
  }
  return rankVisibilitySubjects(
    subjects.map((s) => ({ ...s, metrics: subjectMetrics(byId.get(s.id) ?? []) })),
  );
}

// ---------------------------------------------------------------------------
// Trend
// ---------------------------------------------------------------------------

export interface VisibilityTrend {
  /** Signed move in the 0..1 rate. Null when either window holds no answers. */
  mentionRate: number | null;
  /** Signed move in positions. NEGATIVE is an improvement (rank 4 → 2 is -2). */
  avgRank: number | null;
  citedRate: number | null;
  avgSentiment: number | null;
}

/** Per-metric move from `previous` to `current`. A metric missing on either side
 *  yields null rather than a delta against an assumed zero. */
export function visibilityTrend(
  current: SubjectMetrics,
  previous: SubjectMetrics,
): VisibilityTrend {
  const delta = (a: number | null, b: number | null): number | null =>
    a == null || b == null ? null : a - b;
  return {
    mentionRate:
      current.answers > 0 && previous.answers > 0
        ? current.mentionRate - previous.mentionRate
        : null,
    avgRank: delta(current.avgRank, previous.avgRank),
    citedRate: delta(current.citedRate, previous.citedRate),
    avgSentiment: delta(current.avgSentiment, previous.avgSentiment),
  };
}

// ---------------------------------------------------------------------------
// Shift detection
// ---------------------------------------------------------------------------

export interface VisibilityShift {
  /** Which threshold fired. Both can move; the mention rate is the headline. */
  driver: "mention_rate" | "avg_rank";
  direction: "up" | "down";
  current: SubjectMetrics;
  previous: SubjectMetrics;
  /** Signed, in percentage points. */
  mentionPointsDelta: number;
  /** Signed, in positions. Negative = moved up the answer. */
  rankDelta: number | null;
}

/**
 * Does the move between two windows clear the bar for a signal?
 *
 * Three gates, all of which must hold:
 *  1. BOTH windows carry at least `minRuns` runs. A window built on three runs is
 *     an engine's mood, and comparing two of them manufactures a story.
 *  2. The mention rate moved by at least `VISIBILITY_SHIFT_MENTION_POINTS` points,
 *     OR the average rank moved by at least `VISIBILITY_SHIFT_RANK_POSITIONS`.
 *  3. The rank test needs a rank on both sides — a subject that went from absent
 *     to present has no "previous rank", and its mention rate already says so.
 *
 * Returns null when nothing clears, which is the answer most of the time.
 */
export function detectVisibilityShift(
  current: SubjectMetrics,
  previous: SubjectMetrics,
  minRuns: number = VISIBILITY_MIN_RUNS,
): VisibilityShift | null {
  if (current.nRuns < minRuns || previous.nRuns < minRuns) return null;

  const mentionPointsDelta = (current.mentionRate - previous.mentionRate) * 100;
  const rankDelta =
    current.avgRank != null && previous.avgRank != null
      ? current.avgRank - previous.avgRank
      : null;

  // Both sides are ratios of small integers, so a move that IS exactly the threshold
  // lands a few ULPs under it in binary — (0.43 - 0.58) * 100 is -14.999999999999996.
  // Without this the gate would silently refuse the very move it documents.
  const EPSILON = 1e-9;
  const mentionFired =
    Math.abs(mentionPointsDelta) >= VISIBILITY_SHIFT_MENTION_POINTS - EPSILON;
  const rankFired =
    rankDelta != null && Math.abs(rankDelta) >= VISIBILITY_SHIFT_RANK_POSITIONS - EPSILON;
  if (!mentionFired && !rankFired) return null;

  // The mention rate is the headline whenever it moved: "named in half as many
  // answers" is a bigger fact than "named two lines later in the ones it survived".
  const driver = mentionFired ? "mention_rate" : "avg_rank";
  const direction =
    driver === "mention_rate"
      ? mentionPointsDelta > 0
        ? "up"
        : "down"
      : // A LOWER rank number is a better position, so a negative rank delta is "up".
        (rankDelta as number) < 0
        ? "up"
        : "down";

  return { driver, direction, current, previous, mentionPointsDelta, rankDelta };
}

const pct = (x: number): string => `${Math.round(x * 100)}%`;

const ENGINE_LABELS: Record<string, string> = {
  gemini: "Gemini",
  perplexity: "Perplexity",
  chatgpt: "ChatGPT",
  claude: "Claude",
  google_aio: "Google AI Overviews",
};

/** "Gemini+Perplexity" — the engines behind a window, in their product names. */
export function visibilityEngineLabel(engines: readonly string[]): string {
  return engines.map((e) => ENGINE_LABELS[e] ?? e).join("+");
}

/**
 * The one line the feed prints for a shift, e.g.
 * `AI visibility — mention rate 58% → 31% (Gemini+Perplexity, 12 answers)`.
 *
 * The engines and the answer count travel with the numbers because a rate without
 * its denominator invites the reader to trust two decimal places it does not have.
 */
export function visibilityHumanChange(shift: VisibilityShift): string {
  const { current, previous } = shift;
  const engines = visibilityEngineLabel(current.engines);
  const context = `(${engines ? `${engines}, ` : ""}${current.answers} answer${current.answers === 1 ? "" : "s"})`;
  if (shift.driver === "mention_rate") {
    return `AI visibility — mention rate ${pct(previous.mentionRate)} → ${pct(current.mentionRate)} ${context}`;
  }
  const before = previous.avgRank == null ? "—" : previous.avgRank.toFixed(1);
  const after = current.avgRank == null ? "—" : current.avgRank.toFixed(1);
  return `AI visibility — average rank ${before} → ${after} ${context}`;
}

/**
 * The same move split in two, for the "Why this insight?" panel — which renders a
 * before and an after in their own cells rather than one arrowed line.
 */
export function visibilityHumanChangeSides(shift: VisibilityShift): {
  before: string;
  after: string;
} {
  const { current, previous } = shift;
  if (shift.driver === "mention_rate") {
    return {
      before: `Named in ${pct(previous.mentionRate)} of AI answers`,
      after: `Named in ${pct(current.mentionRate)} of AI answers`,
    };
  }
  return {
    before: previous.avgRank == null ? "Not ranked" : `Average position ${previous.avgRank.toFixed(1)}`,
    after: current.avgRank == null ? "Not ranked" : `Average position ${current.avgRank.toFixed(1)}`,
  };
}

// ---------------------------------------------------------------------------
// Verbatim extracts — "How AIs describe them"
// ---------------------------------------------------------------------------

export interface VisibilityExtract {
  /** An EXACT substring of the stored answer. Never rewritten, never summarised. */
  text: string;
  engine: string;
  /** ISO instant of the run it came from. */
  recordedAt: string;
}

/** Sentence terminators we split on. Deliberately the three that end a sentence in
 *  the English the engines answer in — no abbreviation dictionary, no NLP. */
const SENTENCE_END = /[.!?]/;

/**
 * The sentence of `answer` that names `subject`, verbatim.
 *
 * Pure string manipulation: find the name, walk backwards to the previous sentence
 * terminator or newline, walk forwards to the next one, and return that slice
 * unchanged. Nothing is generated, so what the section prints can always be found
 * character-for-character in the answer we stored — which is the whole reason this
 * sub-section is allowed to exist at all.
 *
 * Returns null when the name is absent, or when the sentence around it exceeds the
 * cap: a truncated sentence is a paraphrase we did not intend to write.
 */
export function extractMentionSentence(
  answer: string,
  subject: string,
  maxChars: number = VISIBILITY_EXTRACT_MAX_CHARS,
): string | null {
  const name = subject.trim();
  if (name.length < 2) return null;
  const at = answer.toLowerCase().indexOf(name.toLowerCase());
  if (at === -1) return null;

  let start = 0;
  for (let i = at - 1; i >= 0; i--) {
    const ch = answer[i] as string;
    if (ch === "\n" || SENTENCE_END.test(ch)) {
      start = i + 1;
      break;
    }
  }
  let end = answer.length;
  for (let i = at + name.length; i < answer.length; i++) {
    const ch = answer[i] as string;
    if (ch === "\n") {
      end = i;
      break;
    }
    if (SENTENCE_END.test(ch)) {
      end = i + 1;
      break;
    }
  }

  // Leading list markup ("- ", "* ", "1. ") is chrome, not words they wrote.
  const text = answer.slice(start, end).replace(/^[\s\-*•>#]+/, "").trim();
  if (text.length === 0 || text.length > maxChars) return null;
  return text;
}

/** One answer as it was stored, for the extract pass. */
export interface StoredAnswer {
  engine: string;
  recordedAt: Date;
  /** Null on rows written before excerpts were kept — those simply yield nothing. */
  answerExcerpt: string | null;
}

/**
 * Up to `max` verbatim sentences describing `subject`, most recent first.
 *
 * De-duplicated on the sentence itself: engines repeat their own phrasing across a
 * month of runs, and printing the same line three times reads as three findings.
 */
export function extractMentionSentences(
  answers: readonly StoredAnswer[],
  subject: string,
  max: number = VISIBILITY_MAX_EXTRACTS,
): VisibilityExtract[] {
  const out: VisibilityExtract[] = [];
  const seen = new Set<string>();
  const ordered = [...answers].sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime());
  for (const a of ordered) {
    if (out.length >= max) break;
    if (!a.answerExcerpt) continue;
    const text = extractMentionSentence(a.answerExcerpt, subject);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ text, engine: a.engine, recordedAt: a.recordedAt.toISOString() });
  }
  return out;
}
