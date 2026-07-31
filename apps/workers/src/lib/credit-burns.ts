// Pricing Intelligence P5 — the credit burn-rate stage of extract-pricing.
//
// Runs in the SAME job as the plan extraction, on live runs only, and is
// ADDITIVE by contract: whatever fails here, the pricing run stays a success and
// the plan rows write normally (the caller wraps it in try/catch, like P2).
//
// No new AI call: the burns ride the pricing extraction's own response
// (`credit_burns`, see @outrival/ai extract-pricing). So the cost of this whole
// phase is zero extra tokens, and a page resolved by a cheaper stage
// (structured-first, cached parser, harvest floor) simply publishes no burns —
// which reads as "we did not see a mapping", never as "the mapping is empty".
//
// THE GROUNDING IS THE FEATURE. A burn rate is the price rise nobody prints, so
// the temptation for a model asked to find one is to derive it from a pack size
// ("1,000 credits for $99" → "1 scan = 1 credit"). Two deterministic gates stop
// that, both in code, neither a prompt instruction:
//
//   1. the action's verbatim wording must exist in the page text;
//   2. the credit figure must appear NEAR that wording — inside a window around
//      one of its occurrences. This is what separates a mapping the page printed
//      from a number the model carried over from somewhere else on the page.

import { normalizeFeatureLabel, type CreditBurnRow } from "@outrival/shared";

/** How far from the action's wording the credit figure may sit and still count
 * as published together with it. Wide enough for a table row rendered as
 * "OCR page | 5 credits" plus a column of markup-stripped whitespace, narrow
 * enough that a figure from the next section is not borrowed. */
export const BURN_GROUNDING_WINDOW = 160;

// A page publishing more than this is not publishing a mapping, it is a catalog
// we mis-read. Applied in page order, so what survives is what the page leads with.
export const MAX_CREDIT_BURNS = 40;

export interface PreparedCreditBurns {
  rows: CreditBurnRow[];
  dropped: { substring: number; ungrounded: number; invalid: number; cap: number };
}

/** Every index at which `needle` occurs in `haystack` (both pre-normalized). */
function occurrences(haystack: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle) return out;
  let from = 0;
  for (;;) {
    const i = haystack.indexOf(needle, from);
    if (i < 0) return out;
    out.push(i);
    from = i + needle.length;
  }
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Does `window` print this credit figure as a NUMBER of its own?
 *
 * The boundary is the point. A bare `indexOf` would find "5" inside "$599" and
 * "1" inside "1,000 credits for $99", so every small burn rate would ground
 * itself against the pack price sitting two lines above it — which is exactly
 * the derivation this gate exists to refuse. Both the page's plain and
 * thousands-separated spellings count ("1500" and "1,500").
 */
function printsCredits(window: string, credits: number): boolean {
  const rounded = Math.round(credits * 100) / 100;
  const spellings = new Set([String(rounded), rounded.toLocaleString("en-US")]);
  for (const s of spellings) {
    if (new RegExp(`(?<![\\d.,])${escapeRe(s)}(?![\\d.,])`).test(window)) return true;
  }
  return false;
}

/**
 * Pure: the burns an extraction claimed + the page text → the rows to store.
 *
 * Nothing is repaired here. A burn that fails a gate is dropped, not adjusted:
 * the whole value of this table is that every row is a mapping the competitor
 * published, so a half-believed row would poison the diff it feeds.
 */
export function prepareCreditBurns(args: {
  raw: ReadonlyArray<{ action: string; credits: number }> | null | undefined;
  pageText: string;
}): PreparedCreditBurns {
  const dropped = { substring: 0, ungrounded: 0, invalid: 0, cap: 0 };
  if (!args.raw || args.raw.length === 0) return { rows: [], dropped };

  const page = normalizeFeatureLabel(args.pageText);
  const rows: CreditBurnRow[] = [];
  const seen = new Set<string>();

  for (const burn of args.raw) {
    const action = typeof burn.action === "string" ? burn.action.trim() : "";
    // A zero-credit action is a free action, which is a claim about the mapping
    // and not a mapping; a negative one is a parse artefact.
    if (!action || !Number.isFinite(burn.credits) || burn.credits <= 0) {
      dropped.invalid++;
      continue;
    }
    const key = normalizeFeatureLabel(action);
    if (seen.has(key)) continue;

    const at = occurrences(page, key);
    if (at.length === 0) {
      dropped.substring++;
      continue;
    }
    const grounded = at.some((i) => {
      const from = Math.max(0, i - BURN_GROUNDING_WINDOW);
      return printsCredits(page.slice(from, i + key.length + BURN_GROUNDING_WINDOW), burn.credits);
    });
    if (!grounded) {
      dropped.ungrounded++;
      continue;
    }

    if (rows.length >= MAX_CREDIT_BURNS) {
      dropped.cap++;
      continue;
    }
    seen.add(key);
    rows.push({ action, credits: burn.credits });
  }

  return { rows, dropped };
}
