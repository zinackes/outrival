/**
 * Auto-learning of volatile (meaninglessly-churning) homepage lines — patch-17.
 * A line like "Used by 10,234 teams" normalizes to a number-stripped signature;
 * when the SAME signature keeps reappearing with different text across scrapes it
 * gets marked volatile and filtered out of diffs — replacing hardcoded regexes
 * with per-site adaptation. Becomes analysable again after enough stable scrapes.
 *
 * PURE: strings + counts in, decisions out. The worker owns the DB reads/writes.
 * Exposed as the `@outrival/scrapers/volatile` subpath.
 */

/**
 * Normalize a line to a stable signature: strip numbers, ISO dates, long
 * hex/hash tokens and URLs, lowercase, collapse whitespace. Two lines that differ
 * only by their variable parts share a signature. Empty (all-variable) → "".
 */
export function normalizeLine(line: string): string {
  return line
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, "")
    .replace(/\b[A-Fa-f0-9]{16,}\b/g, "")
    .replace(/\d+([,.]\d+)*/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export interface VolatileState {
  pattern: string;
  changeCount: number;
  stableCount: number;
  isVolatile: boolean;
}

export type VolatileUpdate = VolatileState;

export interface VolatileThresholds {
  /** consecutive changes before a signature is volatile. Default 5. */
  changeThreshold?: number;
  /** consecutive stable scrapes before a volatile signature is analysable again. Default 10. */
  resetThreshold?: number;
}

/**
 * Compute the new volatile state per affected signature from one scrape's
 * before/after lines and the monitor's existing state. Returns only the rows to
 * upsert (a signature that changed text, or a stable signature that's still
 * counting down its volatility). Pure.
 */
export function computeVolatileUpdates(
  previousLines: string[],
  currentLines: string[],
  existing: VolatileState[],
  thresholds: VolatileThresholds = {},
): VolatileUpdate[] {
  const changeThreshold = thresholds.changeThreshold ?? 5;
  const resetThreshold = thresholds.resetThreshold ?? 10;
  const existingByPattern = new Map(existing.map((e) => [e.pattern, e]));

  const prevNorm = new Map<string, string>();
  for (const line of previousLines) {
    const n = normalizeLine(line);
    if (n) prevNorm.set(n, line);
  }
  const currNorm = new Map<string, string>();
  for (const line of currentLines) {
    const n = normalizeLine(line);
    if (n) currNorm.set(n, line);
  }

  const updates: VolatileUpdate[] = [];
  for (const [pattern, prevLine] of prevNorm) {
    if (!currNorm.has(pattern)) continue;
    const currLine = currNorm.get(pattern)!;
    const ex = existingByPattern.get(pattern);
    if (currLine !== prevLine) {
      // Same signature, different text → it churned again.
      const changeCount = (ex?.changeCount ?? 0) + 1;
      updates.push({
        pattern,
        changeCount,
        stableCount: 0,
        isVolatile: changeCount >= changeThreshold,
      });
    } else if (ex?.isVolatile) {
      // Stable this scrape → count toward becoming analysable again.
      const stableCount = (ex.stableCount ?? 0) + 1;
      updates.push({
        pattern,
        changeCount: ex.changeCount,
        stableCount,
        isVolatile: stableCount < resetThreshold,
      });
    }
  }
  return updates;
}

/** Drop lines whose normalized signature is currently known volatile. Pure. */
export function filterVolatileLines(lines: string[], volatilePatterns: Set<string>): string[] {
  return lines.filter((line) => !volatilePatterns.has(normalizeLine(line)));
}
