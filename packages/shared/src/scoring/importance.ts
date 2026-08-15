/**
 * Important / not important, with the reason (OUT-192).
 *
 * Severity already exists and is not this. Severity is how big the move is; importance
 * is whether THIS reader should stop and look, and the two come apart constantly: a
 * critical funding round the reader can do nothing about, a medium pricing tweak that
 * lands on the exact tier they sell against. Visualping ships the flag free and
 * unlimited with a one-line reason, so the market already reads a feed expecting one.
 *
 * Deterministic on purpose. Every input is a number the pipeline already computed
 * (materiality sub-scores, composite relevance) or a condition the user wrote
 * themselves, so the reason is checkable against the row rather than being a second
 * opinion from a model that never saw the source. It also costs nothing per signal,
 * which is what lets it run on every one of them rather than the top band.
 *
 * The reason is user-facing English (`.claude/rules/language.md`) and is a REASON: it
 * says what makes the signal worth the reader's minute, never restates the severity
 * band the badge next to it already shows.
 */

export type ImportanceSeverity = "low" | "medium" | "high" | "critical";

/** The classifier's 0-3 sub-scores, when the signal was scored at all. */
export interface MaterialityScores {
  decisionImpact: number;
  urgency: number;
  corroboration: number;
}

export interface ImportanceInput {
  /** The severity actually shown (a user override wins upstream). */
  severity: ImportanceSeverity;
  /** Null on the synthesized paths (pricing transitions, Hacker News, sitemap). */
  materiality: MaterialityScores | null;
  /** Composite relevance of the underlying change, 0-1. Null off the structured path. */
  relevanceScore: number | null;
  /**
   * The user's own alert conditions this signal matched, in their words. A condition
   * the reader wrote is the strongest possible statement of what they care about, so
   * it outranks every score below.
   */
  matchedConditions?: readonly string[];
  /** Reconstructed from the web archive: real, but not news. */
  isBackfill?: boolean;
}

export interface ImportanceVerdict {
  important: boolean;
  /** One line, English. Always set: a flag with no reason is the thing users distrust. */
  reason: string;
}

/** A sub-score at or above this is what makes that axis the reason. */
const STRONG = 2;
/** Composite relevance that promotes a medium on its own. */
const RELEVANT = 0.7;

/** Longest reason we render before the feed row has to truncate it. */
export const IMPORTANCE_REASON_MAX = 90;

function quoteCondition(conditions: readonly string[]): string {
  const [first, ...rest] = conditions;
  const head = `Matches your alert “${first}”`;
  if (rest.length === 0) return head;
  return `${head} (+${rest.length} more)`;
}

/**
 * The axis that carries the decision, when the classifier scored one. Checked in the
 * order the axes matter to a reader: what it changes, then how fast, then whether
 * anything else backs it up. Corroboration alone is deliberately never a reason to
 * call something important, only to explain one that already is.
 */
function materialityReason(m: MaterialityScores): string | null {
  if (m.decisionImpact >= STRONG) return "Changes something you price or position against";
  if (m.urgency >= STRONG) return "Moving now, so the window to respond is open";
  if (m.corroboration >= STRONG) return "Part of a broader run of moves by this competitor";
  return null;
}

const SEVERITY_REASON: Record<ImportanceSeverity, string> = {
  critical: "Direct threat to how you win deals",
  high: "Material competitive move",
  medium: "Worth a look, not a fire",
  low: "Filed for the record",
};

/**
 * Whether this signal is important, and why.
 *
 * The ladder, first match wins:
 *   1. a condition the user wrote themselves,
 *   2. archive backfill (real, but it already happened),
 *   3. critical / high,
 *   4. medium carried by a strong sub-score or a high composite relevance,
 *   5. everything else.
 */
export function decideImportance(input: ImportanceInput): ImportanceVerdict {
  const matched = input.matchedConditions ?? [];
  if (matched.length > 0) {
    return { important: true, reason: quoteCondition(matched) };
  }

  if (input.isBackfill) {
    return { important: false, reason: "Historical move, reconstructed from the archive" };
  }

  const fromMateriality = input.materiality ? materialityReason(input.materiality) : null;

  if (input.severity === "critical" || input.severity === "high") {
    return { important: true, reason: fromMateriality ?? SEVERITY_REASON[input.severity] };
  }

  if (input.severity === "medium") {
    const strong =
      (input.materiality?.decisionImpact ?? 0) >= STRONG ||
      (input.relevanceScore ?? 0) >= RELEVANT;
    if (strong) {
      return {
        important: true,
        reason: fromMateriality ?? "High relevance to the pages you compete on",
      };
    }
    return { important: false, reason: "Real change, no impact on a decision you own" };
  }

  return { important: false, reason: SEVERITY_REASON.low };
}
