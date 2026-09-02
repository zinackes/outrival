/**
 * The fields that say *why* a query failed, pulled out of the error drizzle throws.
 *
 * `DrizzleQueryError` renders as `Failed query: <sql>` and hangs the driver's real
 * error off `cause`. Sentry follows that chain, but a linked exception keeps only a
 * name, a message and a stack — so the SQLSTATE code and the routine that raised it,
 * the two fields that actually name the failure mode, never leave the process. That
 * is why ~859 `Failed query` events over 30 days could not be told apart (OUT-258,
 * audit gap sweep): a prepared statement missing on the backend the Neon pooler
 * handed us, a statement timeout and an exhausted pool all arrive under one title.
 *
 * The whitelist is deliberate. postgres.js copies the entire ErrorResponse onto the
 * error object, and `detail`, `hint`, `where` and `internal_query` quote the
 * offending row ("Key (email)=(…) already exists"). Those carry user data and stay
 * where they are.
 */
export interface QueryFailure {
  /** SQLSTATE (`42P05`), or a postgres.js transport code (`CONNECT_TIMEOUT`). */
  code: string;
  /** `ERROR` / `FATAL` / `PANIC`, verbatim from Postgres. */
  severity?: string;
  /**
   * The C routine that raised it — the most precise label Postgres gives.
   * `FetchPreparedStatement` is the signature of a named prepared statement missing
   * on the connection the pooler handed back; postgres.js retries that one once by
   * itself, so seeing it here means the retry failed too.
   */
  routine?: string;
  constraint?: string;
  table?: string;
  column?: string;
  schema?: string;
}

/** Longer than any chain drizzle builds; a guard against a cause cycle, not a budget. */
const MAX_DEPTH = 8;

/**
 * Walks `err.cause` down to the first error carrying a driver code and returns the
 * safe half of it, or null when nothing in the chain is a database error. Pure: the
 * Sentry `beforeSend` hooks in `apps/api` and `apps/workers` are the only callers.
 */
export function queryFailure(err: unknown): QueryFailure | null {
  const seen = new Set<unknown>();
  let cursor: unknown = err;
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    if (typeof cursor !== "object" || cursor === null || seen.has(cursor)) return null;
    seen.add(cursor);
    const source = cursor as Record<string, unknown>;
    const code = source.code;
    if (typeof code === "string" && code) {
      const failure: QueryFailure = { code };
      const text = (value: unknown) => (typeof value === "string" && value ? value : undefined);
      const severity = text(source.severity);
      const routine = text(source.routine);
      const constraint = text(source.constraint_name);
      const table = text(source.table_name);
      const column = text(source.column_name);
      const schema = text(source.schema_name);
      if (severity) failure.severity = severity;
      if (routine) failure.routine = routine;
      if (constraint) failure.constraint = constraint;
      if (table) failure.table = table;
      if (column) failure.column = column;
      if (schema) failure.schema = schema;
      return failure;
    }
    cursor = source.cause;
  }
  return null;
}
