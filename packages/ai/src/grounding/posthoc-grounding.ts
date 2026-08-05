// Deterministic post-hoc grounding check (Véracité Intelligence v2 P3, audit R3).
//
// The free reasoning providers' most damaging hallucination in user-facing prose is
// an invented FIGURE — a price, a percentage, a count, a rating — or a quotation the
// page never printed. This module finds those in a generated OUTPUT and checks each
// one against the SOURCE the model was shown. It is PURE and costs ZERO tokens: it
// replaces the self-citation envelope, which is what broke the free providers
// (a reasoning model malforms the citation JSON → parse miss → empty output), with
// arithmetic we can run ourselves after the same single call.
//
// It grew out of `numeric-grounding.ts` (R3's first half) and replaces it: same
// conservative significance rule, plus currency/locale normalisation, a suffix
// table, quoted spans, and per-field attribution so the caller can drop exactly the
// sentence that carries an unsupported figure.
//
// WHAT IS CHECKED (v1 perimeter, deliberate):
//  - amounts (a figure carrying a currency symbol or ISO code),
//  - percentages,
//  - other significant numbers,
//  - spans the output puts between quotes.
// PROPER NOUNS ARE NOT CHECKED. A competitor, product or person name is paraphrased,
// possessive-inflected and case-folded far too freely for a literal-presence test:
// v1 would have flagged mostly true sentences. That is a v2 question.
//
// WHAT COUNTS AS SIGNIFICANT (the false-positive rule, ported verbatim from R3):
//  - a bare single digit is skipped: "2 plans", "one or two sentences" are ubiquitous
//    and low-risk, and demanding an isolated "2" in the source flags honest prose;
//  - a bare 4-digit year (19xx/20xx, no currency, no unit) is skipped — legit context;
//  - everything else with a currency, a %, a x/k/M suffix, a decimal, or two or more
//    digits IS checked.
//
// HOW A MATCH IS DECIDED. Each figure is reduced to ONE canonical numeric value under
// the locale convention its own shape declares ("1,299" is en grouping, "1.299" is
// de/fr grouping, "1 299" is space grouping, "12,34" is a decimal comma), plus the
// value its k/M/bn suffix expands to. The source is reduced the same way, and the
// figure is verified when the two sets intersect. Ambiguity is never resolved in the
// output's favour: we do not invent an equivalence to rescue a figure (1.3 is never
// read as 1300 unless a suffix says so), and a value the model DERIVED — a % computed
// from two source prices — has no literal support and is reported unverified. That is
// the intended posture: the caller abstains from the sentence rather than publishing
// a figure the source cannot back.
//
// The match is on the numeric VALUE, not the unit: an output "32%" is supported by a
// source that prints "32" anywhere. Deliberately loose on that axis — the check is
// about fabrication, not about semantics, and a unit-aware test on prose produces
// false alarms the abstention would pay for in deleted insights.

import { normalizeText } from "./citations";

export type TokenKind = "amount" | "percentage" | "number" | "quoted";

export interface VerifiableToken {
  kind: TokenKind;
  /** Verbatim, as the output wrote it ("$1,299", "32%", "we cut latency by half"). */
  text: string;
  /** Which output field it came from, when the caller checked field by field. */
  field?: string;
}

export interface VerifiableTokens {
  amounts: VerifiableToken[];
  percentages: VerifiableToken[];
  numbers: VerifiableToken[];
  quotedSpans: VerifiableToken[];
}

export interface VerificationResult {
  /** No checked token is missing from the source (vacuously true when none were). */
  verified: boolean;
  unverified: VerifiableToken[];
  /** How many tokens were actually checked — 0 means "nothing to check", not "clean". */
  checked: number;
}

// Thousands separators a page can print, including the ones a browser copy-paste
// leaves behind: NBSP (U+00A0), narrow NBSP (U+202F), thin space (U+2009).
const UNICODE_SPACES = /[   ]/g;

