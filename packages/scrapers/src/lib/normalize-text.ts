// Animated "counter" widgets (odometer.js and other rolling / slot-machine number
// tickers) render each digit position as a vertical strip of glyphs 0-9 and clip
// it to the target digit with `overflow: hidden`. Neither `innerText` (which does
// not honor overflow clipping) nor cheerio `.text()` / `textContent` respect that
// clip, so extracting a competitor's animated "50K+" hero stat yields garbage like
// "012345678901234567 89K+". That noise pollutes the lexical diff, numeric-claim
// extraction, AI classification and the homepage-structure hero fields shown in the
// app (overview).
//
// The real value is unrecoverable from text: the DOM strip is always 0-9 regardless
// of the displayed digit — the shown glyph lives only in a CSS transform. So we
// can't reconstruct "50"; we strip the strips instead, dropping any digit ramp that
// carries the odometer signature and leaving the surrounding copy untouched.

// A run of digits, tolerant of the separators an odometer emits *between* its
// per-digit ribbons: thousands/decimal marks ("," ".") and the line breaks a
// block-level ribbon produces in innerText. A regular space is intentionally NOT a
// separator — that protects real space-separated sequences (rating/NPS scales,
// "0 1 2 3 … 10") from being mistaken for a ribbon.
const RAMP_RE = /(?:\d[.,\n\r\f]?){10,}/g;

// Fraction of adjacent digit pairs that step by `step` mod 10 (1 = ascending ramp,
// 9 = descending ramp — odometers animate both directions).
function sequentialRatio(digits: string, step: 1 | 9): number {
  if (digits.length < 2) return 0;
  let hits = 0;
  for (let i = 1; i < digits.length; i++) {
    const prev = digits.charCodeAt(i - 1) - 48;
    const cur = digits.charCodeAt(i) - 48;
    if ((prev + step) % 10 === cur) hits++;
  }
  return hits / (digits.length - 1);
}

// True only for the odometer-ribbon signature: at least a full cycle of digits,
// every glyph 0-9 present, and ≥80% of adjacent pairs stepping sequentially mod 10.
// Real formatted numbers (prices, dates, counts, IDs) fail the "all ten digits +
// sequential" test; only ribbons (and keyboard-mash placeholders, equally junk) pass.
function isOdometerRamp(run: string): boolean {
  const digits = run.replace(/\D/g, "");
  if (digits.length < 10) return false;
  for (let d = 0; d <= 9; d++) {
    if (!digits.includes(String(d))) return false;
  }
  return Math.max(sequentialRatio(digits, 1), sequentialRatio(digits, 9)) >= 0.8;
}

/**
 * Remove animated-counter digit ramps from extracted page text. Pure and
 * deterministic — same input, same output. Cheap: the scan only does real work when
 * the text actually contains a long digit run.
 */
export function collapseAnimatedCounters(text: string): string {
  if (!text || text.length < 10 || !/\d/.test(text)) return text;
  return text.replace(RAMP_RE, (m) => (isOdometerRamp(m) ? "" : m));
}
