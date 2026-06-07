/**
 * One-shot baseline for the push → migrate transition.
 *
 * Production was built with `drizzle-kit push`, so every table already exists.
 * Running `drizzle-kit migrate` against it would try to CREATE those tables and
 * fail. This marks every already-generated migration as applied WITHOUT running
 * it, so the next `db:migrate` only applies FUTURE migrations.
 *
 * Non-destructive + idempotent: it only writes drizzle's bookkeeping table
 * (drizzle.__drizzle_migrations), never a business table, and is a no-op once any
 * migration is tracked. Run once per existing environment: `pnpm db:baseline`.
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

const migrationsDir = resolve(__dirname, "../migrations");
const journal = JSON.parse(
  readFileSync(resolve(migrationsDir, "meta/_journal.json"), "utf8"),
) as { entries: Array<{ tag: string; when: number }> };

const sql = postgres(url, { max: 1 });

async function main(): Promise<void> {
  await sql`CREATE SCHEMA IF NOT EXISTS "drizzle"`;
  await sql`
    CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )`;

  const [row] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM "drizzle"."__drizzle_migrations"`;
  if ((row?.n ?? 0) > 0) {
    console.log(`Already tracked (${row?.n} migration(s)) — nothing to baseline.`);
    await sql.end();
    return;
  }

  for (const entry of journal.entries) {
    const file = resolve(migrationsDir, `${entry.tag}.sql`);
    const hash = createHash("sha256").update(readFileSync(file, "utf8")).digest("hex");
    await sql`
      INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at)
      VALUES (${hash}, ${entry.when})`;
    console.log(`baselined ${entry.tag} (when=${entry.when})`);
  }

  await sql.end();
  console.log(
    "Baseline complete — db:migrate now skips these and applies only new migrations.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