const CURRENCY_SYMBOL = "[$€£¥₹]";
const CURRENCY_CODE = "(?:USD|EUR|GBP|CAD|AUD|CHF|JPY|INR)";
// A grouped figure needs at least one full 3-digit group, so "3 plans and 4 add-ons"
// can never be read as the number 3004.
const GROUPED = String.raw`\d{1,3}(?:[ ,.]\d{3})+(?:[.,]\d{1,2})?`;
const PLAIN = String.raw`\d+(?:[.,]\d+)?`;
const NUMBER_RE = new RegExp(
  String.raw`(${CURRENCY_SYMBOL}|\b${CURRENCY_CODE}\s?)?\s?(${GROUPED}|${PLAIN})\s?(%|k\b|K\b|M\b|bn\b|[x×]\b)?\s?(${CURRENCY_SYMBOL}|\b${CURRENCY_CODE}\b)?`,
  "g",
);

// The explicit magnitude table. Only these three suffixes expand — nothing is
// inferred from context, so "10k" is checked against both 10 and 10000 and nothing
// else is quietly rescaled.
const SUFFIX_MULTIPLIER: Record<string, number> = {
  k: 1000,
  K: 1000,
  M: 1_000_000,
  bn: 1_000_000_000,
};

// Unambiguous grouping shapes. Anything else with a single separator is read as a
// decimal, which is the only reading a 1-or-2-digit tail can have.
const THOUSANDS_COMMA = /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/;
const THOUSANDS_DOT = /^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/;

/**
 * A quoted span shorter than this is a LABEL ("Pro", "SSO"), not a claim. Checking
 * those buys nothing — a plan name is in the source or the whole sentence is wrong
 * anyway — while a translated or possessive-inflected label would flag honest prose.
 */
const MIN_QUOTED_CHARS = 8;
/** Bound the work on a 50KB diff; a quote past this is prose, not a citation. */
const MAX_QUOTED_CHARS = 200;

/** The one value a figure has under the convention its own shape declares. */
function readNumber(raw: string): number | null {
  const s = raw.replace(/\s/g, "");
  if (!/\d/.test(s)) return null;
  if (THOUSANDS_COMMA.test(s)) return finite(Number(s.replace(/,/g, "")));
  if (THOUSANDS_DOT.test(s)) return finite(Number(s.replace(/\./g, "").replace(",", ".")));
  if (/^\d+,\d+$/.test(s)) return finite(Number(s.replace(",", ".")));
  return finite(Number(s));
}

function finite(n: number): number | null {
  return Number.isFinite(n) ? n : null;
}

/** Canonical string of a value, so 1299 and 1299.0 are the same key. */
function key(n: number): string {
  return String(Math.round(n * 10_000) / 10_000);
}

/** Every value a figure can stand for: its own, plus its suffix expansion. */
function valuesOf(raw: string, suffix: string | null): string[] {
  const n = readNumber(raw);
  if (n === null) return [];
  const out = [key(n)];
  const multiplier = suffix ? SUFFIX_MULTIPLIER[suffix] : undefined;
  if (multiplier) out.push(key(n * multiplier));
  return out;
}

interface RawNumber {
  /** The whole match, trimmed — what the reader would see quoted back at them. */
  text: string;
  currency: string | null;
  core: string;
  suffix: string | null;
}

function scanNumbers(text: string): RawNumber[] {
  const normalized = text.replace(UNICODE_SPACES, " ");
  const out: RawNumber[] = [];
  for (const m of normalized.matchAll(NUMBER_RE)) {
    const core = m[2];
    if (!core) continue;
    out.push({
      text: m[0].trim(),
      currency: (m[1] ?? m[4] ?? null)?.trim() || null,
      core,
      suffix: m[3] ?? null,
    });
  }
  return out;
}

/**
 * Whether a figure is worth grounding. See the module doc — this is the rule that
 * keeps "2 plans" out of the check and therefore keeps honest prose publishable.
 */
