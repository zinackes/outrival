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

// ONE PGlite for the whole process, migrated once.
//
// bun test runs every file of a package in a SINGLE process, and a PGlite instance is
// a WebAssembly linear memory that close() cannot hand back to the OS — and each test
// file's module scope keeps its own instance reachable for the whole run, so the GC
// cannot collect it either. One instance per file therefore accumulated: this suite
// peaked at 3.3 GB, apps/api at 7.1 GB, which is what saturated an 8 GB WSL2 VM.
//
// Isolation is preserved by truncating instead of re-instantiating: every caller gets
// the same empty-but-migrated database the old per-file instance handed out. The reset
// runs on ACQUIRE, not on close, so a file that dies before its afterAll still cannot
// leak rows into the next one.
let shared: { client: PGlite; db: TestDb } | null = null;

// Migrations live in the `drizzle` schema, so wiping `public` keeps them applied.
const TRUNCATE_PUBLIC = `
  DO $$
  DECLARE stmt text;
  BEGIN
    SELECT 'TRUNCATE TABLE ' || string_agg(format('%I.%I', schemaname, tablename), ', ')
           || ' RESTART IDENTITY CASCADE'
      INTO stmt
      FROM pg_tables WHERE schemaname = 'public';
    IF stmt IS NOT NULL THEN EXECUTE stmt; END IF;
  END $$;
`;

export async function makeTestDb(): Promise<TestHarness> {
  if (!shared) {
    const client = new PGlite();
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS });
    shared = { client, db: drizzle(client, { schema }) };
  } else {
    await shared.client.exec(TRUNCATE_PUBLIC);
  }
  // Files keep their afterAll close(): closing the shared instance would pull the DB
  // out from under the next file, so teardown is a no-op. test/setup.ts (preloaded
  // via bunfig.toml) closes it once when the whole run ends — an open WASM client
  // makes bun exit 99 even with every test passing.
  return { db: shared.db, close: async () => {} };
}

/** Called once per process by the preloaded test/setup.ts, never by a test file. */
export async function closeSharedDb(): Promise<void> {
  const open = shared;
  shared = null;
  await open?.client.close();
}
