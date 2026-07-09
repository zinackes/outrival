// Deterministic numeric-grounding check (R3). The free reasoning providers' most
// common — and most damaging — hallucination in user-facing prose is an invented
// statistic: a price, percentage, count, or rating that never appeared in the
// scraped source. This finds significant numbers in a generated OUTPUT that are
// absent from the SOURCE text, so the caller can regenerate or downgrade
// confidence WITHOUT relying on the model self-citing (the grounding envelope that
// breaks the free reasoning providers).
//
// Deliberately conservative to avoid false positives on legitimate prose:
//  - trivial small integers (1–9, "3 plans", "one or two sentences") are skipped —
//    ubiquitous and low-risk;
//  - bare 4-digit years (19xx/20xx with no unit) are skipped — often legit context;
//  - matching is on the normalised digit core (commas stripped), so "$1,299" in the
//    output is supported by "1299" / "$1,299" anywhere in the source.
// A legitimately DERIVED number (a % computed from two source prices) is rare and
// will be flagged — but the caller's action is non-destructive (keep + downgrade),
// never a silent drop.

const ANY_NUMBER = /\d[\d,]*(?:\.\d+)?/g;

/** The normalised digit cores of every number in a text (commas stripped). */
function coreSet(text: string): Set<string> {
  const s = new Set<string>();
  for (const m of text.match(ANY_NUMBER) ?? []) s.add(m.replace(/,/g, ""));
  return s;
}

/** Significant numbers in a generated output worth grounding (see module doc). */
export function significantNumbers(text: string): string[] {
  const re = /([$€£¥]\s?)?(\d[\d,]*(?:\.\d+)?)\s?(%|[x×])?/g;
  const out: string[] = [];
  for (const m of text.matchAll(re)) {
    const hasCurrency = Boolean(m[1]);
    const core = m[2]!.replace(/,/g, "");
    const hasUnit = Boolean(m[3]);
    const digits = core.replace(/\./g, "");
    const isYear = !hasCurrency && !hasUnit && /^(19|20)\d{2}$/.test(core);
    const significant =
      (hasCurrency || hasUnit || core.includes(".") || digits.length >= 2) && !isYear;
    if (significant) out.push(core);
  }
  return out;
}

/** Significant output numbers absent from the source, deduped (empty = grounded). */
export function unsupportedNumbers(output: string, source: string): string[] {
  const src = coreSet(source);
  const seen = new Set<string>();
  const bad: string[] = [];
  for (const c of significantNumbers(output)) {
    if (src.has(c) || seen.has(c)) continue;
    seen.add(c);
    bad.push(c);
  }
  return bad;
}
