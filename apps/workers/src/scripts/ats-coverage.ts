// The shopping list for the next ATS adapters (Hiring Intelligence v2 P4).
//
// `ats_coverage_gaps` holds one row per (platform, competitor), upserted on every
// jobs run: which platform the board sits on, how it was read, and how many
// postings it carries. This reads it back as a ranking, so the answer to "which
// adapter is worth writing next" is a number rather than a hunch.
//
// The ranking key is OCCURRENCES x JOB_COUNT, because both halves matter on their
// own and neither is sufficient. A platform hosting thirty competitors with three
// roles each is a lot of boards and very little hiring data; one enterprise board
// with four hundred postings is the opposite. Their product is the amount of
// hiring signal an adapter would actually unlock.
//
// Rows already resolving through an API adapter are shown separately and never
// ranked: they are coverage that exists, not a gap. `json_ld` rows are the middle
// state — the generic rung reads them today with no AI, so they are worth an
// adapter only when a platform is both large AND badly served by the markup.
//
//   pnpm ats:coverage                  # ranked gaps
//   pnpm ats:coverage -- --all         # include what is already covered
//   pnpm ats:coverage -- --limit 30
//
// Read-only: it never writes. Runs against whatever DATABASE_URL is loaded.

import { desc, sql } from "drizzle-orm";
import { db, atsCoverageGaps } from "@outrival/db";

const SHOW_ALL = process.argv.includes("--all");
const limitFlag = process.argv.indexOf("--limit");
const LIMIT = limitFlag > -1 ? Number(process.argv[limitFlag + 1]) || 20 : 20;

interface PlatformRow {
  platform: string;
  resolution: string;
  competitors: number;
  jobs: number;
  occurrences: number;
  lastSeen: Date;
  sampleHost: string;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}

function padLeft(s: string, n: number): string {
  return s.length >= n ? s : " ".repeat(n - s.length) + s;
}

function printTable(title: string, rows: PlatformRow[]): void {
  console.log(`\n${title}`);
  if (rows.length === 0) {
    console.log("  (nothing recorded yet — the counter fills as jobs monitors run)");
    return;
  }
  console.log(
    `  ${pad("PLATFORM", 16)} ${pad("READ AS", 12)} ${padLeft("COMPS", 6)} ${padLeft("JOBS", 6)} ` +
      `${padLeft("RUNS", 6)} ${padLeft("WEIGHT", 8)}  ${pad("EXAMPLE HOST", 34)} LAST SEEN`,
  );
  for (const r of rows) {
    console.log(
      `  ${pad(r.platform, 16)} ${pad(r.resolution, 12)} ${padLeft(String(r.competitors), 6)} ` +
        `${padLeft(String(r.jobs), 6)} ${padLeft(String(r.occurrences), 6)} ` +
        `${padLeft(String(r.occurrences * r.jobs), 8)}  ${pad(r.sampleHost, 34)} ` +
        `${r.lastSeen.toISOString().slice(0, 10)}`,
    );
  }
}

async function main() {
  // Grouped by (platform, resolution): the same platform can legitimately appear
  // twice — some of its boards readable through markup, some not — and collapsing
  // those into one line would hide exactly the split that decides the adapter.
  const rows = await db
    .select({
      platform: atsCoverageGaps.platform,
      resolution: atsCoverageGaps.resolution,
      competitors: sql<number>`count(*)::int`,
      jobs: sql<number>`sum(${atsCoverageGaps.jobCount})::int`,
      occurrences: sql<number>`sum(${atsCoverageGaps.occurrences})::int`,
      lastSeen: sql<Date>`max(${atsCoverageGaps.lastSeenAt})`,
      sampleHost: sql<string>`min(${atsCoverageGaps.host})`,
    })
    .from(atsCoverageGaps)
    .groupBy(atsCoverageGaps.platform, atsCoverageGaps.resolution)
    .orderBy(desc(sql`sum(${atsCoverageGaps.occurrences}) * sum(${atsCoverageGaps.jobCount})`));

  const all: PlatformRow[] = rows.map((r) => ({
    platform: r.platform,
    resolution: r.resolution,
    competitors: r.competitors,
    jobs: r.jobs ?? 0,
    occurrences: r.occurrences ?? 0,
    lastSeen: new Date(r.lastSeen),
    sampleHost: r.sampleHost ?? "",
  }));

  const gaps = all.filter((r) => r.resolution !== "api_adapter");
  printTable("Gaps — no API adapter, ranked by runs x postings:", gaps.slice(0, LIMIT));

  if (SHOW_ALL) {
    printTable(
      "Covered — resolved by a hand-written API adapter:",
      all.filter((r) => r.resolution === "api_adapter").slice(0, LIMIT),
    );
  }

  const unread = all.filter((r) => r.resolution === "none");
  if (unread.length > 0) {
    console.log(
      `\n${unread.reduce((n, r) => n + r.competitors, 0)} board(s) resolve NOTHING today — ` +
        `those are broken reads, not missing adapters.`,
    );
  }
  console.log("");
}

// Not top-level await: this package compiles as CommonJS, and the sibling
// one-shots settle the promise the same way.
main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
