// Abstention (Véracité Intelligence v2 P3) — what we do when the deterministic
// post-hoc check finds a figure the source does not support.
//
// The rule is ABSTAIN, never repair:
//  - the signal is still emitted, with the facts that were never in doubt (the
//    human before/after the classifier extracted, and the fact block the API builds
//    from the sibling extractors' rows). Withholding a sentence must never cost the
//    user the whole detection;
//  - the prose FIELD carrying the unsupported figure is withheld — not rewritten,
//    not re-generated. A second call costs money to produce a sentence with the same
//    provenance, and asking a model to say it again teaches it to say it more
//    confidently, not more truthfully;
//  - `insight` is NOT NULL in the schema, so withholding it means replacing it with
//    a deterministic sentence built from the change itself — no model text survives.
//
// Pure and synchronous: the decision is arithmetic on a check that already ran.

import type { PostHocGrounding } from "./types";

/** The three prose fields of a signal insight, as the model returns them. */
export interface InsightProse {
  insight: string;
  so_what: string;
  recommended_action: string | null;
}

export interface AbstentionResult {
  insight: string;
  soWhat: string | null;
  recommendedAction: string | null;
  /** Field names withheld, for the log and for the P4 badge. [] when nothing was. */
  withheld: string[];
}

/**
 * The sentence that replaces a withheld insight. Deterministic: it states only the
 * before/after the classifier lifted out of the diff, never anything generated.
 * English, like every user-facing string in the product.
 */
export function deterministicInsight(args: {
  competitorName: string;
  humanChangeBefore: string | null;
  humanChangeAfter: string | null;
}): string {
  const { competitorName, humanChangeBefore, humanChangeAfter } = args;
  if (humanChangeBefore && humanChangeAfter) {
    return `${competitorName} changed "${humanChangeBefore}" to "${humanChangeAfter}".`;
  }
  if (humanChangeAfter) return `${competitorName} now states "${humanChangeAfter}".`;
  return `${competitorName} changed this page.`;
}

/**
 * Withhold the prose fields the source cannot support.
 *
 * `skipped` and `verified` both publish everything: a check that could not run is
 * silence, not a verdict (same posture as the faithfulness gate). A token with no
 * field attribution withholds all three — it can only happen if a caller checked the
 * whole output as one string, and in that case we cannot tell which sentence lied.
 */
export function abstainFromUnverified(args: {
  prose: InsightProse;
  postHoc: PostHocGrounding | null;
  fallbackInsight: string;
}): AbstentionResult {
  const { prose, postHoc, fallbackInsight } = args;
  const publishAll: AbstentionResult = {
    insight: prose.insight,
    soWhat: prose.so_what || null,
    recommendedAction: prose.recommended_action,
    withheld: [],
  };
  if (!postHoc || postHoc.status !== "unverified") return publishAll;

  const fields = new Set(postHoc.unverified.map((t) => t.field ?? "*"));
  const hit = (name: string) => fields.has(name) || fields.has("*");

  const withheld: string[] = [];
  for (const name of ["insight", "so_what", "recommended_action"]) {
    if (hit(name)) withheld.push(name);
  }
  if (withheld.length === 0) return publishAll;

  return {
    insight: hit("insight") ? fallbackInsight : prose.insight,
    soWhat: hit("so_what") ? null : prose.so_what || null,
    recommendedAction: hit("recommended_action") ? null : prose.recommended_action,
    withheld,
  };
}