function isSignificant(n: RawNumber): boolean {
  const bareYear = !n.currency && !n.suffix && /^(?:19|20)\d{2}$/.test(n.core);
  if (bareYear) return false;
  const digits = n.core.replace(/\D/g, "");
  return Boolean(n.currency) || Boolean(n.suffix) || /[.,]/.test(n.core) || digits.length >= 2;
}

function kindOf(n: RawNumber): TokenKind {
  if (n.currency) return "amount";
  if (n.suffix === "%") return "percentage";
  return "number";
}

/** Every quoted span in a text, as the output wrote it (quotes stripped). */
function scanQuotes(text: string): string[] {
  const out: string[] = [];
  const re = /"([^"\n]+)"|“([^”\n]+)”|«\s?([^»\n]+?)\s?»/g;
  for (const m of text.matchAll(re)) {
    const span = (m[1] ?? m[2] ?? m[3] ?? "").trim();
    if (span.length < MIN_QUOTED_CHARS || span.length > MAX_QUOTED_CHARS) continue;
    if (!/[a-z0-9]/i.test(span)) continue;
    out.push(span);
  }
  return out;
}

/** The verifiable tokens of a generated output, grouped by kind. */
export function extractVerifiableTokens(output: string): VerifiableTokens {
  const tokens: VerifiableTokens = {
    amounts: [],
    percentages: [],
    numbers: [],
    quotedSpans: [],
  };
  for (const n of scanNumbers(output)) {
    if (!isSignificant(n)) continue;
    const token: VerifiableToken = { kind: kindOf(n), text: n.text };
    if (token.kind === "amount") tokens.amounts.push(token);
    else if (token.kind === "percentage") tokens.percentages.push(token);
    else tokens.numbers.push(token);
  }
  for (const span of scanQuotes(output)) {
    tokens.quotedSpans.push({ kind: "quoted", text: span });
  }
  return tokens;
}

/** Every value the source states, under the same reading rules as the output. */
function sourceValues(source: string): Set<string> {
  const values = new Set<string>();
  for (const n of scanNumbers(source)) {
    for (const v of valuesOf(n.core, n.suffix)) values.add(v);
  }
  return values;
}

/**
 * Check one generated text against the source it was written from.
 *
 * `verified: false` means at least one figure or quotation in the text is absent
 * from the source. The caller ABSTAINS from that text — it never regenerates it and
 * never publishes it with the figure in place.
 */
export function verifyAgainstSource(output: string, sourceText: string): VerificationResult {
  return verifyFieldsAgainstSource([{ field: "", text: output }], sourceText);
}

/**
 * The same check, field by field, so the caller can drop exactly the fields that
 * carry an unsupported figure instead of the whole generation. Each unverified token
 * is stamped with the field it was found in.
 */
export function verifyFieldsAgainstSource(
  fields: Array<{ field: string; text: string }>,
  sourceText: string,
): VerificationResult {
  const values = sourceValues(sourceText);
  const normalizedSource = normalizeText(sourceText);
  const unverified: VerifiableToken[] = [];
  // A sentence that repeats the same invented figure is one problem, not three.
  const seen = new Set<string>();
  let checked = 0;

  const report = (token: VerifiableToken) => {
    const dedupeKey = `${token.field ?? ""} ${token.kind} ${token.text}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    unverified.push(token);
  };

  for (const { field, text } of fields) {
    if (!text) continue;
    for (const n of scanNumbers(text)) {
      if (!isSignificant(n)) continue;
      checked++;
      const candidates = valuesOf(n.core, n.suffix);
      if (candidates.length > 0 && candidates.some((v) => values.has(v))) continue;
      report({ kind: kindOf(n), text: n.text, ...(field ? { field } : {}) });
    }
    for (const span of scanQuotes(text)) {
      checked++;
      if (normalizedSource.includes(normalizeText(span))) continue;
      report({ kind: "quoted", text: span, ...(field ? { field } : {}) });
    }
  }

  return { verified: unverified.length === 0, unverified, checked };
}
