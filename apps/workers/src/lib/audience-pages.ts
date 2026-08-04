import { eq, sql } from "drizzle-orm";
import { db, audiencePages, competitors } from "@outrival/db";
import type { AudiencePageHit } from "@outrival/scrapers/positioning";

/**
 * The ICP registry (Positioning Intelligence v2 P3).
 *
 * One place writes `audience_pages`, and the two rules that make the table
 * trustworthy live here rather than in the job:
 *
 *  - NOTHING IS EVER REMOVED. Marketing sites get re-slugged and consolidated; a URL
 *    leaving a sitemap is not evidence a company left a market.
 *  - THE UNIQUE INDEX IS THE DEDUP, FOR LIFE. `(competitor_id, kind, slug)` — an
 *    insert that conflicts returns nothing, so what comes back from `record` is
 *    exactly the segments we had never seen this competitor claim. There is no
 *    `signalled_at` column and there does not need to be one: unlike the market map,
 *    whose key carries a SOURCE dimension (a rival found on a `/vs/` page and then in
 *    a blog post is two rows and one piece of news), one segment is one row however
 *    many URL shapes point at it.
 */

/** A row that entered the registry on this run. */
export interface NewAudiencePageRow {
  kind: string;
  slug: string;
  displayName: string;
  evidenceUrl: string | null;
  firstSeenAt: Date;
}

/**
 * Put audience pages into the registry and report which ones were NEW.
 *
 * The self product is included on purpose: its rows are how "they publish an
 * industry page for a vertical you do not" can ever be said. Only the SIGNAL is
 * skipped, and that decision belongs to the job.
 */
export async function recordAudiencePages(
  competitorId: string,
  hits: ReadonlyArray<AudiencePageHit>,
): Promise<NewAudiencePageRow[]> {
  const seen = new Set<string>();
  const values: Array<{
    competitorId: string;
    kind: string;
    slug: string;
    displayName: string;
    isCanonical: number;
    evidenceUrl: string;
  }> = [];

  for (const hit of hits) {
    const key = `${hit.kind} ${hit.slug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    values.push({
      competitorId,
      kind: hit.kind,
      slug: hit.slug,
      displayName: hit.displayName,
      isCanonical: hit.isCanonical ? 1 : 0,
      evidenceUrl: hit.evidenceUrl,
    });
  }
  if (values.length === 0) return [];

  return await db
    .insert(audiencePages)
    .values(values)
    .onConflictDoNothing()
    .returning({
      kind: audiencePages.kind,
      slug: audiencePages.slug,
      displayName: audiencePages.displayName,
      evidenceUrl: audiencePages.evidenceUrl,
      firstSeenAt: audiencePages.firstSeenAt,
    });
}

/** Metadata keys this feature caches on the competitor row. */
interface AudienceMeta {
  /** When the first pass recorded their back catalogue and stayed silent. */
  audiencePagesBaselinedAt?: string | null;
  /** Their audience hub, or null for "probed, there isn't one". */
  audienceIndexUrl?: string | null;
}

export function readAudienceMeta(metadata: unknown): {
  baselinedAt: Date | null;
  indexUrl: string | null;
  indexProbed: boolean;
} {
  const meta = (metadata ?? {}) as AudienceMeta;
  const stamp =
    typeof meta.audiencePagesBaselinedAt === "string"
      ? new Date(meta.audiencePagesBaselinedAt)
      : null;
  return {
    baselinedAt: stamp && Number.isFinite(stamp.getTime()) ? stamp : null,
    indexUrl: typeof meta.audienceIndexUrl === "string" ? meta.audienceIndexUrl : null,
    // `null` is a CACHED MISS — without it a competitor with no hub pays four GETs
    // on every sitemap capture, forever.
    indexProbed: meta.audienceIndexUrl !== undefined,
  };
}

/** Merged in SQL so a concurrent write of a sibling key (comparisonIndexUrl,
 *  integrationsUrl, customersUrl) survives. */
export async function writeAudienceMeta(
  competitorId: string,
  patch: AudienceMeta,
): Promise<void> {
  await db
    .update(competitors)
    .set({
      metadata: sql`coalesce(${competitors.metadata}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`,
    })
    .where(eq(competitors.id, competitorId));
}
