import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { resolve } from "node:path";

/**
 * Production migration runner. Uses drizzle-orm's runtime migrator (a prod
 * dependency) reading the committed SQL files in ../migrations — unlike
 * `db:migrate` (drizzle-kit), which is a devDependency and absent from a slim
 * deploy image. This is what Coolify's pre-deployment command runs:
 *   bun run packages/db/src/migrate.ts
 * Single connection (max: 1) as the migrator advises; exits non-zero on failure
 * so a broken migration aborts the deploy before the new container goes live.
 */
async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to run migrations");
  }
  const migrationsFolder = resolve(__dirname, "../migrations");
  const client = postgres(process.env.DATABASE_URL, { max: 1 });
  try {
    await migrate(drizzle(client), { migrationsFolder });
    console.log(`Migrations applied from ${migrationsFolder}`);
  } finally {
    await client.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
