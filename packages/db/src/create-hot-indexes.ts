/**
 * Build the plain indexes of 0084 without taking a write lock.
 *
 * WHY THIS EXISTS. The prod migrator (src/migrate.ts) runs every migration file
 * inside a transaction, and `CREATE INDEX CONCURRENTLY` is illegal there — so any
 * index added to an already-populated table would hold an ACCESS SHARE-blocking
 * lock for the whole build during Coolify's mandatory pre-deploy migration step
 * (`code:PER-53`). `changes` and `signals` are the two largest tables in the
 * schema; on those, that is a stalled worker fleet or a timed-out deploy.
 *
 * So: run this FIRST, against the same DATABASE_URL, while the app keeps serving.
 * Migration 0084 creates the same four indexes with IF NOT EXISTS and therefore
 * finds them already built and does nothing. On a fresh or small environment,
 * skip this entirely — the migration's own CREATE INDEX is instant on an empty
 * table and the end state is the same.
 *
 * The definitions below are byte-identical to 0084's. They have to be: an index
 * built here under a name the migration also uses is the migration's no-op, and a
 * divergent definition would silently ship the wrong index.
 *
 *   DATABASE_URL=... bun run src/create-hot-indexes.ts           # dry run
 *   DATABASE_URL=... bun run src/create-hot-indexes.ts --apply
 *
 * Idempotent (IF NOT EXISTS) and safe to re-run. If a previous run was
 * interrupted, Postgres leaves the index INVALID; this script reports those and
 * drops them before rebuilding, which is the documented recovery.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";
import postgres from "postgres";

const rootEnv = resolve(__dirname, "../../../.env.local");
if (existsSync(rootEnv)) config({ path: rootEnv });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const APPLY = process.argv.includes("--apply");

/** name → the CREATE INDEX body, verbatim from migrations/0084_zippy_luminals.sql. */
const INDEXES: Record<string, string> = {
  changes_snapshot_before_idx: `ON "changes" USING btree ("snapshot_before_id")`,
  signals_product_ids_gin: `ON "signals" USING gin ("product_ids")`,
  audit_log_created_idx: `ON "audit_log" USING btree ("created_at")`,
  ai_quality_checks_created_idx: `ON "ai_quality_checks" USING btree ("created_at")`,
};

// One connection, no pool: CONCURRENTLY must not run inside a transaction, and a
// pooled statement_timeout would kill a long build (see the Neon note in
// docs/deployment.md — only SET LOCAL applies inside a transaction, so the timeout
// is cleared per-session here).
const sql = postgres(url, { max: 1 });

async function main(): Promise<void> {
  const state = await sql<{ indexname: string; indisvalid: boolean }[]>`
    SELECT i.relname AS indexname, x.indisvalid
    FROM pg_class i
    JOIN pg_index x ON x.indexrelid = i.oid
    WHERE i.relname = ANY(${Object.keys(INDEXES)})`;
  const existing = new Map(state.map((r) => [r.indexname, r.indisvalid]));

  for (const [name, body] of Object.entries(INDEXES)) {
    const valid = existing.get(name);
    if (valid === true) {
      console.log(`${name}: already built, skipping`);
      continue;
    }
    if (valid === false) {
      // A CONCURRENTLY build that was interrupted leaves a permanently INVALID
      // index behind: it costs write amplification and serves no read.
      console.log(`${name}: INVALID from an interrupted build, dropping first`);
      if (APPLY) await sql.unsafe(`DROP INDEX CONCURRENTLY IF EXISTS "${name}"`);
    }
    console.log(`${name}: CREATE INDEX CONCURRENTLY ${body}`);
    if (!APPLY) continue;
    const started = Date.now();
    await sql.unsafe(`SET statement_timeout = 0`);
    await sql.unsafe(`CREATE INDEX CONCURRENTLY IF NOT EXISTS "${name}" ${body}`);
    console.log(`  built in ${Math.round((Date.now() - started) / 1000)}s`);
  }

  await sql.end();
  if (!APPLY) console.log("\nDry run. Re-run with --apply to build.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
