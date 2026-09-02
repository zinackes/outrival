import { eq, sql } from "drizzle-orm";
import { db, competitors } from "@outrival/db";

/**
 * Has this ingest ever read this competitor's back catalogue?
 *
 * The sitemap's no-change branch has to answer that question before it may enqueue a
 * catch-up run, or a competitor whose sitemap never moves would pay the run every
 * week forever. Two of the four sitemap ingests already answer it: the market map and
 * the ICP registry each stamp an explicit `*BaselinedAt` marker that doubles as their
 * signal gate, and the catch-up reads it.
 *
 * The customer and integration registries decide signalling from a ROW COUNT instead,
 * and a row count cannot answer this one: a competitor with no customers page and no
 * integration catalog holds zero rows for life, so "zero rows" would mean "never ran"
 * on every capture. They stamp this marker instead — it says only that the run
 * happened, and it leaves their `plan*Run` baseline logic untouched.
 *
 * The three content ingests (blog / changelog / roadmap) answer it the same way and
 * for the same reason. Theirs is not a sitemap but the identical hole: they are
 * enqueued from the CHANGED-capture branch alone, so a competitor whose first capture
 * never reached them has an empty Content tab for as long as the page holds still —
 * the listing does not move, the hash does not move, and nothing re-enqueues the run.
 * A row count cannot gate that catch-up either: a blog with no feed and no
 * recognisable listing parses to zero items for life.
 *
 * Written by the JOB, on its own first run, for the reason the two existing markers
 * are: a run that throws never stamps, so the catch-up simply happens on the next
 * capture rather than being lost to a queue restart.
 */

/** The metadata keys the row-count registries and the content ingests stamp. */
export type IngestFirstRunKey =
  | "caseStudiesFirstRunAt"
  | "integrationsFirstRunAt"
  | `${CatchupContentSource}FirstRunAt`;

/**
 * The content sources whose ingest can be caught up on an unchanged capture.
 *
 * Each reads the capture as a standalone listing, so re-running one against the
 * snapshot we already hold recovers every row it should have written. `docs` is
 * deliberately absent: its ingest reads the DIFFERENCE between two captures (a docs
 * index dates nothing, so a newly documented page is only knowable as a delta), and
 * an unchanged capture has no delta to ingest.
 */
export const CATCHUP_CONTENT_SOURCES = ["blog", "changelog", "roadmap"] as const;

export type CatchupContentSource = (typeof CATCHUP_CONTENT_SOURCES)[number];

/** A monitor's source_type, when it is one the catch-up covers. */
export function catchupContentSource(sourceType: string): CatchupContentSource | null {
  return CATCHUP_CONTENT_SOURCES.find((s) => s === sourceType) ?? null;
}

export function contentFirstRunKey(source: CatchupContentSource): IngestFirstRunKey {
  return `${source}FirstRunAt`;
}

/**
 * Which content ingest, if any, an unchanged capture owes a catch-up run —
 * `pendingSitemapIngests` for the content listings.
 *
 * Null on every source outside the catch-up, and null again once the ingest has
 * stamped its marker, so the run fires once and then goes quiet.
 */
export function pendingContentIngest(
  sourceType: string,
  metadata: unknown,
): CatchupContentSource | null {
  const source = catchupContentSource(sourceType);
  if (!source) return null;
  return readIngestFirstRun(metadata, contentFirstRunKey(source)) ? null : source;
}

type IngestFirstRunMeta = Partial<Record<IngestFirstRunKey, string | null>>;

export function readIngestFirstRun(metadata: unknown, key: IngestFirstRunKey): Date | null {
  const meta = (metadata ?? {}) as IngestFirstRunMeta;
  const raw = meta[key];
  if (typeof raw !== "string") return null;
  const stamp = new Date(raw);
  return Number.isFinite(stamp.getTime()) ? stamp : null;
}

/** Merged in SQL so a concurrent write of a sibling key (customersUrl,
 *  integrationsUrl, comparisonIndexUrl) survives. */
export async function stampIngestFirstRun(
  competitorId: string,
  key: IngestFirstRunKey,
): Promise<void> {
  await db
    .update(competitors)
    .set({
      metadata: sql`coalesce(${competitors.metadata}, '{}'::jsonb) || ${JSON.stringify({
        [key]: new Date().toISOString(),
      })}::jsonb`,
    })
    .where(eq(competitors.id, competitorId));
}
