/**
 * R1 — per-capture completeness score (Véracité Intelligence v2, P1).
 *
 * The 2026-07 reliability audit's root cause: capture success is binary. A
 * degraded render that clears the cascade's absolute floors is stored as full
 * "success", becomes the diff baseline, and fabricates a phantom "everything
 * changed" on recovery. This module grades the middle band the cascade lets
 * through and returns a SCORE plus the reasons behind it, so the worker can
 * store `partial` and the whole pipeline can refuse to trust that capture.
 *
 * PURE: numbers and strings in, a verdict out. No DB, no network, no browser —
 * same contract as anti-void.ts and deny-page.ts, and for the same reason: it
 * runs on every capture (including archived Wayback HTML) and must stay cheap.
 *
 * Scoring is subtractive on purpose: a healthy capture starts at 1.0 and each
 * failed check removes a NAMED penalty, so a score is always readable back as
 * "which checks failed" rather than as an opaque weighting. `reasons` carries
 * exactly that list.
 *
 * Asymmetric-cost note (same as deny-page.ts): a false partial silences a
 * monitor's diffs AND its extraction on every scrape, visible only in a log
 * line. Every threshold below is therefore set so that "we cannot tell" grades
 * COMPLETE, and only positive evidence of degradation subtracts.
 */

export type CompletenessReason =
  /** The element that DEFINES this source is absent (no price on a pricing page…). */
  | "no_anchor"
  /** Far under what this monitor usually serves — a shell, not the page. */
  | "below_median_band"
  /** 100-600 chars: above the collapse floor, below anything that is a real page. */
  | "dead_band"
  /** A 4xx/5xx body captured as if it were content. */
  | "http_error"
  /** The cascade served below the render level this monitor is known to need. */
  | "under_rendered";

export interface CompletenessInput {
  /** Char length of the extracted visible content of THIS capture. */
  textLength: number;
  /** Median of this monitor's recent COMPLETE captures. 0 = unknown/not trusted. */
  historicalMedian: number;
  /** Monitor source type — selects the expected anchors (see EXPECTED_ANCHORS). */
  sourceType: string;
  /** How many source-defining anchors this capture carries (countCaptureAnchors). */
  anchorsFound: number;
  /** HTTP status the capture was served with. 0 = unknown (synthetic/api docs). */
  httpStatus: number;
  /** Cascade level that actually served this capture (0 fetch · 1 render · 2 egress). */
  renderLevelReached: number;
  /** Level this monitor has learned it needs. 0 when nothing was learned. */
  renderLevelExpected: number;
}

export interface CompletenessScore {
  /** 0 (nothing usable) → 1 (every check passed). */
  score: number;
  reasons: CompletenessReason[];
}

// --- Thresholds. Named and commented because every one of them is a product
// decision about when we are willing to call a capture untrustworthy. ---

/** Below this score the capture is stored `partial`. */
export const PARTIAL_SCORE_THRESHOLD = 0.6;

/** Content under this fraction of the monitor's median reads as a degraded render. */
export const MEDIAN_RATIO_FLOOR = 0.5;

/**
 * The dead band the audit named (T2): 100-600 chars is above `isContentCollapsed`'s
 * absolute floor and below any page that carries real content, so the cascade
 * accepts it. Only applied when the monitor is NOT normally this small — a source
 * whose own median sits inside the band genuinely serves a tiny page.
 */
export const DEAD_BAND_MIN = 100;
export const DEAD_BAND_MAX = 600;

/**
 * How many source-defining anchors a healthy capture must carry. A source absent
 * from this map is NOT anchor-checked: its shape is too varied to assert anything
 * without inventing false partials (a changelog with nothing new, a quiet news
 * feed, a sitemap). Adding a source here is a deliberate act, not a default.
 */
export const EXPECTED_ANCHORS: Readonly<Record<string, number>> = {
  // ≥1 amount OR a pricing-model indicator ("per seat", "contact sales").
  pricing: 1,
  // ≥1 posting marker OR an explicit "no open roles" statement.
  jobs: 1,
  // ≥1 heading — the hero/section skeleton the structure parser reads.
  homepage: 1,
};

/** Subtracted from 1.0 per failed check. Sums are clamped into [0, 1]. */
const PENALTY: Readonly<Record<CompletenessReason, number>> = {
  // An HTTP error body is not a degraded capture, it is not the page at all.
  http_error: 1,
  no_anchor: 0.5,
  dead_band: 0.5,
  below_median_band: 0.4,
  under_rendered: 0.3,
};

