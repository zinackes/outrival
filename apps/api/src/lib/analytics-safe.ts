import { sql, type SQL } from "drizzle-orm";
import { logger } from "@outrival/shared";
import { db } from "./db";

// Best-effort analytics read against Postgres. These tables used to live in
// ClickHouse; they are now plain Postgres tables in the same Neon database.
// Returns [] on any error so an analytics hiccup never breaks a request handler
// (preserves the old "return [] when the store is down" contract). The cold-start
// timeout race the ClickHouse helper needed is gone — it's the same DB now.
export async function analyticsQuery<T>(query: SQL): Promise<T[]> {
  try {
    const rows = await db.execute(query);
    return rows as unknown as T[];
  } catch (err) {
    logger.error({ err }, "analytics query failed");
    return [];
  }
}

// Re-export sql so call sites can build queries from a single import.
export { sql };
