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
  connect_timeout: 10,
});

export const db = drizzle(client, { schema });
export type DB = typeof db;
