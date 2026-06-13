import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import type { Hono } from "hono";
import { eq } from "drizzle-orm";
import { competitors, monitors, forcedRescanLog } from "@outrival/db";
import { makeTestDb, type TestDb } from "./db-harness";
import { asUser, installAppMocks, mountApp, seedOrg } from "./app-harness";

// POST /monitors/:id/force-rescan (patch-27) is a tenant-scoped, tier-limited
// trigger. Its two security gates — ownership (the monitor's competitor must be in
// the caller's org, not soft-deleted) and the per-tier daily cap — both short
// circuit BEFORE tasks.trigger, so the denial paths test without any worker. The
// trigger is mocked so the happy path can be exercised too (it records a log row).
let app: Hono;
let testDb: TestDb;
let closeDb: () => Promise<void>;
let A: { orgId: string; userId: string; email: string };
let B: { orgId: string; userId: string; email: string };

afterAll(() => closeDb());

beforeAll(async () => {
  ({ db: testDb, close: closeDb } = await makeTestDb());
  await installAppMocks(testDb);
  // Keep Trigger.dev out of the test: a fixed handle, never a network call.
  mock.module("@trigger.dev/sdk/v3", () => ({
    tasks: { trigger: async () => ({ id: "run_test" }) },
  }));
  const { monitorsRouter } = await import("../src/routes/monitors");
  app = mountApp("/api/monitors", monitorsRouter);

  A = await seedOrg(testDb, { plan: "free" });
  B = await seedOrg(testDb, { plan: "free" });
  await testDb.insert(competitors).values([
    { id: "c-a", orgId: A.orgId, name: "Rival A" },
    { id: "c-b", orgId: B.orgId, name: "Rival B" },
    { id: "c-del", orgId: A.orgId, name: "Gone", deletedAt: new Date() },
  ]);
  await testDb.insert(monitors).values([
    { id: "m-a", competitorId: "c-a", sourceType: "homepage" },
    { id: "m-b", competitorId: "c-b", sourceType: "homepage" },
    { id: "m-del", competitorId: "c-del", sourceType: "homepage" },
  ]);
});

const rescan = (u: { userId: string; email: string }, monitorId: string) =>
  app.request(
    `/api/monitors/${monitorId}/force-rescan`,
    asUser(u.userId, u.email, { method: "POST" }),
  );

describe("force-rescan ownership gate (short-circuits before trigger)", () => {
  test("unknown monitor id → 404", async () => {
    const res = await rescan(A, "does-not-exist");
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Monitor not found");
  });

  test("IDOR: a foreign org cannot rescan another org's monitor → 403", async () => {
    const res = await rescan(B, "m-a");
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Forbidden");
  });

  test("a monitor on a soft-deleted competitor → 403", async () => {
    const res = await rescan(A, "m-del");
    expect(res.status).toBe(403);
  });
});

describe("force-rescan happy path", () => {
  test("owner under the cap → 200, logs the run with its task id", async () => {
    const res = await rescan(A, "m-a");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.usageToday).toBe(1);
    expect(body.dailyLimit).toBe(1); // free tier

    const logs = await testDb
      .select()
      .from(forcedRescanLog)
      .where(eq(forcedRescanLog.userId, A.userId));
    expect(logs).toHaveLength(1);
    expect(logs[0]?.taskId).toBe("run_test");
    expect(logs[0]?.monitorId).toBe("m-a");
  });
});

describe("force-rescan per-tier daily cap", () => {
  test("at the cap → 429 rescan_limit_reached (before any trigger)", async () => {
    // Consume B's single free rescan up front, decoupled from the happy path.
    await testDb
      .insert(forcedRescanLog)
      .values({ userId: B.userId, orgId: B.orgId, monitorId: "m-b" });

    const res = await rescan(B, "m-b");
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe("rescan_limit_reached");
  });
});
