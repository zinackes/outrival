import { loadMemorySignals } from "@outrival/db";
import {
  buildCompetitorMemory,
  MEMORY_HISTORY_CAP,
  type CompetitorMemory,
} from "@outrival/shared";

/**
 * What the org knows about its competitors over the whole tracking period (OUT-172).
 *
 * Deterministic and free: no AI call, and nothing here is new prose — every line is
 * the plain-language before/after the classifier recorded at the time, replayed.
 * What counts as replayable is decided by `loadMemorySignals` (@outrival/db), which
 * the competitor page reads through too so the two surfaces cannot drift.
 *
 * Lives here rather than in one job because both briefs carry the block: the weekly
 * one it was written for, and the daily one, which is the brief most orgs actually
 * read. A per-job copy would let the two drift on the history cap alone.
 */
export async function loadCompetitorMemory(
  orgId: string,
  now: Date,
): Promise<CompetitorMemory> {
  const rows = await loadMemorySignals({ orgId, limit: MEMORY_HISTORY_CAP });
  return buildCompetitorMemory(rows, { now });
}
