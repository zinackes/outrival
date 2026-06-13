import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
// The @outrival/db barrel pulls client.ts (a postgres-js client). postgres.js
// connects lazily — building the client at import never opens a socket — so the
// barrel is safe to load here; tests swap `db` via mock.module, never the client.
import * as schema from "@outrival/db";

// In-process Postgres (PGlite, WASM) seeded with the real versioned migrations.
// Gives integration tests a genuine DB — same SQL, same constraints, same
// org-scoping behavior as prod — without Docker or a network Postgres.
export type TestDb = ReturnType<typeof drizzle<typeof schema>>;
export { schema };

export interface TestHarness {
  db: TestDb;
  /** Close PGlite in afterAll — an open WASM client makes bun exit non-zero. */
  close: () => Promise<void>;
}

const MIGRATIONS = resolve(import.meta.dir, "../../../packages/db/migrations");

export async function makeTestDb(): Promise<TestHarness> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return { db, close: () => client.close() };
}
