import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import { savedViews } from "@outrival/db";
import { makeTestDb, type TestDb } from "./db-harness";
import { asUser, installAppMocks, mountApp, seedOrg } from "./app-harness";

// First API integration test: a real router on a real (PGlite) DB, proving the
// org-scoping in saved-views.ts isolates tenants. saved-views is the lightest
// org-scoped router (no AI / trigger deps), so it validates the harness itself.
let app: Hono;
let testDb: TestDb;
let closeDb: () => Promise<void>;
let A: { orgId: string; userId: string; email: string };
let B: { orgId: string; userId: string; email: string };

afterAll(() => closeDb());

beforeAll(async () => {
  ({ db: testDb, close: closeDb } = await makeTestDb());
  await installAppMocks(testDb);
  const { savedViewsRouter } = await import("../src/routes/saved-views");
  app = mountApp("/api/saved-views", savedViewsRouter);
  A = await seedOrg(testDb);
  B = await seedOrg(testDb);
  // A view owned by org A — the cross-tenant target.
  await testDb.insert(savedViews).values({
    id: "view-a",
    orgId: A.orgId,
    userId: A.userId,
    name: "A's view",
    filters: {},
  });
});

describe("saved-views org-scoping", () => {
  test("rejects an unauthenticated request", async () => {
    const res = await app.request("/api/saved-views", asUser(null));
    expect(res.status).toBe(401);
  });

  test("owner sees only their org's views", async () => {
    const resA = await app.request("/api/saved-views", asUser(A.userId, A.email));
    expect(resA.status).toBe(200);
    expect((await resA.json()).views).toHaveLength(1);

    const resB = await app.request("/api/saved-views", asUser(B.userId, B.email));
    expect(resB.status).toBe(200);
    expect((await resB.json()).views).toHaveLength(0);
  });

  test("a foreign org cannot PATCH another org's view (IDOR → 404)", async () => {
    const res = await app.request(
      "/api/saved-views/view-a",
      asUser(B.userId, B.email, { method: "PATCH", body: JSON.stringify({ name: "hijacked" }) }),
    );
    expect(res.status).toBe(404);
    // And the row is untouched.
    const [row] = await testDb.select().from(savedViews);
    expect(row?.name).toBe("A's view");
  });

  test("a foreign org's DELETE is a no-op on another org's view", async () => {
    const res = await app.request(
      "/api/saved-views/view-a",
      asUser(B.userId, B.email, { method: "DELETE" }),
    );
    expect(res.status).toBe(200); // org-scoped delete affects 0 rows
    const rows = await testDb.select().from(savedViews);
    expect(rows).toHaveLength(1); // still there
  });

  test("owner can create and read back a view", async () => {
    const res = await app.request(
      "/api/saved-views",
      asUser(A.userId, A.email, { method: "POST", body: JSON.stringify({ name: "fresh" }) }),
    );
    expect(res.status).toBe(201);
    expect((await res.json()).view.name).toBe("fresh");
  });
});
