// Removing the market-map rows the old blog prompt produced (OUT-180).
//
// Until OUT-180, `enrich-blog-posts` asked a model for "the OTHER companies this
// post names" and filed every answer as a rival. A container registry's launch
// posts therefore put its CUSTOMERS (an airline, a streaming service) and its
// PARTNERS (two chip vendors) on the market map, beside the companies it actually
// publishes `/vs/` pages against. The prompt now labels each name
// competitor / customer / partner / other and only `competitor` reaches the
// registry — but the rows written before that are still here, and no relationship
// was ever stored on them, so nothing after the fact can tell which were rivals.
//
// So this drops the batch with nothing behind it: a `blog` or `docs` row whose
// (competitor, name) has NO `vs_page` or `alternatives_page` row — a name the
// competitor wrote in prose and nowhere else. A content row that CORROBORATES a
// real front is kept, because the page is the claim and the post is extra evidence
// for it; `namedTargets` folds the two into one target either way.
//
// The accepted loss is a genuine rival that a post named and no page ever did. It
// goes, because it came out of a prompt that could not tell it from a customer.

import { and, eq, inArray, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import { db, competitors, contentItems, namedCompetitors } from "@outrival/db";
import { PAGE_SOURCES } from "@outrival/scrapers/positioning";

/** The two sources a model wrote in prose, as opposed to a page we found by slug. */
export const CONTENT_SOURCES = ["blog", "docs"] as const;

export interface CleanupReport {
  /** Rows deleted, or that an --apply would delete. */
  deleted: number;
  /** Content items whose `competitors_named` was (or would be) cleared. */
  cleared: number;
  /** Content rows left alone because they carry `signalled_at`. */
  announcedKept: number;
  /** Per competitor, the names going away — what a dry run prints. */
  byCompetitor: Array<{ competitorId: string; competitorName: string; names: string[] }>;
}

/**
 * A prose-only mention that never signalled: nothing stands behind it.
 *
 * The `signalled_at` half is the load-bearing one. That stamp is written on EVERY
 * row holding a name, across sources, and it is what makes `new_comparison_target`
 * deduplicate for a lifetime. Delete the row that holds it and a front announced
 * two years ago can be announced again as this week's news.
 */
function orphanMention(competitorId?: string | null): SQL | undefined {
  return and(
    inArray(namedCompetitors.source, [...CONTENT_SOURCES]),
    isNull(namedCompetitors.signalledAt),
    sql`not exists (
      select 1 from named_competitors page
      where page.competitor_id = ${namedCompetitors.competitorId}
        and page.name_normalized = ${namedCompetitors.nameNormalized}
        and page.source in (${sql.join(
          PAGE_SOURCES.map((s) => sql`${s}`),
          sql`, `,
        )})
    )`,
    competitorId ? eq(namedCompetitors.competitorId, competitorId) : undefined,
  );
}

/**
 * Delete the orphaned mentions, and clear the column that would refill them.
 *
 * `content_items.competitors_named` is a landmine rather than a display column:
 * nothing user-facing reads it, and `backfill:named-competitors` walks it straight
 * back into this table. Left alone, one re-run of that script reintroduces every
 * name deleted here — so both happen in ONE transaction, or neither does.
 *
 * Writes nothing unless `apply` is true, and never touches a signal either way.
 */
export async function cleanupBlogMentions(
  opts: { apply?: boolean; competitorId?: string | null } = {},
): Promise<CleanupReport> {
  const only = opts.competitorId ?? null;
  const doomed = await db
    .select({
      competitorId: namedCompetitors.competitorId,
      competitorName: competitors.name,
      displayName: namedCompetitors.displayName,
    })
    .from(namedCompetitors)
    .innerJoin(competitors, eq(competitors.id, namedCompetitors.competitorId))
    .where(orphanMention(only))
    .orderBy(competitors.name, namedCompetitors.displayName);

  // Counted rather than silently absent: a stamped content row is the one case
  // where a wrong name stays on the map on purpose.
  const [announced] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(namedCompetitors)
    .where(
      and(
        inArray(namedCompetitors.source, [...CONTENT_SOURCES]),
        isNotNull(namedCompetitors.signalledAt),
        only ? eq(namedCompetitors.competitorId, only) : undefined,
      ),
    );

  const storedNames = and(
    isNotNull(contentItems.competitorsNamed),
    only ? eq(contentItems.competitorId, only) : undefined,
  );
  const [stored] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(contentItems)
    .where(storedNames);

  const byCompetitor = new Map<string, CleanupReport["byCompetitor"][number]>();
  for (const row of doomed) {
    const held = byCompetitor.get(row.competitorId);
    if (held) held.names.push(row.displayName);
    else
      byCompetitor.set(row.competitorId, {
        competitorId: row.competitorId,
        competitorName: row.competitorName,
        names: [row.displayName],
      });
  }

  const report: CleanupReport = {
    deleted: doomed.length,
    cleared: stored?.n ?? 0,
    announcedKept: announced?.n ?? 0,
    byCompetitor: [...byCompetitor.values()],
  };
  if (!opts.apply) return report;

  await db.transaction(async (tx) => {
    await tx.delete(namedCompetitors).where(orphanMention(only));
    await tx.update(contentItems).set({ competitorsNamed: null }).where(storedNames);
  });
  return report;
}
