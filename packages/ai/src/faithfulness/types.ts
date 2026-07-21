// Claim-level faithfulness verification: the shapes shared by the extractor, the
// per-claim scorer, the binary judge and the publication gate.

/** One atomic factual assertion extracted from a publishable AI output. */
export interface Claim {
  /** The assertion, as one self-contained sentence. */
  text: string;
  /** The passage of the source it invokes. "" when the extractor found none. */
  citedQuote: string;
}

/**
 * How a claim was resolved.
 * - `verbatim`    — its quote really occurs in the source (existing fuzzy validator).
 * - `paraphrase`  — the quote didn't match, but the binary judge ruled it faithful.
 * - `unfaithful`  — the binary judge ruled it unsupported by the source. BLOCKS.
 * - `unverified`  — the judge could not rule (provider down, parse miss, call cap).
 *                   Counted as supported: the gate FAILS OPEN on infrastructure.
 */
export type ClaimStatus = "verbatim" | "paraphrase" | "unfaithful" | "unverified";

export interface ClaimVerdict {
  claim: Claim;
  status: ClaimStatus;
  /** The judge's one-line reason, when it ruled. */
  reason: string | null;
}

export type FaithfulnessVerdict = "pass" | "blocked" | "skipped";

/**
 * The report stored alongside the published output (jsonb) and handed to the
 * review queue when publication is blocked.
 */
export interface FaithfulnessReport {
  verdict: FaithfulnessVerdict;
  /** supported / total after judging — the number the gate reads. 1 when empty. */
  ratio: number;
  /** supported / total from the fuzzy pass ALONE, before the judge. Audit only. */
  verbatimRatio: number;
  claims: ClaimVerdict[];
  /** The claims that blocked publication — what the reviewer has to look at. */
  unfaithfulClaims: ClaimVerdict[];
  /** Why it was blocked or skipped; null on a clean pass. */
  reason: string | null;
  durationMs: number;
  extractionMs: number;
  judgeMs: number;
  judgeCalls: number;
}
