import { parseLabelledDiff } from "@outrival/shared";
import { validateCitations } from "../grounding/citations";
import type { Claim } from "./types";

// Per-claim grounding, built ON the existing fuzzy citation validator rather than
// beside it: same normalisation, same sliding-window Levenshtein, same
// GROUNDING_FUZZY_MATCH_THRESHOLD. The only difference is granularity — the
// validator is called with a ONE-element array so the answer is attributable to a
// single assertion instead of being averaged over a whole output.
//
// POLARITY: on a labelled change the fuzzy pass scores against the <added> side
// ONLY. "The quote occurs in the source" is not the same question as "the source
// establishes this", and a diff is where the two come apart: a line the competitor
// DELETED is still in the source text, so an insight reporting it as their new
// position matched verbatim and published at ratio 1 without a single judge call.
// Restricting the free pass to the live side sends those claims to the judge, which
// knows both sides and can still rule "they dropped X" faithful. Fail-open is
// preserved — this only moves a claim from auto-supported to judged, never to
// unfaithful — and a source with no sides (battle card, digest) is untouched.

export interface ScoredClaim {
  claim: Claim;
  /** The claim's quote really occurs in the source. */
  supported: boolean;
}

/** Does this claim's cited quote occur in the source? (existing fuzzy validator) */
export function isClaimSupported(claim: Claim, sourceText: string): boolean {
  if (!claim.citedQuote) return false;
  const labelled = parseLabelledDiff(sourceText);
  const haystack = labelled ? labelled.added : sourceText;
  if (!haystack.trim()) return false;
  return validateCitations(
    [{ assertion: claim.text, sourceQuote: claim.citedQuote }],
    haystack,
  ).passed;
}

export function scoreClaims(claims: Claim[], sourceText: string): ScoredClaim[] {
  return claims.map((claim) => ({ claim, supported: isClaimSupported(claim, sourceText) }));
}

/** Ratio of claims whose quote matched verbatim. 1 when there is nothing to verify. */
export function verbatimRatio(scored: ScoredClaim[]): number {
  if (scored.length === 0) return 1;
  return scored.filter((s) => s.supported).length / scored.length;
}
