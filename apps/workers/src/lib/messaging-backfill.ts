import { and, asc, eq } from "drizzle-orm";
import { db, monitors, snapshots, messagingVersions } from "@outrival/db";
import {
  derivePositioningCopy,
  planMessagingVersions,
  getFromR2,
  type MessagingCapture,
} from "@outrival/shared";
import {
  parseHomepageStructure,
  isIncompleteRender,
  type HomepageStructure,
} from "@outrival/scrapers/homepage-structure";

/**
 * Rebuild one competitor's messaging timeline from the homepage captures we
 * already hold (Positioning Intelligence v2 P1).
 *
 * It writes ONE table and nothing else. No snapshot, no change, no signal, no
 * scrape — and that is the rule the whole feature rests on, not an implementation
 * detail: a timeline reconstructed from the archive must never announce, three
 * years late, that a company repositioned itself. There is no code path from here
 * to a signal, which is what the dedicated test pins.
 *
 * Idempotent by construction: the same capture chain always plans the same rows
 * at the same timestamps, so the unique key turns a second run into a no-op.
 */

/** How far back the timeline is rebuilt, in captures. A daily homepage scrape puts
 *  this at roughly two years, and it bounds the walk by work done rather than by
 *  versions found — a competitor that never rewrites its homepage must not make us
 *  read its entire snapshot table. */
export const BACKFILL_MAX_CAPTURES = 800;
/** Captures older than patch-16 carry no stored structure, so each costs an R2 GET
 *  plus a full parse. The point is depth on the recent past, not a re-parse of
 *  every page we ever fetched. */
export const BACKFILL_MAX_R2_PARSES = 25;

export interface MessagingBackfillResult {
  /** Captures read off the snapshot chain. */
  captures: number;
  /** Captures that yielded usable copy (structure present, render complete). */
  parsed: number;
  /** Captures whose HTML had to be re-read from R2 (pre-patch-16). */
  fetched: number;
  versions: MessagingCapture[];
  /** Rows actually written. 0 on a dry run, and 0 on a re-run. */
  inserted: number;
}

export interface MessagingBackfillOptions {
  apply?: boolean;
  maxCaptures?: number;
  maxR2Parses?: number;
  /** Injected so a test can date a capture chain without an R2 bucket. */
  fetchHtml?: (r2Key: string) => Promise<string | null>;
}

const EMPTY: MessagingBackfillResult = {
  captures: 0,
  parsed: 0,
  fetched: 0,
  versions: [],
  inserted: 0,
};

export async function backfillMessagingVersions(
  competitorId: string,
  options: MessagingBackfillOptions = {},
): Promise<MessagingBackfillResult> {
  const maxCaptures = options.maxCaptures ?? BACKFILL_MAX_CAPTURES;
  const maxR2 = options.maxR2Parses ?? BACKFILL_MAX_R2_PARSES;
  const fetchHtml =
    options.fetchHtml ?? ((key: string) => getFromR2(`${key}.html`).catch(() => null));

  const [homepage] = await db
    .select({ id: monitors.id })
    .from(monitors)
    .where(and(eq(monitors.competitorId, competitorId), eq(monitors.sourceType, "homepage")))
    .limit(1);
  if (!homepage) return EMPTY;

  // Oldest first: a version is stamped with the capture where its wording FIRST
  // appeared, so the chain has to be walked forwards.
  const rows = await db
    .select({
      structure: snapshots.homepageStructure,
      r2Key: snapshots.r2Key,
      resolvedUrl: snapshots.resolvedUrl,
      scrapedAt: snapshots.scrapedAt,
    })
    .from(snapshots)
    .where(and(eq(snapshots.monitorId, homepage.id), eq(snapshots.status, "success")))
    .orderBy(asc(snapshots.scrapedAt))
    .limit(maxCaptures);

  const captures: MessagingCapture[] = [];
  let fetched = 0;
  for (const row of rows) {
    let structure = row.structure as HomepageStructure | null;
    if (!structure) {
      // Pre-patch-16 capture: the stored HTML is the only record of what it said.
      if (fetched >= maxR2) continue;
      fetched++;
      const html = await fetchHtml(row.r2Key);
      if (!html) continue;
      structure = parseHomepageStructure(html, row.resolvedUrl ?? "https://example.com");
    }
    // Same guard as the live writer: a failed render parses into a structure that
    // HAS a hero, so recording it would date a repositioning to the day a capture
    // broke. Snapshots taken before completeness grading shipped are stored
    // `success` regardless, so the status filter cannot be trusted to catch it.
    if (isIncompleteRender(structure)) continue;
    captures.push({
      capturedAt: row.scrapedAt,
      snapshotKey: row.r2Key,
      copy: derivePositioningCopy(structure),
    });
  }

  const versions = planMessagingVersions(captures);
  if (!options.apply || versions.length === 0) {
    return { captures: rows.length, parsed: captures.length, fetched, versions, inserted: 0 };
  }

  const written = await db
    .insert(messagingVersions)
    .values(
      versions.map((v) => ({
        competitorId,
        h1: v.copy.headline,
        subheadline: v.copy.subheadline,
        primaryCta: v.copy.primaryCta,
        valueProps: v.copy.valueProps,
        capturedAt: v.capturedAt,
        snapshotKey: v.snapshotKey,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: messagingVersions.id });

  return {
    captures: rows.length,
    parsed: captures.length,
    fetched,
    versions,
    inserted: written.length,
  };
}
