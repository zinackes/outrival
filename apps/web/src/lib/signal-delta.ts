/**
 * Numeric before/after extraction for the signal detail's change ledger.
 *
 * A signal's `humanChangeBefore` / `humanChangeAfter` are prose ("Pro plan — $16
 * per seat, billed monthly"). When both sides carry the SAME kind of figure, the
 * detail renders it as a typeset delta ($16.00 → $14.00, −12.5%) instead of two
 * paragraphs. Everything here is pure so the heuristic can be pinned by tests —
 * a wrong pairing would state a price change that never happened.
 */

export interface DeltaValue {
  /** The matched token, as written on the page ("$16.00", "4.6", "18%"). */
  raw: string;
  value: number;
  /** Normalized currency ("$", "EUR", …), or null for a bare number. */
  currency: string | null;
  isPercent: boolean;
}

export interface ParsedDelta {
  before: DeltaValue;
  after: DeltaValue;
  direction: "up" | "down";
  /** Signed percentage change, or null when the baseline is 0 (undefined ratio). */
  deltaPct: number | null;
}

// currency symbol or ISO code · number (thousands separators, optional decimals) ·
// optional percent. The first match in the string wins — the figure a human reads
// first is the one the sentence is about. The leading lookbehind keeps digits
// welded to a word out of it, so "G2 rating 4.6" reads 4.6, not the 2 in "G2".
const FIGURE =
  /(?<![A-Za-z0-9])(?:(?<sym>[$€£¥])|\b(?<code>USD|EUR|GBP|CHF|CAD|AUD|JPY)\b)?\s*(?<num>\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*(?<pct>%)?/;

// Words too short or too common to say anything about whether two sentences
// describe the same thing.
const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "by",
  "for",
  "from",
  "in",
  "is",
  "of",
  "on",
  "or",
  "per",
  "the",
  "to",
  "was",
  "with",
]);

// How much of the non-numeric wording the two sides must share before we call
// them the same fact. Guards against "4 new sales roles" → "2 Enterprise AEs",
// which is two different figures, not one that moved.
const MIN_CONTEXT_SIMILARITY = 0.6;

function extractFigure(text: string): DeltaValue | null {
  const m = FIGURE.exec(text);
  if (!m?.groups) return null;
  const { sym, code, num, pct } = m.groups;
  if (!num) return null;
  const value = Number(num.replace(/,/g, ""));
  if (!Number.isFinite(value)) return null;
  return {
    raw: m[0].trim(),
    value,
    currency: sym ?? code?.toUpperCase() ?? null,
    isPercent: Boolean(pct),
  };
}

/** Meaningful words left once every figure and currency marker is removed. */
function contextTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[$€£¥]|\b(?:usd|eur|gbp|chf|cad|aud|jpy)\b/g, " ")
      .replace(/\d[\d,.]*%?/g, " ")
      .split(/[^a-z]+/)
      .filter((w) => w.length > 1 && !STOPWORDS.has(w)),
  );
}

function similarity(a: Set<string>, b: Set<string>): number {
  // One side carries no wording at all (a bare "$16.00") — there's nothing to
  // contradict, so the pair stands on the figures alone.
  if (a.size === 0 || b.size === 0) return 1;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / (a.size + b.size - shared);
}

/**
 * Pair the leading figure of `before` with the leading figure of `after`, or
 * return null so the caller falls back to rendering the two sentences.
 */
export function parseDelta(
  before: string | null | undefined,
  after: string | null | undefined,
): ParsedDelta | null {
  if (!before || !after) return null;
  const b = extractFigure(before);
  const a = extractFigure(after);
  if (!b || !a) return null;
  // Different units measure different things — a price and a percentage never
  // form a delta, however close the wording.
  if (b.currency !== a.currency || b.isPercent !== a.isPercent) return null;
  if (b.value === a.value) return null;
  if (similarity(contextTokens(before), contextTokens(after)) < MIN_CONTEXT_SIMILARITY)
    return null;
  return {
    before: b,
    after: a,
    direction: a.value > b.value ? "up" : "down",
    deltaPct: b.value === 0 ? null : ((a.value - b.value) / b.value) * 100,
  };
}

/** "−12.5%" / "+50%" — signed, at most one decimal, no trailing zero. */
export function formatDeltaPct(pct: number): string {
  const rounded = Math.round(pct * 10) / 10;
  const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "";
  return `${sign}${Math.abs(rounded)}%`;
}
