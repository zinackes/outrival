// Detect upward inflections in a competitor's recurring complaint themes over the
// review_scores time-series, and turn them into (a) a grounded "reviews" signal and
// (b) auto-injected battle-card objection munition. Pure — no DB, no AI, no I/O — so
// the whole thing is unit-testable; the job (detect-review-theme-shifts) does the
// orchestration.
//
// The complaint THEMES are already produced upstream (patch-32: the AI judge clusters
// them into review_scores.complaint_themes on every reviews scrape). This module never
// recomputes a theme — it only aggregates the existing series over a sliding window.

import type { Classification } from "@outrival/ai";
import type { BattleCardContent } from "@outrival/ai";

// ── Normalization ──────────────────────────────────────────────────────────────
// The same grievance is phrased differently from one scrape (and one review source)
// to the next — "slow support", "Support is slow", "support too slow". We collapse
// each label to a canonical key (significant tokens, sorted, deduped) so those merge
// BEFORE any comparison. Only grammatical stopwords are dropped: sentiment words
// ("slow", "poor", "confusing") carry the meaning and must stay, or distinct
// complaints would over-merge.
const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "being", "been",
  "of", "to", "and", "or", "for", "with", "in", "on", "at", "by", "from",
  "it", "its", "their", "them", "they", "our", "your", "we", "you",
  "that", "this", "these", "those", "there", "has", "have", "had", "do", "does",
  "too", "very", "so", "much", "many", "few", "more", "most", "as", "than", "when", "about",
]);

// Trivial singularization: strip a trailing plural "s" (but not "ss": process,
// access) on tokens long enough to be a real word. Good enough to merge
// "issues"/"issue", "bugs"/"bug" without a stemmer.
function singularize(token: string): string {
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) {
    return token.slice(0, -1);
  }
  return token;
}

export function normalizeThemeKey(label: string): string {
  const tokens = label
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => !STOPWORDS.has(t))
    .map(singularize)
    .filter((t) => t.length > 0);
  return [...new Set(tokens)].sort().join(" ");
}

// ── Detection ──────────────────────────────────────────────────────────────────

export type Prevalence = "low" | "medium" | "high";
const WEIGHT: Record<Prevalence, number> = { low: 1, medium: 2, high: 3 };
function prevalenceWeight(p: string): number {
  return WEIGHT[p as Prevalence] ?? 1;
}
function isHigher(a: string, b: string): boolean {
  return prevalenceWeight(a) > prevalenceWeight(b);
}

export interface ThemeSeriesRow {
  source: string;
  recordedAt: Date;
  themes: Array<{ theme: string; prevalence: string }>;
}

export interface RisingTheme {
  /** Canonical normalized key (used for dedup across labels + against objections). */
  key: string;
  /** Display label — the most frequent original phrasing in the recent window. */
  label: string;
  /** Mean prevalence-weight per recent/baseline scrape (frequency × intensity). */
  recentScore: number;
  baselineScore: number;
  delta: number;
  /** Distinct review sources mentioning it recently (grounding evidence). */
  sources: string[];
  /** recordedAt of the recent rows that mention it (grounding evidence — dates). */
  recentDates: Date[];
  /** Highest prevalence seen in the recent window. */
  peakPrevalence: Prevalence;
}

export interface DetectOptions {
  now?: Date;
  windowDays?: number;
  lookbackDays?: number;
  riseThreshold?: number;
  minRecentScore?: number;
  minRecentOccurrences?: number;
}

const DEFAULTS = {
  windowDays: 42,
  lookbackDays: 84,
  riseThreshold: 0.75,
  minRecentScore: 1.0,
  minRecentOccurrences: 2,
};

interface WindowAgg {
  rowCount: number;
  // per key
  sumWeight: Map<string, number>;
  occurrences: Map<string, number>;
  labels: Map<string, Map<string, number>>; // key → label → count
  sources: Map<string, Set<string>>;
  dates: Map<string, Date[]>;
  peak: Map<string, string>;
}

function emptyAgg(): WindowAgg {
  return {
    rowCount: 0,
    sumWeight: new Map(),
    occurrences: new Map(),
    labels: new Map(),
    sources: new Map(),
    dates: new Map(),
    peak: new Map(),
  };
}

