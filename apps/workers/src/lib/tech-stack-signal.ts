import type { Classification } from "@outrival/ai";

// Audit 2026-07-09: 31 of 110 sampled prod signals (28% of the feed) were
// tech-stack "New technology detected" false-adoptions — the FIRST tech-stack
// scan of a competitor finds tech that was always there and narrates it as a
// fresh adoption. This module gates that noise at the source: no signal on the
// baseline scan, and a script/header detection alone is never alert-tier.

const IMPORTANCE_RANK: Record<string, number> = { low: 1, medium: 2, high: 3 };

/** Severity for a tech-appearance signal. A script/header detection alone is never
 * alert-tier: high-importance tells (payments, CRM) cap at "medium", the rest at
 * "low". (Audit 2026-07-09: 4 of the recent "high" signals were marketing scripts.) */
export function severityForImportance(importance: string): Classification["severity"] {
  return importance === "high" ? "medium" : "low";
}

/** Which appeared techs deserve a signal. None on the baseline scan (first-ever
 * tech-stack run: everything "appears", none of it is news). */
export function signalEligibleTechs<T extends { importance: string }>(
  appeared: T[],
  opts: { isBaselineScan: boolean; minImportance: string },
): T[] {
  if (opts.isBaselineScan) return [];
  const min = IMPORTANCE_RANK[opts.minImportance] ?? 0;
  return appeared.filter((t) => (IMPORTANCE_RANK[t.importance] ?? 0) >= min);
}
