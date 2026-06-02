// Citation extraction + grounding validation (patch-24, layer 1).
//
// The model is asked to back each factual assertion with an exact quote from the
// source text. We verify those quotes actually exist in the source. The match is
// fuzzy (Levenshtein ratio) because a model paraphrases or re-spaces slightly even
// when it isn't hallucinating. Grounding INFORMS, it never rejects: a failed
// citation is recorded, never used to drop the output.

export interface Citation {
  /** What the model asserts. */
  assertion: string;
  /** The exact passage it claims to quote from the source. */
  sourceQuote: string;
  /** Where the quote was located in the (normalized) source, when matched. */
  position?: { start: number; end: number };
}

export interface GroundingValidation {
  /** No citation failed (vacuously true when there are no citations). */
  passed: boolean;
  /** Ratio of valid citations, 0-1 (1 when there are no citations). */
  score: number;
  failedCitations: Citation[];
  validCitations: Citation[];
}

const DEFAULT_THRESHOLD = 0.85;
// Bound the DP work: source texts can be 50KB diffs, quotes occasionally long.
const MAX_SOURCE_SCAN = 40_000;
const MAX_NEEDLE = 240;
// Below this length a fuzzy ratio is noise — require an exact normalized inclusion.
const MIN_FUZZY_LEN = 12;

function threshold(): number {
  const raw = Number(process.env.GROUNDING_FUZZY_MATCH_THRESHOLD);
  return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : DEFAULT_THRESHOLD;
}

/**
 * Validate that each citation's sourceQuote really occurs in sourceText.
 * Exact normalized inclusion first; otherwise a sliding-window Levenshtein ratio
 * compared against the configured threshold (default 0.85).
 */
export function validateCitations(
  citations: Citation[],
  sourceText: string,
): GroundingValidation {
  const t = threshold();
  const failed: Citation[] = [];
  const valid: Citation[] = [];
  const normalizedSource = normalizeText(sourceText).slice(0, MAX_SOURCE_SCAN);

  for (const citation of citations) {
    const normalizedQuote = normalizeText(citation.sourceQuote);
    if (!normalizedQuote) {
      failed.push(citation);
      continue;
    }

    const exactAt = normalizedSource.indexOf(normalizedQuote);
    if (exactAt >= 0) {
      valid.push({
        ...citation,
        position: { start: exactAt, end: exactAt + normalizedQuote.length },
      });
      continue;
    }

    // Short quotes don't survive a fuzzy ratio meaningfully — demand exactness.
    if (normalizedQuote.length < MIN_FUZZY_LEN) {
      failed.push(citation);
      continue;
    }

    const needle = normalizedQuote.slice(0, MAX_NEEDLE);
    const best = findBestFuzzyMatch(needle, normalizedSource);
    if (best.similarity >= t) {
      valid.push({ ...citation, position: best.position });
    } else {
      failed.push(citation);
    }
  }

  const total = citations.length;
  const score = total > 0 ? valid.length / total : 1;
  return { passed: failed.length === 0, score, failedCitations: failed, validCitations: valid };
}

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[“”„‟"]/g, '"')
    .replace(/[‘’‚‛']/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Best approximate-substring match of `needle` inside `haystack`. Uses a
 * Levenshtein DP whose first row is all-zero (the needle may begin at any offset)
 * and whose answer is the min of the last row (it may end at any offset) — so
 * leading/trailing haystack text is free and never penalises the match. Returns a
 * similarity in [0,1] (1 - editDistance / needleLen) plus the end-anchored span.
 */
export function findBestFuzzyMatch(
  needle: string,
  haystack: string,
): { similarity: number; position: { start: number; end: number } } {
  const m = needle.length;
  const n = haystack.length;
  if (m === 0 || n === 0) return { similarity: 0, position: { start: 0, end: 0 } };

  let prev = new Array<number>(n + 1).fill(0); // empty needle prefix: 0 everywhere
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i; // matching i needle chars against empty haystack prefix
    const ci = needle.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = ci === haystack.charCodeAt(j - 1) ? 0 : 1;
      const del = (prev[j] ?? 0) + 1;
      const ins = (curr[j - 1] ?? 0) + 1;
      const sub = (prev[j - 1] ?? 0) + cost;
      curr[j] = Math.min(del, ins, sub);
    }
    const swap = prev;
    prev = curr;
    curr = swap;
  }

  // prev is now the last row: best end position is its argmin.
  let bestDist = m;
  let bestEnd = 0;
  for (let j = 0; j <= n; j++) {
    const d = prev[j] ?? m;
    if (d < bestDist) {
      bestDist = d;
      bestEnd = j;
    }
  }

  const similarity = 1 - bestDist / m;
  return {
    similarity,
    position: { start: Math.max(0, bestEnd - m), end: bestEnd },
  };
}

/** Normalized Levenshtein similarity in [0,1]: 1 - distance / max(len). */
export function computeSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const distance = levenshtein(a, b);
  return 1 - distance / Math.max(a.length, b.length);
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = ai === b.charCodeAt(j - 1) ? 0 : 1;
      const del = (prev[j] ?? 0) + 1;
      const ins = (curr[j - 1] ?? 0) + 1;
      const sub = (prev[j - 1] ?? 0) + cost;
      curr[j] = Math.min(del, ins, sub);
    }
    const swap = prev;
    prev = curr;
    curr = swap;
  }
  return prev[n] ?? 0;
}
