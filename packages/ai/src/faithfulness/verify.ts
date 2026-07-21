import { extractClaims } from "./extract-claims";
import { judgeClaim } from "./judge-claim";
import { scoreClaims, verbatimRatio } from "./score-claims";
import { decideGate, faithfulnessMinRatio } from "./gate";
import type { ClaimVerdict, FaithfulnessReport } from "./types";

// The chain: extract atomic claims (FAST model) → verify each against its cited
// source with the EXISTING fuzzy validator (free) → hand the undecided ones to the
// binary judge (SMART model — the fast one misjudges absence-of-data claims, see
// judge-claim.ts) → ratio + verdict. Cheap→expensive: the fuzzy pass is free and
// settles most claims, the judge only pays for what it couldn't.
//
// This never throws. Every failure mode (parse miss, rate limit, open breaker)
// degrades to verdict "skipped", which the gate reads as "publish" — an AI outage
// must not silence every battle card, digest and alert.
//
// V1 is single-sample. A future option is SelfCheckGPT-style multi-sampling (judge
// each undecided claim N times and take the majority) to cut judge variance; it
// multiplies the call count by N, so it stays out until the single-sample false
// block rate is measured in the review queue.

/**
 * Judge calls are the only variable cost of the chain. Past this many undecided
 * claims the output is unusually unquotable; the rest are marked `unverified`
 * (counted as supported — fail open) rather than blocking on unread claims.
 */
const MAX_JUDGE_CALLS = 12;

export interface VerifyFaithfulnessParams {
  /** The publishable output, exactly as generated. */
  output: unknown;
  /** The evidence it must be traceable to (same source the generation was grounded on). */
  sourceText: string;
  /** What is being checked, e.g. "sales battle card" — grounds the extractor prompt. */
  outputKind: string;
}

/** Seam for tests: the two model calls of the chain, injected. */
export interface FaithfulnessDeps {
  extractClaims: typeof extractClaims;
  judgeClaim: typeof judgeClaim;
}

const REAL_DEPS: FaithfulnessDeps = { extractClaims, judgeClaim };

function skipped(reason: string, durationMs: number, extractionMs = 0): FaithfulnessReport {
  return {
    verdict: "skipped",
    ratio: 1,
    verbatimRatio: 1,
    claims: [],
    unfaithfulClaims: [],
    reason,
    durationMs,
    extractionMs,
    judgeMs: 0,
    judgeCalls: 0,
  };
}

export async function verifyFaithfulness(
  params: VerifyFaithfulnessParams,
  deps: FaithfulnessDeps = REAL_DEPS,
): Promise<FaithfulnessReport> {
  const startedAt = Date.now();

  let claims;
  const extractStart = Date.now();
  try {
    claims = await deps.extractClaims(params);
  } catch (err) {
    const ms = Date.now() - startedAt;
    return skipped(
      `claim extraction failed: ${err instanceof Error ? err.message : String(err)}`,
      ms,
      Date.now() - extractStart,
    );
  }
  const extractionMs = Date.now() - extractStart;
  if (!claims) return skipped("claim extraction parse miss", Date.now() - startedAt, extractionMs);

  const scored = scoreClaims(claims, params.sourceText);
  const verbatim = verbatimRatio(scored);

  const verdicts: ClaimVerdict[] = [];
  let judgeCalls = 0;
  let judgeMs = 0;
  for (const { claim, supported } of scored) {
    if (supported) {
      verdicts.push({ claim, status: "verbatim", reason: null });
      continue;
    }
    if (judgeCalls >= MAX_JUDGE_CALLS) {
      verdicts.push({ claim, status: "unverified", reason: "judge call budget exhausted" });
      continue;
    }
    const judgeStart = Date.now();
    let judgement = null;
    try {
      judgeCalls++;
      judgement = await deps.judgeClaim(claim, params.sourceText);
    } catch (err) {
      // A judge failure is infrastructure, not a verdict — never read it as unfaithful.
      judgement = null;
      console.error(
        "faithfulness judge unavailable:",
        err instanceof Error ? err.message : err,
      );
    }
    judgeMs += Date.now() - judgeStart;

    if (!judgement) {
      verdicts.push({ claim, status: "unverified", reason: "judge unavailable" });
    } else if (judgement.faithful) {
      verdicts.push({ claim, status: "paraphrase", reason: judgement.reason });
    } else {
      verdicts.push({ claim, status: "unfaithful", reason: judgement.reason });
    }
  }

  const unfaithfulClaims = verdicts.filter((v) => v.status === "unfaithful");
  const ratio =
    verdicts.length === 0 ? 1 : (verdicts.length - unfaithfulClaims.length) / verdicts.length;

  const decision = decideGate(
    { verdict: "pass", ratio, unfaithfulClaims },
    faithfulnessMinRatio(),
  );

  return {
    verdict: decision.blocked ? "blocked" : "pass",
    ratio,
    verbatimRatio: verbatim,
    claims: verdicts,
    unfaithfulClaims,
    reason: decision.reason,
    durationMs: Date.now() - startedAt,
    extractionMs,
    judgeMs,
    judgeCalls,
  };
}
