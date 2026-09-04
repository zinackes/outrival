import { describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { sqlTimestamp } from "../src/sql";

const dialect = new PgDialect();

describe("sqlTimestamp", () => {
  // The regression this exists for: a Date reaches postgres-js as an object once
  // drizzle has replaced its serializers, and the statement dies on the wire.
  test("binds the Date as an ISO string, never as an object", () => {
    const q = dialect.sqlToQuery(
      sql`select 1 where a < ${sqlTimestamp(new Date("2026-09-04T12:34:56.789Z"))}`,
    );
    expect(q.params).toEqual(["2026-09-04T12:34:56.789Z"]);
  });

  // Deliberately uncast: the parameter must stay untyped so Postgres resolves it from
  // the comparison. A `::timestamptz` would shift every `timestamp` column by the
  // session TimeZone, a `::timestamp` would drop the offset of every timestamptz one.
  test("emits a bare parameter with no cast", () => {
    const q = dialect.sqlToQuery(sql`select ${sqlTimestamp(new Date(0))}`);
    expect(q.sql).toBe("select $1");
  });
});
