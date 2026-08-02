// One-shot messaging timeline from the snapshots we already hold (Positioning
// Intelligence v2 P1).
//
// The live writer only records versions from the day it ships, so on its own the
// timeline starts empty and takes a year of scrapes to say anything. Every
// homepage capture we ever took is still in R2, and since patch-16 most of them
// carry their parsed structure on the snapshot row — so the history can simply be
// read back. Zero re-scrapes: the competitor's site is never touched.
//
// The work itself lives in ../lib/messaging-backfill so it can be tested against a
// real database; this file is the loop and the console output.
//
//   pnpm backfill:messaging                          # every competitor, dry run
//   pnpm backfill:messaging -- --apply               # write
//   pnpm backfill:messaging -- --apply --competitor <id>
//   pnpm backfill:messaging -- --apply --max-r2 40   # per-competitor R2 parse cap
//
// It lives in @outrival/workers rather than /scripts because it needs the
// workspace dependencies (db + shared + scrapers + R2).
//
// Runs against whatever DATABASE_URL is loaded. On a shared environment, read
// .claude/rules/production.md first.

import { eq, isNull } from "drizzle-orm";
import { db, competitors } from "@outrival/db";
import {
  backfillMessagingVersions,
  BACKFILL_MAX_R2_PARSES,
} from "../lib/messaging-backfill";

const APPLY = process.argv.includes("--apply");
const idFlag = process.argv.indexOf("--competitor");
const ONLY = idFlag > -1 ? process.argv[idFlag + 1] : null;
const r2Flag = process.argv.indexOf("--max-r2");
const MAX_R2_PARSES = r2Flag > -1 ? Number(process.argv[r2Flag + 1]) : BACKFILL_MAX_R2_PARSES;

async function main() {
  const targets = ONLY
    ? await db
        .select({ id: competitors.id, name: competitors.name })
        .from(competitors)
        .where(eq(competitors.id, ONLY))
    : await db
        .select({ id: competitors.id, name: competitors.name })
        .from(competitors)
        .where(isNull(competitors.deletedAt));

  console.log(
    `${APPLY ? "Applying" : "Dry run"} — ${targets.length} competitor(s), ` +
      `up to ${MAX_R2_PARSES} R2 parses each\n`,
  );

  let totalVersions = 0;
  let totalWritten = 0;
  for (const competitor of targets) {
    const result = await backfillMessagingVersions(competitor.id, {
      apply: APPLY,
      maxR2Parses: MAX_R2_PARSES,
    });
    if (result.versions.length === 0) continue;
    totalVersions += result.versions.length;
    totalWritten += result.inserted;

    const first = result.versions[0];
    const last = result.versions[result.versions.length - 1];
    console.log(
      `${competitor.name} — ${result.versions.length} version(s) from ` +
        `${result.parsed}/${result.captures} captures` +
        (result.fetched > 0 ? ` (${result.fetched} read from R2)` : ""),
    );
    console.log(
      `   oldest  ${first?.capturedAt.toISOString().slice(0, 10)}  ${first?.copy.headline}`,
    );
    console.log(
      `   newest  ${last?.capturedAt.toISOString().slice(0, 10)}  ${last?.copy.headline}`,
    );
  }

  console.log(
    `\n${totalVersions} version(s) planned` + (APPLY ? `, ${totalWritten} inserted` : " (dry run)"),
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
