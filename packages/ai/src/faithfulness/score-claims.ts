import { validateCitations } from "../grounding/citations";
import type { Claim } from "./types";

// Per-claim grounding, built ON the existing fuzzy citation validator rather than
// beside it: same normalisation, same sliding-window Levenshtein, same
// GROUNDING_FUZZY_MATCH_THRESHOLD. The only difference is granularity — the
// validator is called with a ONE-element array so the answer is attributable to a
// single assertion instead of being averaged over a whole output.

export interface ScoredClaim {
  claim: Claim;
  /** The claim's quote really occurs in the source. */
  supported: boolean;
}

/** Does this claim's cited quote occur in the source? (existing fuzzy validator) */
export function isClaimSupported(claim: Claim, sourceText: string): boolean {
  if (!claim.citedQuote) return false;
  return validateCitations(
    [{ assertion: claim.text, sourceQuote: claim.citedQuote }],
    sourceText,
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
