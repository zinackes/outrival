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
    // Cap every analytics read at 10s. These best-effort reads are the heavy
    // ones (LATERAL, timeline, window functions over the org's whole history);
    // with no ceiling one slow scan pins a pooled connection for 30s+ and a few
    // of them starve the shared 10-conn pool (API-wide latency spike). SET LOCAL
    // is the only cap that survives Neon's transaction-mode pooler — a
    // connection-level statement_timeout is silently stripped, and it is scoped
    // to this transaction so it never leaks to another pooled session. A timed
    // out query throws → caught below → same best-effort [] contract as any
    // other failure. The relational hot path (which never routes through here)
    // is untouched.
    const rows = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL statement_timeout = 10000`);
      return await tx.execute(query);
    });
    return { ok: true, rows: rows as unknown as T[] };
  } catch (err) {
    logger.error({ err }, "analytics query failed");
    return { ok: false, rows: [] };
  }
}

// Re-export sql so call sites can build queries from a single import.
export { sql };
