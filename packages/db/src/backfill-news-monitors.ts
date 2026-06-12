/**
 * One-shot backfill: seed the internal `news` monitor on EXISTING competitors.
 *
 * The news/funding source (commit eb262a6) is only seeded at competitor creation
 * (POST /competitors + add-from-candidate), so competitors created before it have
 * no `news` monitor and never get company-level events in their signal feed. This
 * adds one weekly `news` monitor to every eligible existing competitor.
 *
 * Eligible = real competitor (type != 'self'), not soft-deleted, has a URL (the
 * news scraper derives the brand from the URL — a null URL can't be searched).
 *
 * Matches the creation seed exactly: only competitor_id/source_type/frequency are
 * set; isActive (true), next_run_at (null → picked at the next schedule-scraping
 * tick) and created_at come from DB defaults. The id needs an explicit value
 * because monitors.id's default is a Drizzle $defaultFn (JS-side), not a DB
 * default — gen_random_uuid()::text mirrors it.
 *
 * Non-destructive + idempotent: NOT EXISTS guards against double-seeding, so a
 * re-run inserts 0 rows. Run once per environment: `pnpm --filter @outrival/db db:backfill-news`.
 */
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { config } from "dotenv";
import postgres from "postgres";

const rootEnv = resolve(__dirname, "../../../.env.local");
if (existsSync(rootEnv)) config({ path: rootEnv });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

const sql = postgres(url, { max: 1 });

async function main(): Promise<void> {
  const [before] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n
    FROM competitors c
    WHERE c.type <> 'self'
      AND c.deleted_at IS NULL
      AND c.url IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM monitors m
        WHERE m.competitor_id = c.id AND m.source_type = 'news'
      )`;
  const eligible = before?.n ?? 0;
  console.log(`Eligible competitors missing a news monitor: ${eligible}`);
  if (eligible === 0) {
    await sql.end();
    console.log("Nothing to backfill — every eligible competitor already has news.");
    return;
  }

  const inserted = await sql`
    INSERT INTO monitors (id, competitor_id, source_type, frequency)
    SELECT gen_random_uuid()::text, c.id, 'news', 'weekly'
    FROM competitors c
    WHERE c.type <> 'self'
      AND c.deleted_at IS NULL
      AND c.url IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM monitors m
        WHERE m.competitor_id = c.id AND m.source_type = 'news'
      )
    RETURNING id`;

  await sql.end();
  console.log(
    `Backfill complete — seeded ${inserted.length} news monitor(s). ` +
      "They activate on the next schedule-scraping tick (next_run_at is null).",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
