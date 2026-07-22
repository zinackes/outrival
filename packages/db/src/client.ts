import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const client = postgres(process.env.DATABASE_URL!, {
  max: 10,
  // The API is a long-running process (VPS), not serverless: closing idle
  // connections every 20s only forces a TCP/TLS reconnect on the next request.
  // Keep the pool warm across a browsing session; 300s aligns with Neon's
  // compute autosuspend, past which a held connection buys nothing anyway.
  // (Killing the actual cold-start wake is a Neon-console setting, not this.)
  idle_timeout: 300,
  // Sized for a Neon cold start, not for a warm connect. idle_timeout above and
  // Neon's autosuspend sit on the same ~5-minute scale, and the hourly crons are the
  // only traffic on the worker boxes — so every schedule-scraping fire opens the first
  // connection after an hour idle, which is exactly the one that has to wake the
  // compute. At 10s that raced the wake and lost: ~25% of fires died on CONNECT_TIMEOUT,
  // skipping whole hours of scraping. Only connection ESTABLISHMENT is bounded here
  // (queries are not), and a warm pool never reaches this path, so the longer ceiling
  // costs the API nothing on the requests that matter and turns its one cold request
  // from a failure into a slow success.
  connect_timeout: 30,
});

export const db = drizzle(client, { schema });
export type DB = typeof db;
