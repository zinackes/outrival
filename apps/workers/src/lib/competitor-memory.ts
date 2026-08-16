import { loadMemorySignals } from "@outrival/db";
import { buildCompetitorMemory, type CompetitorMemory } from "@outrival/shared";

/**
 * Ceiling on the signal history one memory block is built from. An org watching
 * twenty competitors for a year sits far under it; past it the OLDEST facts are the
 * ones dropped, so the rendered trajectory stays correct and only `since` reads
 * later than the true first capture. The reverse (capping the recent end) would
 * silently narrate a stale story, which is worse than a shortened one.
 */
const MEMORY_HISTORY_CAP = 2000;

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
