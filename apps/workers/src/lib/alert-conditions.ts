import { and, eq, inArray, sql } from "drizzle-orm";
import { db, alertConditions } from "@outrival/db";
import { AI_CONFIG, matchAlertConditions } from "@outrival/ai";
import { loggedAi } from "./analytics";

// Alert conditions (OUT-192) evaluated at signal creation. The org writes what it
// cares about in its own words; every signal is checked against the active rules, and
// a match is what makes the signal important (decideImportance, @outrival/shared)
// whatever its severity band says.
//
// Cost shape: one fast call per signal, and only for orgs that wrote a rule. An org
// with no conditions — every org, until it writes one — pays nothing and takes no
// latency, because the query returns empty and the AI call is never made.

/** Ceiling on rules sent in one prompt. Past this the model stops reading the tail. */
export const MAX_EVALUATED_CONDITIONS = 25;

export interface EvaluatedConditions {
  /** Ids to persist on the signal. Empty means evaluated and matched nothing. */
  matchedIds: string[];
  /** The users' own sentences, for the reason the feed shows. */
  matchedTexts: string[];
}

const NONE: EvaluatedConditions = { matchedIds: [], matchedTexts: [] };

export interface EvaluateConditionsInput {
  orgId: string;
  competitorId: string;
  competitorName: string;
  category: string;
  severity: string;
  insight: string;
  soWhat: string | null;
  changeBefore: string | null;
  changeAfter: string | null;
}

/**
 * Which of the org's conditions this signal satisfies.
 *
 * Never throws: a provider outage must not stop a signal from being written, and the
 * honest fallback is "matched nothing" rather than a guess. That biases the flag
 * toward silence, which is the direction a false alert cannot be taken back from.
 */
export async function evaluateAlertConditions(
  input: EvaluateConditionsInput,
): Promise<EvaluatedConditions> {
  const rows = await db
    .select({ id: alertConditions.id, condition: alertConditions.condition })
    .from(alertConditions)
    .where(and(eq(alertConditions.orgId, input.orgId), eq(alertConditions.isActive, true)))
    .limit(MAX_EVALUATED_CONDITIONS);

  if (rows.length === 0) return NONE;

  const match = await loggedAi(
    "match_alert_conditions",
    AI_CONFIG.classificationFast,
    () =>
      matchAlertConditions({
        conditions: rows,
        competitorName: input.competitorName,
        category: input.category,
        severity: input.severity,
        insight: input.insight,
        soWhat: input.soWhat,
        changeBefore: input.changeBefore,
        changeAfter: input.changeAfter,
      }),
    { orgId: input.orgId, competitorId: input.competitorId },
  ).catch(() => null);

  if (!match || match.matchedIds.length === 0) return NONE;

  const byId = new Map(rows.map((r) => [r.id, r.condition]));
  const matchedIds = match.matchedIds.filter((id) => byId.has(id));
  if (matchedIds.length === 0) return NONE;

  // Firing counters, so the settings list can answer "is this rule doing anything?"
  // without scanning signals. Best-effort: losing a count must not lose the signal.
  await db
    .update(alertConditions)
    .set({
      matchCount: sql`${alertConditions.matchCount} + 1`,
      lastMatchedAt: new Date(),
    })
    .where(and(eq(alertConditions.orgId, input.orgId), inArray(alertConditions.id, matchedIds)))
    .catch(() => undefined);

  return {
    matchedIds,
    matchedTexts: matchedIds.map((id) => byId.get(id) ?? ""),
  };
}
