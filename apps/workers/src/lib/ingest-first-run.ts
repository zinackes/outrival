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
 * Written by the JOB, on its own first run, for the reason the two existing markers
 * are: a run that throws never stamps, so the catch-up simply happens on the next
 * capture rather than being lost to a queue restart.
 */

/** The metadata keys the two row-count registries stamp. */
export type IngestFirstRunKey = "caseStudiesFirstRunAt" | "integrationsFirstRunAt";

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
