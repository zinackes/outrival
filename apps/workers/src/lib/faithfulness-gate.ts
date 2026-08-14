import {
  verifyFaithfulness,
  faithfulnessGateEnabled,
  AI_CONFIG,
  type FaithfulnessReport,
  type FaithfulnessTask,
} from "@outrival/ai";
import type { QualityCheckInput, QualityEnvelope } from "@outrival/db";
import { loggedAi, type AiRunAttribution } from "./analytics";
import { logger } from "./job-logger";

// The publication gate, job side: run the claim-level check on an output that is
// about to leave the system, and route a blocked one to the EXISTING review queue
// (ai_quality_checks) instead of publishing it.
//
// One `loggedAi` wrap per gated output, not one per model call: consumeUsage()
// accumulates the tokens of every complete() made in the same async context, so a
// single ai_runs row carries the full cost of extraction + all judge calls. The
// latency breakdown (extraction vs judge) has no column in ai_runs, so it travels
// in the report (stored as jsonb with the output) and in the log line below.
//
// The config passed below is only the FALLBACK label for that row — the pool's real
// provider/model is read back by logAiRun from the async context. It names the fast
// tier because extraction (one call, always) runs there; the judge runs smart and
// fires only on claims the fuzzy pass could not settle.

/** ai_runs task label for the extraction + judge chain. */
export const FAITHFULNESS_AI_TASK = "faithfulness_check";

export interface FaithfulnessCheckParams {
  /**
   * Which gated surface this is. Decides whether the gate runs at all
   * (FAITHFULNESS_GATE_TASKS), so it is not a label — it is the switch.
   */
  task: FaithfulnessTask;
  /** The output about to be published, exactly as generated. */
  output: unknown;
  /** The evidence it must be traceable to. */
  sourceText: string;
  /** What is being checked, e.g. "sales battle card" — grounds the extractor. */
  outputKind: string;
  /** Identifies the output in the logs (competitor id, org id, signal id…). */
  context: Record<string, unknown>;
  attribution?: AiRunAttribution;
}

/**
 * Verify a publishable output. Returns null when the gate is switched off for
 * this task (FAITHFULNESS_GATE_TASKS does not list it, or is unset and
 * FAITHFULNESS_GATE_ENABLED is not "true") — callers then publish exactly as
 * before, with zero added AI calls.
 *
 * Never throws: verifyFaithfulness degrades every failure to verdict "skipped",
 * and the loggedAi wrapper only adds an ai_runs row. A provider outage must not
 * take battle cards, digests and alerts down with it.
 */
export async function checkFaithfulness(
  params: FaithfulnessCheckParams,
): Promise<FaithfulnessReport | null> {
  if (!faithfulnessGateEnabled(params.task)) return null;

  const report = await loggedAi(
    FAITHFULNESS_AI_TASK,
    AI_CONFIG.classificationFast,
    () =>
      verifyFaithfulness({
        output: params.output,
        sourceText: params.sourceText,
        outputKind: params.outputKind,
      }),
    params.attribution,
  );

  const line = {
    ...params.context,
    task: params.task,
    kind: params.outputKind,
    verdict: report.verdict,
    ratio: report.ratio,
    verbatimRatio: report.verbatimRatio,
    claims: report.claims.length,
    judgeCalls: report.judgeCalls,
    durationMs: report.durationMs,
    extractionMs: report.extractionMs,
    judgeMs: report.judgeMs,
  };
  if (report.verdict === "blocked") {
    logger.warn("Faithfulness gate BLOCKED publication", { ...line, reason: report.reason });
  } else if (report.verdict === "skipped") {
    // Fail-open path: the output publishes unverified. Visible, never silent.
    logger.warn("Faithfulness check skipped — publishing unverified", {
      ...line,
      reason: report.reason,
    });
  } else {
    logger.log("Faithfulness check passed", line);
  }
  return report;
}

/** True when the gate ran and refused this output. */
export function isBlocked(report: FaithfulnessReport | null): boolean {
  return report?.verdict === "blocked";
}

/**
 * What may publish after a block was repaired: only a repaired output whose
 * RE-verification came back a clean `pass`. Null means the caller keeps serving
 * what it already had — the previous battle card, untouched.
 *
 * Strict on THIS path only. Everywhere else an unavailable verification means
 * publish-unverified (the fail-open posture that bounds the gate's risk), but
 * this content was already refused once: a provider outage mid-repair must not
 * become the way it gets through. Pure, so the rule that decides whether a
 * customer keeps seeing yesterday's card is testable without a job run.
 */
export function publishableAfterRepair<T>(
  repaired: T | null,
  recheck: FaithfulnessReport | null,
): T | null {
  return repaired && recheck?.verdict === "pass" ? repaired : null;
}

/**
 * The review-queue entry for a blocked output: the existing quality envelope, forced
 * to flaggedForHumanReview, plus the report — whose `unfaithfulClaims` name the exact
 * sentences that stopped the publication. Pure, so the payload a reviewer will see is
 * testable without a job run.
 */
export function blockedReviewEntry(args: {
  aiTask: string;
  targetType: string;
  targetId: string | null;
  orgId: string;
  quality: QualityEnvelope;
  report: FaithfulnessReport;
}): QualityCheckInput {
  return {
    aiTask: args.aiTask,
    targetType: args.targetType,
    targetId: args.targetId,
    orgId: args.orgId,
    quality: { ...args.quality, flaggedForHumanReview: true },
    faithfulness: args.report,
  };
}
