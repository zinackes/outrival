/**
 * Stamping job postings with the countries their location line names (Hiring
 * Intelligence v2 P2).
 *
 * The resolution itself is `@outrival/shared/geo` — offline, deterministic, no AI.
 * This module is the persistence side: it is shared by extract-jobs (which fills in
 * the postings that were already active when P2 shipped) and by the one-shot
 * baseline backfill command, so the two can never drift into stamping differently.
 *
 * Geo is an ENRICHMENT. Nothing here is allowed to fail a jobs run: a location that
 * does not resolve is stored as "unknown", which is a fact, and the caller keeps
 * going.
 */

import { inArray } from "drizzle-orm";
import { db, jobPostings } from "@outrival/db";
import { resolveLocation, type GeoResolution } from "@outrival/shared/geo";

export interface GeoStamp {
  /** Null rather than [] when no country was named, so the column reads as "none". */
  countryCodes: string[] | null;
  geoResolution: GeoResolution;
}

/** What one location line resolves to, in the shape the columns store. */
export function stampGeo(location: string | null | undefined): GeoStamp {
  const { countries, resolution } = resolveLocation(location);
  return { countryCodes: countries.length > 0 ? countries : null, geoResolution: resolution };
}

/** Per-run tally of how the resolver did — the learning loop for the dataset. */
export type GeoTally = Record<GeoResolution, number>;

export function tallyResolutions(stamps: ReadonlyArray<{ geoResolution: string | null }>): GeoTally {
  const tally: GeoTally = { country: 0, region: 0, remote: 0, unknown: 0 };
  for (const s of stamps) {
    const key = s.geoResolution as GeoResolution | null;
    if (key && key in tally) tally[key]++;
    else tally.unknown++;
  }
  return tally;
}

/**
 * Stamp postings that carry no resolution yet, and return them stamped.
 *
 * Rows are grouped by the stamp they produce, so a board where 40 roles say
 * "Remote — EU" costs one UPDATE, not 40. Best-effort: a write failure is logged by
 * the caller and the run continues, because the same rows are simply picked up on
 * the next scrape.
 */
export async function stampMissingGeo<T extends { id: string; location: string | null }>(
  rows: ReadonlyArray<T>,
): Promise<Map<string, GeoStamp>> {
  const stamps = new Map<string, GeoStamp>();
  if (rows.length === 0) return stamps;

  const groups = new Map<string, { stamp: GeoStamp; ids: string[] }>();
  for (const row of rows) {
    const stamp = stampGeo(row.location);
    stamps.set(row.id, stamp);
    const key = `${stamp.geoResolution}|${(stamp.countryCodes ?? []).join(",")}`;
    const group = groups.get(key);
    if (group) group.ids.push(row.id);
    else groups.set(key, { stamp, ids: [row.id] });
  }

  for (const { stamp, ids } of groups.values()) {
    await db
      .update(jobPostings)
      .set({ countryCodes: stamp.countryCodes, geoResolution: stamp.geoResolution })
      .where(inArray(jobPostings.id, ids));
  }
  return stamps;
}