function accumulate(agg: WindowAgg, row: ThemeSeriesRow): void {
  agg.rowCount += 1;
  // A theme can appear once per row; if a label repeats within a row, keep the max.
  const perRow = new Map<string, { weight: number; prevalence: string; label: string }>();
  for (const t of row.themes) {
    const key = normalizeThemeKey(t.theme);
    if (!key) continue;
    const w = prevalenceWeight(t.prevalence);
    const existing = perRow.get(key);
    if (!existing || w > existing.weight) {
      perRow.set(key, { weight: w, prevalence: t.prevalence, label: t.theme });
    }
  }
  for (const [key, v] of perRow) {
    agg.sumWeight.set(key, (agg.sumWeight.get(key) ?? 0) + v.weight);
    agg.occurrences.set(key, (agg.occurrences.get(key) ?? 0) + 1);
    const labelCounts = agg.labels.get(key) ?? new Map<string, number>();
    labelCounts.set(v.label, (labelCounts.get(v.label) ?? 0) + 1);
    agg.labels.set(key, labelCounts);
    const srcs = agg.sources.get(key) ?? new Set<string>();
    srcs.add(row.source);
    agg.sources.set(key, srcs);
    const dates = agg.dates.get(key) ?? [];
    dates.push(row.recordedAt);
    agg.dates.set(key, dates);
    const peak = agg.peak.get(key);
    if (!peak || isHigher(v.prevalence, peak)) agg.peak.set(key, v.prevalence);
  }
}

function score(agg: WindowAgg, key: string): number {
  if (agg.rowCount === 0) return 0;
  return (agg.sumWeight.get(key) ?? 0) / agg.rowCount;
}

