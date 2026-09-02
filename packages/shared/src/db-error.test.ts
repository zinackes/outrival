import { describe, expect, test } from "bun:test";
import { queryFailure } from "./db-error";

// Shapes copied from the real classes: drizzle-orm 0.45 builds the message as
// `Failed query: <sql>\nparams: <params>` and puts the driver error on `cause`;
// postgres.js 3.4 `Object.assign`s the whole ErrorResponse onto a PostgresError,
// snake_case field names included.
function postgresError(fields: Record<string, unknown>): Error {
  return Object.assign(new Error(String(fields.message ?? "db error")), fields);
}

function drizzleQueryError(cause: unknown): Error {
  const err = new Error("Failed query: select * from users where id = $1\nparams: 42");
  err.name = "DrizzleQueryError";
  (err as Error & { cause?: unknown }).cause = cause;
  return err;
}

describe("queryFailure", () => {
  test("reaches the driver error through drizzle's wrapper", () => {
    const failure = queryFailure(
      drizzleQueryError(
        postgresError({
          severity: "ERROR",
          code: "26000",
          message: 'prepared statement "s1" does not exist',
          routine: "FetchPreparedStatement",
        }),
      ),
    );
    expect(failure).toEqual({ code: "26000", severity: "ERROR", routine: "FetchPreparedStatement" });
  });

  // The whole point of OUT-258: these three are one Sentry issue today because the
  // title is identical and nothing else survives the trip.
  test("tells the pooler, the timeout and the exhausted pool apart", () => {
    const codes = [
      postgresError({ code: "26000", routine: "FetchPreparedStatement" }),
      postgresError({ code: "57014", routine: "ProcessInterrupts" }),
      postgresError({ code: "53300", routine: "InitPostgres" }),
    ].map((cause) => queryFailure(drizzleQueryError(cause))?.code);
    expect(codes).toEqual(["26000", "57014", "53300"]);
  });

  test("keeps a transport failure, which carries a code but no SQLSTATE", () => {
    // postgres.js builds these itself (`Errors.connection`), so there is no
    // severity or routine — the code is the whole answer.
    const cause = Object.assign(new Error("write CONNECT_TIMEOUT db.neon.tech:5432"), {
      code: "CONNECT_TIMEOUT",
      errno: "CONNECT_TIMEOUT",
      address: "db.neon.tech",
    });
    expect(queryFailure(drizzleQueryError(cause))).toEqual({ code: "CONNECT_TIMEOUT" });
  });

  test("renames the constraint fields it keeps", () => {
    const failure = queryFailure(
      postgresError({
        code: "23505",
        severity: "ERROR",
        constraint_name: "signals_change_id_unique",
        table_name: "signals",
        column_name: "change_id",
        schema_name: "public",
      }),
    );
    expect(failure).toEqual({
      code: "23505",
      severity: "ERROR",
      constraint: "signals_change_id_unique",
      table: "signals",
      column: "change_id",
      schema: "public",
    });
  });

  // `detail` on a 23505 reads "Key (email)=(someone@example.com) already exists" —
  // the row itself. Sentry runs with sendDefaultPii false; this must not walk it back.
  test("never carries a field that quotes the offending row", () => {
    const failure = queryFailure(
      postgresError({
        code: "23505",
        detail: "Key (email)=(someone@example.com) already exists.",
        hint: "Try a different email.",
        where: "PL/pgSQL function f(text) line 3",
        internal_query: "select 1 from users where email = 'someone@example.com'",
        position: "42",
      }),
    );
    expect(failure).toEqual({ code: "23505" });
    expect(JSON.stringify(failure)).not.toContain("someone@example.com");
  });

  test("ignores an empty code rather than reporting a blank bucket", () => {
    expect(queryFailure(postgresError({ code: "" }))).toBeNull();
  });

  test("answers null for anything that is not a database error", () => {
    expect(queryFailure(new Error("boom"))).toBeNull();
    expect(queryFailure(drizzleQueryError(new Error("boom")))).toBeNull();
    expect(queryFailure(null)).toBeNull();
    expect(queryFailure(undefined)).toBeNull();
    expect(queryFailure("26000")).toBeNull();
  });

  test("a cause cycle terminates instead of hanging the reporter", () => {
    const a = new Error("a") as Error & { cause?: unknown };
    const b = new Error("b") as Error & { cause?: unknown };
    a.cause = b;
    b.cause = a;
    expect(queryFailure(a)).toBeNull();
  });

  test("stops before an unbounded chain of wrappers", () => {
    let deep: unknown = postgresError({ code: "26000" });
    for (let i = 0; i < 20; i++) deep = drizzleQueryError(deep);
    expect(queryFailure(deep)).toBeNull();
  });
});
