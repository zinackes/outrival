import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import type { Hono } from "hono";
import { makeTestDb, type TestDb } from "./db-harness";
import { installAppMocks, mountApp } from "./app-harness";

// code:COR-02 — the account lookup on /check-and-send-magic-link ended in
// `.catch(() => undefined)` under a comment claiming it was "best-effort analytics
// only". It was not: the suspension gate reads that row, so a transient DB error
// read as "no such account" and Better Auth happily sent a suspended operator
// lock-out a working sign-in code. The lookup now fails closed.

let app: Hono;
let testDb: TestDb;
let closeDb: () => Promise<void>;

afterAll(() => closeDb());

beforeAll(async () => {
  ({ db: testDb, close: closeDb } = await makeTestDb());
  await installAppMocks(testDb);
  const { authRouter } = await import("../src/routes/auth");
  app = mountApp("/api/auth", authRouter);
});

function send(email: string): Promise<Response> {
  return app.request("/api/auth/check-and-send-magic-link", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, turnstileToken: "test" }),
  });
}

describe("POST /check-and-send-magic-link — account lookup failure", () => {
  test("denies instead of treating the error as an unknown account", async () => {
    // The only way to make the lookup throw for real. `finally` puts the table
    // back even on a failed assertion — the PGlite instance is process-wide.
    await testDb.execute(sql`ALTER TABLE users RENAME TO users_hidden`);
    try {
      const res = await send("locked@example.com");
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({
        error: "lookup_failed",
        userAction: "retry",
      });
    } finally {
      await testDb.execute(sql`ALTER TABLE users_hidden RENAME TO users`);
    }
  });

  test("a healthy lookup still gets the generic response", async () => {
    const res = await send("nobody@example.com");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });
});