function pickLabel(labelCounts: Map<string, number> | undefined, key: string): string {
  if (!labelCounts || labelCounts.size === 0) return key;
  let best = key;
  let bestCount = -1;
  for (const [label, count] of labelCounts) {
    if (count > bestCount) {
      best = label;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Rising complaint themes: normalized themes whose sliding-window "pressure"
 * (frequency × intensity) climbed materially from the baseline window to the recent
 * window. A theme stable across both windows returns nothing (noise), a brand-new or
 * intensifying grievance surfaces. Sorted by delta, strongest first.
 */
export function detectThemeShifts(rows: ThemeSeriesRow[], opts: DetectOptions = {}): RisingTheme[] {
  const now = opts.now ?? new Date();
  const windowDays = opts.windowDays ?? DEFAULTS.windowDays;
  const lookbackDays = opts.lookbackDays ?? DEFAULTS.lookbackDays;
  const riseThreshold = opts.riseThreshold ?? DEFAULTS.riseThreshold;
  const minRecentScore = opts.minRecentScore ?? DEFAULTS.minRecentScore;
  const minRecentOccurrences = opts.minRecentOccurrences ?? DEFAULTS.minRecentOccurrences;

  const recentStart = now.getTime() - windowDays * 86_400_000;
  const lookbackStart = now.getTime() - lookbackDays * 86_400_000;

  const recent = emptyAgg();
  const baseline = emptyAgg();
  for (const row of rows) {
    const t = row.recordedAt.getTime();
    if (t >= recentStart && t <= now.getTime()) accumulate(recent, row);
    else if (t >= lookbackStart && t < recentStart) accumulate(baseline, row);
  }

  const rising: RisingTheme[] = [];
  for (const key of recent.sumWeight.keys()) {
    const occ = recent.occurrences.get(key) ?? 0;
    if (occ < minRecentOccurrences) continue;
    const recentScore = score(recent, key);
    if (recentScore < minRecentScore) continue;
    const baselineScore = score(baseline, key);
    const delta = recentScore - baselineScore;
    if (delta < riseThreshold) continue;
    rising.push({
      key,
      label: pickLabel(recent.labels.get(key), key),
      recentScore,
      baselineScore,
      delta,
      sources: [...(recent.sources.get(key) ?? [])].sort(),
      recentDates: (recent.dates.get(key) ?? []).slice().sort((a, b) => a.getTime() - b.getTime()),
      peakPrevalence: (recent.peak.get(key) as Prevalence) ?? "low",
    });
  }
  return rising.sort((a, b) => b.delta - a.delta);
}

// ── Emission planning ────────────────────────────────────────────────────────────

export interface CausalitySignal {
  category: string;
  insight: string;
  createdAt: Date;
}

export interface ThemeShiftEmission {
  /** Grounding source text for generate-signal: theme, before→after, sources, dates. */
  diffText: string;
  classification: Classification;
  risingLabels: string[];
  /** Sorted canonical keys → the job hashes these to dedup vs the last emission. */
  risingKeys: string[];
}

export interface ThemeShiftPlanContext {
  competitorName: string;
  windowDays: number;
  /** Recent pricing/product signals for the same competitor (bonus causality note). */
  causalitySignals?: CausalitySignal[];
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Reviews shifts are opinion drift, not a paged-outage-class event: cap at "high".
function severityForShift(top: RisingTheme): "low" | "medium" | "high" {
  if (top.peakPrevalence === "high" && top.delta >= 1.5) return "high";
  if (top.delta >= 1.0) return "medium";
  return "low";
}

/**
 * Turn rising themes into ONE grounded emission (one snapshot → one change → one
 * signal — less noisy than one-signal-per-theme). Returns `emission: null` and
 * `shouldFlagBattleCards: false` when nothing rises.
 */
export function planThemeShiftEmissions(
  rising: RisingTheme[],
  ctx: ThemeShiftPlanContext,
): { emission: ThemeShiftEmission | null; shouldFlagBattleCards: boolean } {
  if (rising.length === 0) return { emission: null, shouldFlagBattleCards: false };

  const top = rising[0]!;
  const severity = severityForShift(top);

  const lines = rising.map((r) => {
    const dates = r.recentDates.map(isoDate).join(", ");
    return (
      `- "${r.label}": now mentioned across ${r.sources.join("/")} reviews ` +
      `(peak prevalence ${r.peakPrevalence}), pressure ${r.baselineScore.toFixed(1)} → ` +
      `${r.recentScore.toFixed(1)} over the last ${ctx.windowDays} days. ` +
      `Recent review captures: ${dates || "n/a"}.`
    );
  });

  // Bonus causality: a recent pricing/product move by the same competitor that the
  // complaint rise may be a reaction to. Deterministic, appended to the grounding text.
  let causality = "";
  const cs = ctx.causalitySignals ?? [];
  if (cs.length > 0) {
    const c = cs[0]!;
    causality =
      `\n\nContext: this coincides with a recent ${c.category} change at ` +
      `${ctx.competitorName} — "${c.insight}" (${isoDate(c.createdAt)}). ` +
      `The complaint rise may be a reaction to it.`;
  }

  const diffText =
    `Recurring customer-complaint themes are rising for ${ctx.competitorName} ` +
    `across its review sources (${top.sources.join("/")}):\n` +
    lines.join("\n") +
    causality;

  const classification: Classification = {
    category: "reviews",
    severity,
    is_significant: true,
    reason: `Complaint theme "${top.label}" is rising for ${ctx.competitorName} over the review time-series`,
    humanChangeBefore: null,
    humanChangeAfter: top.label,
  };

  return {
    emission: {
      diffText,
      classification,
      risingLabels: rising.map((r) => r.label),
      risingKeys: rising.map((r) => r.key).sort(),
    },
    shouldFlagBattleCards: true,
  };
}

// ── Aggregate-score inflection (Reviews v2) ──────────────────────────────────────
// Surface-only review sources (Trustpilot public) carry a score + count but NO
// verbatims, so the theme detector above never fires for them. This detects a
// sustained DROP in the aggregate score over the same sliding window — the "score of
// X slips 4.4 → 4.2" signal the Mining-reviews card wanted — and packages it as the
// SAME emission shape so the job's snapshot→change→signal chain is reused verbatim.

export interface ScoreSeriesRow {
  source: string;
  score: number;
  reviewCount: number;
  recordedAt: Date;
}

export interface ScoreDrop {
  recentAvg: number;
  baselineAvg: number;
  /** baselineAvg − recentAvg (positive = a drop). */
  delta: number;
  sources: string[];
  recentDates: Date[];
  latestScore: number;
  latestReviewCount: number;
}

export interface ScoreDropOptions {
  now?: Date;
  windowDays?: number;
  lookbackDays?: number;
  /** Minimum baseline−recent drop (in score points) to flag. Default 0.2. */
  dropThreshold?: number;
  /** Minimum recent-window points required. Default 2. */
  minRecentPoints?: number;
}

const SCORE_DEFAULTS = { windowDays: 42, lookbackDays: 84, dropThreshold: 0.2, minRecentPoints: 2 };

/**
 * A sustained drop in the aggregate review score from the baseline window to the
 * recent window. Returns null when the drop is below threshold or the recent window
 * is too thin to be meaningful. Input is oldest-first (getReviewScoreSeries order).
 */
export function detectScoreDrop(rows: ScoreSeriesRow[], opts: ScoreDropOptions = {}): ScoreDrop | null {
  const now = opts.now ?? new Date();
  const windowDays = opts.windowDays ?? SCORE_DEFAULTS.windowDays;
  const lookbackDays = opts.lookbackDays ?? SCORE_DEFAULTS.lookbackDays;
  const dropThreshold = opts.dropThreshold ?? SCORE_DEFAULTS.dropThreshold;
  const minRecentPoints = opts.minRecentPoints ?? SCORE_DEFAULTS.minRecentPoints;

  const recentStart = now.getTime() - windowDays * 86_400_000;
  const lookbackStart = now.getTime() - lookbackDays * 86_400_000;

  const recent: ScoreSeriesRow[] = [];
  const baseline: ScoreSeriesRow[] = [];
  for (const r of rows) {
    const t = r.recordedAt.getTime();
    if (t >= recentStart && t <= now.getTime()) recent.push(r);
    else if (t >= lookbackStart && t < recentStart) baseline.push(r);
  }
  if (recent.length < minRecentPoints || baseline.length === 0) return null;

  const avg = (xs: ScoreSeriesRow[]): number => xs.reduce((s, r) => s + r.score, 0) / xs.length;
  const recentAvg = avg(recent);
  const baselineAvg = avg(baseline);
  const delta = baselineAvg - recentAvg;
  if (delta < dropThreshold) return null;

  const latest = recent[recent.length - 1]!; // oldest-first input → last is latest
  return {
    recentAvg,
    baselineAvg,
    delta,
    sources: [...new Set(recent.map((r) => r.source))].sort(),
    recentDates: recent.map((r) => r.recordedAt).sort((a, b) => a.getTime() - b.getTime()),
    latestScore: latest.score,
    latestReviewCount: latest.reviewCount,
  };
}

// Score drift is opinion movement, not a paged-outage event: cap at "high".
function severityForScoreDrop(drop: ScoreDrop): "low" | "medium" | "high" {
  if (drop.delta >= 0.5) return "high";
  if (drop.delta >= 0.3) return "medium";
  return "low";
}

/**
 * Package a score drop into the SAME emission shape as a theme shift so the job emits
 * it through one code path. The dedup key is rounded to 1 decimal, so a continued
 * slide within the same rounded band won't re-emit but a further drop will.
 */
export function planScoreDropEmission(
  drop: ScoreDrop | null,
  ctx: { competitorName: string; windowDays: number },
): { emission: ThemeShiftEmission | null; shouldFlagBattleCards: boolean } {
  if (!drop) return { emission: null, shouldFlagBattleCards: false };

  const severity = severityForScoreDrop(drop);
  const before = drop.baselineAvg.toFixed(1);
  const after = drop.recentAvg.toFixed(1);
  const dates = drop.recentDates.map(isoDate).join(", ");

  const diffText =
    `The aggregate customer rating for ${ctx.competitorName} is sliding across its ` +
    `review sources (${drop.sources.join("/")}): average score ${before} → ${after} over ` +
    `the last ${ctx.windowDays} days (latest ${drop.latestScore.toFixed(1)}/5 on ` +
    `${drop.latestReviewCount} reviews). Recent captures: ${dates || "n/a"}.`;

  const classification: Classification = {
    category: "reviews",
    severity,
    is_significant: true,
    reason: `Aggregate review score for ${ctx.competitorName} dropped ${before} → ${after} over the review time-series`,
    humanChangeBefore: `${before}/5`,
    humanChangeAfter: `${after}/5`,
  };

  return {
    emission: {
      diffText,
      classification,
      risingLabels: [`score ${before} → ${after}`],
      risingKeys: [`score-drop:${before}->${after}`],
    },
    shouldFlagBattleCards: true,
  };
}

// ── Battle-card objection injection ──────────────────────────────────────────────

export interface ObjectionContext {
  competitorName: string;
  myProductName?: string;
  valueProp?: string;
}

/**
 * Deterministically fold rising complaint themes into the card's common_objections
 * (objection = the rising complaint as a talking point, response = product angle).
 * Runs AFTER the AI generate/revise passes so the fact-checker can't strip it, and
 * is capped at the schema max (5) with the injected themes taking precedence. Skips a
 * theme the AI already raised. Generic over WithQuality<BattleCardContent> so the
 * quality envelope carries through.
 */
export function mergeRisingThemeObjections<T extends BattleCardContent>(
  content: T,
  rising: RisingTheme[],
  ctx: ObjectionContext,
): T {
  if (rising.length === 0) return content;

  const existingText = content.common_objections
    .map((o) => o.objection.toLowerCase())
    .join(" | ");

  const additions: Array<{ objection: string; response: string }> = [];
  for (const r of rising) {
    if (existingText.includes(r.label.toLowerCase())) continue;
    const sources = r.sources.length ? ` (${r.sources.join("/")} reviews)` : "";
    const objection =
      `Prospects increasingly cite "${r.label}" as a growing complaint about ` +
      `${ctx.competitorName}${sources}.`;
    const angle = ctx.valueProp
      ? `${ctx.myProductName ?? "Our product"} — ${ctx.valueProp}`
      : ctx.myProductName ?? "Our product";
    const response =
      `Use it as a wedge: contrast with ${angle}, and ask how ${ctx.competitorName} ` +
      `handles "${r.label}".`;
    additions.push({ objection, response });
  }

  if (additions.length === 0) return content;

  // Injected themes first (fresh, actionable munition), then the existing ones; cap 5.
  const merged = [...additions, ...content.common_objections].slice(0, 5);
  return { ...content, common_objections: merged };
}