export function computeCompleteness(input: CompletenessInput): CompletenessScore {
  const reasons: CompletenessReason[] = [];

  // A 4xx/5xx served as content is the whole verdict on its own. 0 = unknown
  // (synthesized documents, api-capture) and never penalised.
  if (input.httpStatus >= 400) reasons.push("http_error");

  const expected = EXPECTED_ANCHORS[input.sourceType];
  if (expected !== undefined && input.anchorsFound < expected) reasons.push("no_anchor");

  // Dead band — skipped when this monitor's own median sits inside it (a source
  // that is legitimately this small), and when there is a median saying the page
  // is normally larger the below-median check below carries the same evidence.
  const medianKnown = input.historicalMedian > 0;
  const normallyLarger = !medianKnown || input.historicalMedian > DEAD_BAND_MAX;
  if (
    normallyLarger &&
    input.textLength >= DEAD_BAND_MIN &&
    input.textLength <= DEAD_BAND_MAX
  ) {
    reasons.push("dead_band");
  }

  if (medianKnown && input.textLength / input.historicalMedian < MEDIAN_RATIO_FLOOR) {
    reasons.push("below_median_band");
  }

  // The cascade starts at the learned level, so a lower level means it served a
  // cheaper result than this monitor is known to need — a stale cache or a
  // short-circuit, not the page we learned to fetch.
  if (input.renderLevelExpected > 0 && input.renderLevelReached < input.renderLevelExpected) {
    reasons.push("under_rendered");
  }

  const penalty = reasons.reduce((sum, r) => sum + PENALTY[r], 0);
  const score = Math.max(0, Math.min(1, 1 - penalty));
  return { score, reasons };
}

/** True when this score means the capture must be stored `partial`. */
export function isPartialScore(score: number): boolean {
  return score < PARTIAL_SCORE_THRESHOLD;
}

// --- Anchor counting ---
//
// Deliberately self-contained regexes rather than a call into the pricing/jobs
// parsers: this runs on EVERY capture before any extractor is chosen, and the
// only question is "does this page carry the thing that defines this source",
// not "what exactly does it say". Lenient by construction — a missed anchor
// costs a false partial, an over-counted one costs nothing (the other checks
// still grade the capture).

const PRICE_TOKEN_RE =
  /([€$£¥₹]\s?\d)|(\d\s?[€$£¥₹])|\b(usd|eur|gbp|chf|cad|aud|sek|nok|dkk|pln|brl|inr|jpy)\s?\d/i;
const PRICING_MODEL_RE =
  /\b(per (user|seat|member|month|year|agent)|usage[- ]based|contact (us for pricing|sales)|custom pricing|talk to sales|request a quote|free (plan|tier|forever)|billed (monthly|annually|yearly))\b/i;

const JOB_POSTING_RE =
  /\b(apply now|view (job|role|position)|open (positions|roles)|job description|full[- ]time|part[- ]time)\b|href=["'][^"']*\/(jobs?|careers?|openings?)\//i;
const JOBS_EMPTY_STATE_RE =
  /\b(no (current |open )?(openings|positions|vacancies|roles)|not (currently )?hiring|there are no open|check back (later|soon))\b/i;

const HEADING_RE = /<h[12]\b[^>]*>[\s\S]*?<\/h[12]>|role=["']heading["']/i;

function visibleText(html: string): string {
  return html
    .replace(/<(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * How many source-defining anchors this capture carries, as
 * `computeCompleteness` expects it. Returns 0 for sources that are not
 * anchor-checked, so a caller can pass the result unconditionally.
 */
export function countCaptureAnchors(html: string, sourceType: string): number {
  if (EXPECTED_ANCHORS[sourceType] === undefined) return 0;
  const text = visibleText(html);
  switch (sourceType) {
    case "pricing":
      return PRICE_TOKEN_RE.test(text) || PRICING_MODEL_RE.test(text) ? 1 : 0;
    case "jobs":
      // The empty state is an ANSWER, not a missing anchor: a competitor with no
      // open roles must grade complete, otherwise "they stopped hiring" is
      // undetectable forever (audit §1.3).
      return JOB_POSTING_RE.test(html) || JOBS_EMPTY_STATE_RE.test(text) ? 1 : 0;
    case "homepage":
      return HEADING_RE.test(html) ? 1 : 0;
    default:
      return 0;
  }
}
