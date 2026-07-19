import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
// The @outrival/db barrel pulls client.ts (a postgres-js client). postgres.js
// connects lazily — building the client at import never opens a socket — so the
// barrel is safe to load here; tests swap `db` via mock.module, never the client.
import * as schema from "@outrival/db";

// In-process Postgres (PGlite, WASM) seeded with the real versioned migrations.
// Deliberately a COPY of apps/api/test/db-harness.ts rather than a shared import:
// the monorepo rules forbid cross-app imports, and a test harness is exactly the
// kind of thing each app should own. Keep the two in sync by hand if the shape
// changes (it hasn't since it was written).
export type TestDb = ReturnType<typeof drizzle<typeof schema>>;
export { schema };

export interface TestHarness {
  db: TestDb;
  /** Close PGlite in afterAll — an open WASM client makes bun exit non-zero. */
  close: () => Promise<void>;
}

const MIGRATIONS = resolve(import.meta.dir, "../../../packages/db/migrations");

// Migrating the full schema costs a few seconds. Run it ONCE, snapshot the
// migrated data dir, and hydrate every later instance from that snapshot — each
// file still gets an isolated (empty-but-migrated) PGlite, but only the first
// pays the migration cost.
let migratedTemplate: Blob | File | null = null;

export async function makeTestDb(): Promise<TestHarness> {
  let client: PGlite;
  if (migratedTemplate) {
    client = new PGlite({ loadDataDir: migratedTemplate });
  } else {
    client = new PGlite();
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS });
    migratedTemplate = await client.dumpDataDir();
  }
  const db = drizzle(client, { schema });
  return { db, close: () => client.close() };
}
