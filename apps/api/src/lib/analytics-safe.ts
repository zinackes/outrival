import { sql, type SQL } from "drizzle-orm";
import { logger } from "@outrival/shared";
import { db } from "./db";

// Best-effort analytics read against Postgres. These tables used to live in
// ClickHouse; they are now plain Postgres tables in the same Neon database.
// Returns [] on any error so an analytics hiccup never breaks a request handler
// (preserves the old "return [] when the store is down" contract). The cold-start
// timeout race the ClickHouse helper needed is gone — it's the same DB now.
export async function analyticsQuery<T>(query: SQL): Promise<T[]> {
  return (await analyticsQueryResult<T>(query)).rows;
}

// Same best-effort read, but keeps the failure/empty distinction the bare
// analyticsQuery throws away. Lets a handler tell the UI "temporarily unavailable"
// (ok=false) apart from "no data yet" (ok=true, rows=[]). Opt-in: existing callers
// keep using analyticsQuery unchanged.
export async function analyticsQueryResult<T>(
  query: SQL,
): Promise<{ ok: boolean; rows: T[] }> {
  try {
    const rows = await db.execute(query);
    return { ok: true, rows: rows as unknown as T[] };
  } catch (err) {
    logger.error({ err }, "analytics query failed");
    return { ok: false, rows: [] };
  }
}

// Re-export sql so call sites can build queries from a single import.
export { sql };
