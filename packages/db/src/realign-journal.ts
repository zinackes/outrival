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
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { config } from "dotenv";
import postgres from "postgres";

const rootEnv = resolve(__dirname, "../../../.env.local");
if (existsSync(rootEnv)) config({ path: rootEnv });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const APPLY = process.argv.includes("--apply");

const migrationsDir = resolve(__dirname, "../migrations");
const journal = JSON.parse(
  readFileSync(resolve(migrationsDir, "meta/_journal.json"), "utf8"),
) as { entries: Array<{ tag: string; when: number }> };

const sql = postgres(url, { max: 1 });

async function main(): Promise<void> {
  const byHash = new Map<string, { tag: string; when: number }>();
  for (const entry of journal.entries) {
    const file = resolve(migrationsDir, `${entry.tag}.sql`);
    if (!existsSync(file)) continue;
    byHash.set(createHash("sha256").update(readFileSync(file, "utf8")).digest("hex"), entry);
  }

  const rows = await sql<{ id: number; hash: string; created_at: string }[]>`
    SELECT id, hash, created_at FROM "drizzle"."__drizzle_migrations" ORDER BY id`;

  let drifted = 0;
  for (const row of rows) {
    const entry = byHash.get(row.hash);
    if (!entry) continue; // a row whose SQL file is gone: not ours to touch
    if (Number(row.created_at) === entry.when) continue;
    drifted++;
    console.log(`${entry.tag}: created_at ${row.created_at} -> ${entry.when}`);
    if (APPLY) {
      await sql`
        UPDATE "drizzle"."__drizzle_migrations"
        SET created_at = ${entry.when} WHERE id = ${row.id}`;
    }
  }

  await sql.end();
  if (drifted === 0) {
    console.log("Ledger already agrees with the journal — nothing to do.");
    return;
  }
  console.log(
    APPLY
      ? `Realigned ${drifted} row(s).`
      : `${drifted} row(s) drifted. Re-run with --apply to write.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
