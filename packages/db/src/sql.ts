import { sql, type SQL } from "drizzle-orm";

/**
 * Bind a `Date` as a parameter of a raw `sql` template.
 *
 * Drizzle swaps postgres-js's own type serializers for an identity function, so a
 * `Date` interpolated straight into a `sql` tag reaches the wire as an object and the
 * statement dies with `could not determine data type of parameter`. The query BUILDER
 * is unaffected (`gt(table.col, date)` goes through the column's mapper); only raw
 * `sql` is. PGlite serializes Dates happily, which is why the suite stayed green while
 * two workers 500'd in production (audit 2026-09-04, P-01/P-02, guard Q-06).
 *
 * The parameter is left untyped on purpose: Postgres resolves it from the comparison,
 * so this is correct against both `timestamp` and `timestamptz` columns. Casting to
 * either one would shift the other by the session's TimeZone.
 */
export function sqlTimestamp(value: Date): SQL {
  return sql`${value.toISOString()}`;
}
