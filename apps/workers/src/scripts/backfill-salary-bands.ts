// One-shot history for the salary bands (Hiring Intelligence v2 P3).
//
// A scrape can only ever write the CURRENT week, so on the day P3 ships every
// competitor has exactly one point and the salary card has no shape to draw and the
// shift detector has no baseline to compare against. The past is recoverable
// though: `job_postings` keeps `detected_at` and `closed_at` on every posting we
// have ever seen, so the board as it stood in any past week can be reconstructed
// exactly, and banded with the SAME pure function the live path uses.
//
// IT NEVER EMITS A SIGNAL. It writes `hiring_salary_bands` rows and nothing else —
// no anchor monitor, no snapshot, no change, no enqueue. That is not an oversight
// to be fixed later: replaying six months of history through the detector would
// announce every pay move a competitor ever made, all at once, as news. A test
// asserts this file has no path to a signal.
//
// Idempotent: the upsert is keyed by (competitor, bucket, currency, ISO week), so a
// second run rewrites identical rows.
//
//   pnpm backfill:salary-bands                          # every competitor, dry run
//   pnpm backfill:salary-bands -- --apply               # write
//   pnpm backfill:salary-bands -- --apply --weeks 26
//   pnpm backfill:salary-bands -- --apply --competitor <id>
//
// It lives in @outrival/workers rather than /scripts because it needs the workspace
// dependencies (db + scrapers), which the repo root has no node_modules for.
//
// Runs against whatever DATABASE_URL is loaded. On a shared environment, read
// .claude/rules/production.md first.

import { and, eq, isNull, sql } from "drizzle-orm";
import { db, competitors, jobPostings, hiringSalaryBands } from "@outrival/db";
import {
  isoWeekStart,
  tallySalaryBands,
  wasActiveInWeek,
  weeksBack,
} from "@outrival/scrapers/jobs-hiring";

const APPLY = process.argv.includes("--apply");
const idFlag = process.argv.indexOf("--competitor");
const ONLY = idFlag > -1 ? process.argv[idFlag + 1] : null;
const weeksFlag = process.argv.indexOf("--weeks");
/** How far back to reconstruct. 26 weeks is half a year of shape on the sparkline. */
const WEEKS = weeksFlag > -1 ? Number(process.argv[weeksFlag + 1]) : 26;

interface PostingRow {
  department: string | null;
  title: string;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: string | null;
  detectedAt: Date;
  closedAt: Date | null;
}

/**
 * Rebuild every week of one competitor's bands. Returns how many (bucket, currency,
 * week) rows the reconstruction produced.
 */
async function backfillCompetitor(competitorId: string, weeks: string[]): Promise<number> {
  // Only postings that ever carried pay can contribute to a band, so the read is
  // narrowed to those — on a big board that is a small fraction of the rows.
  const postings: PostingRow[] = await db
    .select({
      department: jobPostings.department,
      title: jobPostings.title,
      salaryMin: jobPostings.salaryMin,
      salaryMax: jobPostings.salaryMax,
      salaryCurrency: jobPostings.salaryCurrency,
      salaryPeriod: jobPostings.salaryPeriod,
      detectedAt: jobPostings.detectedAt,
      closedAt: jobPostings.closedAt,
    })
    .from(jobPostings)
    .where(
      and(
        eq(jobPostings.competitorId, competitorId),
        sql`(${jobPostings.salaryMin} is not null or ${jobPostings.salaryMax} is not null)`,
      ),
    );
  if (postings.length === 0) return 0;

  const rows: Array<typeof hiringSalaryBands.$inferInsert> = [];
  const now = new Date();
  for (const weekStart of weeks) {
    const active = postings.filter((p) => wasActiveInWeek(p, weekStart));
    if (active.length === 0) continue;
    for (const band of tallySalaryBands(active)) {
      rows.push({
        competitorId,
        departmentBucket: band.bucket,
        currency: band.currency,
        p25: band.p25,
        p50: band.p50,
        p75: band.p75,
        n: band.n,
        weekStart,
        recordedAt: now,
      });
    }
  }
  if (rows.length === 0 || !APPLY) return rows.length;

  // Chunked: a competitor with a long history and several currencies can produce a
  // few hundred rows, and one oversized INSERT is the only way this script can fail.
  for (let i = 0; i < rows.length; i += 500) {
    await db
      .insert(hiringSalaryBands)
      .values(rows.slice(i, i + 500))
      .onConflictDoUpdate({
        target: [
          hiringSalaryBands.competitorId,
          hiringSalaryBands.departmentBucket,
          hiringSalaryBands.currency,
          hiringSalaryBands.weekStart,
        ],
        set: {
          p25: sql`excluded.p25`,
          p50: sql`excluded.p50`,
          p75: sql`excluded.p75`,
          n: sql`excluded.n`,
          recordedAt: sql`excluded.recorded_at`,
        },
      });
  }
  return rows.length;
}

async function main(): Promise<void> {
  const targets = await db
    .select({ id: competitors.id, name: competitors.name })
    .from(competitors)
    .where(ONLY ? eq(competitors.id, ONLY) : isNull(competitors.deletedAt));

  const weeks = weeksBack(isoWeekStart(new Date()), WEEKS);
  let totalRows = 0;
  let boards = 0;

  for (const c of targets) {
    const written = await backfillCompetitor(c.id, weeks);
    if (written > 0) {
      totalRows += written;
      boards++;
      console.log(`${c.name}: ${written} band rows across ${weeks.length} weeks`);
    }
  }

  console.log(
    `\n${APPLY ? "APPLIED" : "DRY RUN"} — ${targets.length} competitors scanned, ` +
      `${boards} with disclosed pay, ${totalRows} band rows over the last ${WEEKS} weeks.`,
  );
  if (!APPLY) console.log("Re-run with --apply to write.");
}

// Not top-level await: this package compiles as CommonJS, and the sibling one-shots
// (backfill-hiring-geo.ts, packages/db/src/migrate.ts) settle the promise the same way.
main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
