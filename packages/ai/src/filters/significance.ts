export interface DiffInput {
  added: string;
  removed: string;
}

export interface SignificanceResult {
  worth: boolean;
  reason?: string;
}

/**
 * Sources whose entries carry a publication date that the page can refresh in
 * place. Everywhere else a date IS the fact — "Offer ends March 3" moving to
 * "March 10" on a pricing page is a real move — so the date-only rule below stays
 * off those sources.
 */
const DATED_ENTRY_SOURCES = new Set(["changelog", "news", "status", "blog"]);

const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*";

// Absolute (2026-06-01, 01/06/2026, "June 1, 2026", "1 June 2026"), clock times,
// and the relative forms a feed renders client-side ("2 days ago", "yesterday").
const DATE_SHAPES = new RegExp(
  [
    "\\d{4}-\\d{2}-\\d{2}(?:[t ]\\d{2}:\\d{2}(?::\\d{2})?(?:\\.\\d+)?z?)?",
    "\\d{1,2}[/.]\\d{1,2}[/.]\\d{2,4}",
    "\\d{2}:\\d{2}(?::\\d{2})?",
    `${MONTH}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?`,
    `\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH}\\.?(?:,?\\s+\\d{4})?`,
    "\\d+\\s+(?:second|minute|hour|day|week|month|year)s?\\s+ago",
    "(?:yesterday|today|just now)",
  ].join("|"),
  "gi",
);

/** One side of a diff with every date shape removed, normalized for comparison. */
function stripDates(side: string): string {
  return side.toLowerCase().replace(DATE_SHAPES, " ").replace(/\s+/g, " ").trim();
}

/**
 * Heuristics to skip trivial diffs before paying for a classification call.
 * Conservative by design: when in doubt it returns `worth: true` — better to
 * classify a borderline diff than to silently drop a real signal.
 */
export function evaluateSignificance(
  diff: DiffInput,
  context?: { sourceType?: string },
): SignificanceResult {
  const combined = `${diff.added}\n${diff.removed}`;
  const trimmed = combined.replace(/\s+/g, "");

  // 0. A pricing-page diff that contains an actual price token is ALWAYS worth
  // classifying, however short — "$99/mo → $79/mo" is the product's core promise
  // (audit DIF-7). Mirrors the price-token heuristic used by the severity guard.
  const PRICE_TOKEN = /[€$£¥]\s?\d|\d\s?(€|\$|usd|eur|gbp)|\/\s?(mo|month|yr|year|an)\b/i;
  if (context?.sourceType === "pricing" && PRICE_TOKEN.test(combined)) {
    return { worth: true };
  }

  // 1. Globally too short.
  if (trimmed.length < 50) {
    return { worth: false, reason: "too_short" };
  }

  // 2. Not enough significant characters (excluding digits, dates, punctuation).
  const significant = combined.replace(/[\s\d:/.\-,;()[\]{}_+@#'"]/g, "").length;
  if (significant < 30) {
    return { worth: false, reason: "no_significant_text" };
  }

  // 3. Only hashes / UUIDs / long ids.
  if (/^[a-f0-9-]{20,}$/i.test(trimmed)) {
    return { worth: false, reason: "looks_like_hash" };
  }

  // 4. Only timestamps / dates / times.
  if (/^[\d\s\-:T/.,Z+]+$/.test(combined)) {
    return { worth: false, reason: "timestamps_only" };
  }

  // 5. CSRF / nonce / random token (a single long random word, no spaces).
  if (/^[A-Za-z0-9+/=]{30,}$/.test(trimmed) && !combined.includes(" ")) {
    return { worth: false, reason: "looks_like_token" };
  }

  // 6. Both sides say the same thing and only a date moved. A changelog entry
  // whose published date is refreshed on a republish reaches here full of real
  // prose, so rules 1-5 all pass it, and the semantic gate downstream reads a moved
  // date as a moved FACT ("a date" is on its substantive list). It then reaches the
  // reader as a shipped item whose whole content is "only the date changed"
  // (OUT-181). Strip every date shape off both sides: if what is left is identical,
  // nothing was shipped, the entry was re-dated.
  if (context?.sourceType && DATED_ENTRY_SOURCES.has(context.sourceType)) {
    if (stripDates(diff.added) === stripDates(diff.removed)) {
      return { worth: false, reason: "dates_only" };
    }
  }

  return { worth: true };
}
