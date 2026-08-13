import { and, desc, eq, isNotNull, isNull, ne, or } from "drizzle-orm";
import type { MemorySignalRow } from "@outrival/shared";
import { db } from "../client";
import { competitors, signals } from "../schema";

/**
 * The accumulated signal history one competitor memory is built from (OUT-172).
 *
 * Lives here rather than in each caller because the weekly digest and the competitor
 * page must read the SAME history: a filter that drifts on one side would make the
 * push and the pull tell different stories about the same competitor, which is the
 * exact failure the shared narration function exists to prevent.
 *
 * Excluded on purpose: insights the faithfulness gate blocked (no surface may be the
 * back door around it), signals whose figures the post-hoc check could not verify,
 * and signals the user hid as not useful. A fact that was not good enough to show
 * once does not improve by being replayed three months later.
 *
 * Only rows carrying a human before/after pair qualify. That pair is the classifier's
 * plain-language restatement of the diff and is the one field the grounding layer
 * keeps even when it withholds a signal's generated prose, so it is safe to replay.
 */
export async function loadMemorySignals(opts: {
  orgId: string;
  /** Narrow to one competitor — the page reads deep on one, the digest across all. */
  competitorId?: string;
  /**
   * Ceiling on the rows read, newest first. Past it the OLDEST facts drop, so the
   * rendered trajectory stays current and only "since" reads later than the true
   * first capture. Capping the recent end instead would narrate a stale story.
   */
  limit: number;
}): Promise<MemorySignalRow[]> {
  return db
    .select({
      signalId: signals.id,
      competitorId: signals.competitorId,
      competitor: competitors.name,
      category: signals.category,
      before: signals.humanChangeBefore,
      after: signals.humanChangeAfter,
      at: signals.createdAt,
    })
    .from(signals)
    .innerJoin(competitors, eq(competitors.id, signals.competitorId))
    .where(
      and(
        eq(signals.orgId, opts.orgId),
        opts.competitorId ? eq(signals.competitorId, opts.competitorId) : undefined,
        isNotNull(signals.humanChangeAfter),
        isNull(signals.hiddenForUserAt),
        or(isNull(signals.filteredReason), ne(signals.filteredReason, "faithfulness_blocked")),
        or(isNull(signals.groundingStatus), ne(signals.groundingStatus, "unverified")),
      ),
    )
    .orderBy(desc(signals.createdAt))
    .limit(opts.limit);
}
