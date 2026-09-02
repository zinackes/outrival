/**
 * Realign drizzle's ledger with the journal's timestamps.
 *
 * WHY THIS EXISTS. `drizzle-kit generate` stamps each journal entry with the
 * generating machine's clock, and the runtime migrator decides what to apply with
 * a single comparison:
 *
 *     Number(lastDbMigration.created_at) < migration.folderMillis
 *
 * where `lastDbMigration` is the row with the HIGHEST created_at. So a migration
 * generated on a machine whose clock trails another contributor's gets a `when`
 * BELOW an already-applied migration, and the migrator skips it — silently, while
 * still printing "Migrations applied". That is exactly how 0062 was generated
 * behind 0060/0061 (whose entries carry a clock a day ahead) and did nothing on
 * production. The fix is to bump the new entry's `when` past the last one; this
 * script is what then keeps environments that ALREADY ran it from re-running it.
 *
 * It rewrites `created_at` for rows whose hash matches a journal entry, and does
 * nothing else. Non-destructive and idempotent: it only ever touches drizzle's
 * bookkeeping table (never a business table), and a second run reports 0 changes.
 *
 *   DATABASE_URL=... bun run src/realign-journal.ts           # dry run
 *   DATABASE_URL=... bun run src/realign-journal.ts --apply
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";
import postgres from "postgres";
import { compareLedger, readCommittedMigrations } from "./ledger";

const rootEnv = resolve(__dirname, "../../../.env.local");
if (existsSync(rootEnv)) config({ path: rootEnv });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const APPLY = process.argv.includes("--apply");

const { committed } = readCommittedMigrations(resolve(__dirname, "../migrations"));

const sql = postgres(url, { max: 1 });

async function main(): Promise<void> {
  const rows = await sql<{ id: number; hash: string; created_at: string }[]>`
    SELECT id, hash, created_at FROM "drizzle"."__drizzle_migrations" ORDER BY id`;

  // `misdated` is exactly the repairable set: rows whose hash IS one of ours but whose
  // timestamp no longer matches the journal. Rows matching nothing we hold land in
  // `drift` and are deliberately left alone — not ours to touch.
  const { misdated } = compareLedger(committed, rows);
  for (const m of misdated) {
    console.log(`${m.tag}: created_at ${m.was} -> ${m.now}`);
    if (APPLY) {
      await sql`
        UPDATE "drizzle"."__drizzle_migrations"
        SET created_at = ${m.now} WHERE id = ${m.row.id}`;
    }
  }

  await sql.end();
  if (misdated.length === 0) {
    console.log("Ledger already agrees with the journal — nothing to do.");
    return;
  }
  console.log(
    APPLY
      ? `Realigned ${misdated.length} row(s).`
      : `${misdated.length} row(s) drifted. Re-run with --apply to write.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
