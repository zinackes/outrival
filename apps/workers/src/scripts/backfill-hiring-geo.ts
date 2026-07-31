// One-shot baseline for the hiring footprint (Hiring Intelligence v2 P2).
//
// Two things it does that a normal scrape cannot:
//
//  1. Stamps `country_codes` / `geo_resolution` on postings that already existed
//     when P2 shipped — including CLOSED ones. extract-jobs fills in the ACTIVE
//     board as it goes, but the closed history is what makes a country "already
//     seen", and without it the first run after deploy would announce a first role
//     in every country they have ever hired in.
//  2. Seeds hiring_geo for the CURRENT ISO week from the active board, so the
//     baseline the first_role_in_country signal measures against starts filling
//     immediately instead of one scrape cycle later.
//
// It never emits a signal and never writes a snapshot — it only fills columns.
// Idempotent: re-running stamps nothing new and re-upserts the same weekly rows.
//
//   pnpm backfill:hiring-geo                       # every competitor, dry run
//   pnpm backfill:hiring-geo -- --apply            # write
//   pnpm backfill:hiring-geo -- --apply --competitor <id>
//
// It lives in @outrival/workers rather than /scripts because it needs the
// workspace dependencies (db + shared/geo + scrapers), which the repo root has no
// node_modules for.
//
// Runs against whatever DATABASE_URL is loaded. On a shared environment, read
// .claude/rules/production.md first.

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, competitors, jobPostings } from "@outrival/db";
import { resolveLocation } from "@outrival/shared/geo";
import { hiringGeo } from "@outrival/db";
import { tallyHiringGeo, isoWeekStart } from "@outrival/scrapers/jobs-hiring";

const APPLY = process.argv.includes("--apply");
const idFlag = process.argv.indexOf("--competitor");
const ONLY = idFlag > -1 ? process.argv[idFlag + 1] : null;

/** Stamp every unstamped posting of one competitor. Returns the resolution tally. */
async function stampCompetitor(competitorId: string) {
  const rows = await db
    .select({ id: jobPostings.id, location: jobPostings.location })
    .from(jobPostings)
    .where(and(eq(jobPostings.competitorId, competitorId), isNull(jobPostings.geoResolution)));

  const tally = { country: 0, region: 0, remote: 0, unknown: 0 };
  // Group by the stamp so a board with 40 "Remote — EU" roles costs one UPDATE.
  const groups = new Map<string, { codes: string[] | null; resolution: string; ids: string[] }>();
  for (const row of rows) {
    const { countries, resolution } = resolveLocation(row.location);
    tally[resolution]++;
    const key = `${resolution}|${countries.join(",")}`;
    const group = groups.get(key);
    if (group) group.ids.push(row.id);
    else
      groups.set(key, {
        codes: countries.length > 0 ? countries : null,
        resolution,
        ids: [row.id],
      });
  }

  if (APPLY) {
    for (const g of groups.values()) {
      await db
        .update(jobPostings)
        .set({ countryCodes: g.codes, geoResolution: g.resolution })
        .where(inArray(jobPostings.id, g.ids));
    }
  }
  return { stamped: rows.length, tally };
}

/** Seed this ISO week's hiring_geo from the competitor's currently active board. */
async function seedWeek(competitorId: string): Promise<number> {
  const active = await db
    .select({
      countryCodes: jobPostings.countryCodes,
      geoResolution: jobPostings.geoResolution,
    })
    .from(jobPostings)
    .where(and(eq(jobPostings.competitorId, competitorId), eq(jobPostings.isActive, true)));
  if (active.length === 0) return 0;

  const counts = tallyHiringGeo(active);
  if (!APPLY) return counts.size;

  const now = new Date();
  await db
    .insert(hiringGeo)
    .values(
      [...counts].map(([countryCode, openCount]) => ({
        competitorId,
        countryCode,
        openCount,
        weekStart: isoWeekStart(now),
        recordedAt: now,
      })),
    )
    .onConflictDoUpdate({
      target: [hiringGeo.competitorId, hiringGeo.countryCode, hiringGeo.weekStart],
      set: { openCount: sql`excluded.open_count`, recordedAt: sql`excluded.recorded_at` },
    });
  return counts.size;
}

async function main(): Promise<void> {
  const targets = await db
    .select({ id: competitors.id, name: competitors.name, type: competitors.type })
    .from(competitors)
    .where(ONLY ? eq(competitors.id, ONLY) : isNull(competitors.deletedAt));

  const totals = { country: 0, region: 0, remote: 0, unknown: 0 };
  let stampedTotal = 0;
  let seeded = 0;

  for (const c of targets) {
    const { stamped, tally } = await stampCompetitor(c.id);
    const keys = await seedWeek(c.id);
    stampedTotal += stamped;
    seeded += keys > 0 ? 1 : 0;
    for (const k of Object.keys(totals) as Array<keyof typeof totals>) totals[k] += tally[k];
    if (stamped > 0 || keys > 0) {
      console.log(
        `${c.name}: stamped ${stamped} (country ${tally.country}, region ${tally.region}, ` +
          `remote ${tally.remote}, unknown ${tally.unknown}), ${keys} geo keys this week`,
      );
    }
  }

  const placed = totals.country;
  const total = placed + totals.region + totals.remote + totals.unknown;
  console.log(
    `\n${APPLY ? "APPLIED" : "DRY RUN"} — ${targets.length} competitors, ${stampedTotal} postings ` +
      `stamped, ${seeded} boards seeded for the current week.`,
  );
  console.log(
    `Resolution: ${placed} placed in a country` +
      (total > 0 ? ` (${Math.round((placed / total) * 100)}%)` : "") +
      `, ${totals.region} region-only, ${totals.remote} remote, ${totals.unknown} unresolved.`,
  );
  if (!APPLY) console.log("Re-run with --apply to write.");
}

// Not top-level await: this package compiles as CommonJS, and the sibling
// one-shots (packages/db/src/migrate.ts) settle the promise the same way.
main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
