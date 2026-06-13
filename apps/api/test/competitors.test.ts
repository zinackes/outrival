import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import { competitors } from "@outrival/db";
import { makeTestDb, type TestDb } from "./db-harness";
import { asUser, installAppMocks, mountApp, seedOrg } from "./app-harness";

// POST /competitors/:id/monitors guards two invariants at once: tenant ownership
// (assertOwnedCompetitor) and per-plan source gating (isSourceAllowed). Both must
// short-circuit before any monitor is created.
let app: Hono;
let testDb: TestDb;
let closeDb: () => Promise<void>;
let A: { orgId: string; userId: string; email: string };
let B: { orgId: string; userId: string; email: string };

afterAll(() => closeDb());

beforeAll(async () => {
  ({ db: testDb, close: closeDb } = await makeTestDb());
  await installAppMocks(testDb);
  const { competitorsRouter } = await import("../src/routes/competitors");
  app = mountApp("/api/competitors", competitorsRouter);
  A = await seedOrg(testDb, { plan: "free" });
  B = await seedOrg(testDb, { plan: "free" });
  await testDb.insert(competitors).values({ id: "comp-a", orgId: A.orgId, name: "Acme" });
});

const enable = (userId: string, email: string, competitorId: string, sourceType: string) =>
  app.request(
    `/api/competitors/${competitorId}/monitors`,
    asUser(userId, email, { method: "POST", body: JSON.stringify({ sourceType }) }),
  );

describe("competitors enable-monitor gating", () => {
  test("IDOR: a foreign org cannot enable a monitor on another org's competitor", async () => {
    const res = await enable(B.userId, B.email, "comp-a", "blog");
    expect(res.status).toBe(404);
  });

  test("IDOR: a non-existent competitor id is 404, not a server error", async () => {
    const res = await enable(A.userId, A.email, "does-not-exist", "blog");
    expect(res.status).toBe(404);
  });

  test("plan gating: free org cannot enable a pro-only source (jobs)", async () => {
    const res = await enable(A.userId, A.email, "comp-a", "jobs");
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("plan_locked_source");
  });

  test("internal source (sitemap) is never user-enableable", async () => {
    const res = await enable(A.userId, A.email, "comp-a", "sitemap");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("source_not_enableable");
  });
});
