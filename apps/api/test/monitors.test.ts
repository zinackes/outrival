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
let C: { orgId: string; userId: string; email: string };

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
  // Pro org (cap 20) so the /run metering tests don't collide with A/B's spent free cap.
  C = await seedOrg(testDb, { plan: "pro" });
  await testDb.insert(competitors).values([
    { id: "c-a", orgId: A.orgId, name: "Rival A" },
    { id: "c-b", orgId: B.orgId, name: "Rival B" },
    { id: "c-del", orgId: A.orgId, name: "Gone", deletedAt: new Date() },
    { id: "c-c", orgId: C.orgId, name: "Rival C" },
    // A competitor with a URL so a retargeted monitor URL passes the brand-lock guard.
    { id: "c-d", orgId: C.orgId, name: "Rival D", url: "https://rival-d.com" },
  ]);
  await testDb.insert(monitors).values([
    // Already run → a force-rescan is a genuine (metered) re-scan.
    { id: "m-a", competitorId: "c-a", sourceType: "homepage", lastRunAt: new Date(Date.now() - 60_000) },
    { id: "m-b", competitorId: "c-b", sourceType: "homepage", lastRunAt: new Date(Date.now() - 60_000) },
    // Never run — a first scrape via force-rescan must be exempt even when B is at cap.
    { id: "m-b-fresh", competitorId: "c-b", sourceType: "pricing" },
    { id: "m-del", competitorId: "c-del", sourceType: "homepage" },
    // m-c-new was never scraped (first scrape, unmetered); m-c-ran already ran (re-scan, metered).
    { id: "m-c-new", competitorId: "c-c", sourceType: "homepage" },
    { id: "m-c-ran", competitorId: "c-c", sourceType: "pricing", lastRunAt: new Date(Date.now() - 60_000) },
    // Already-scraped monitors whose URL a PATCH will retarget (m-d-retarget) or
    // re-submit unchanged (m-d-same) — exercises the freshness-state reset.
    {
      id: "m-d-retarget",
      competitorId: "c-d",
      sourceType: "homepage",
      config: { url: "https://rival-d.com/home" },
      lastRunAt: new Date(Date.now() - 60_000),
      lastChangedAt: new Date(Date.now() - 60_000),
    },
    {
      id: "m-d-same",
      competitorId: "c-d",
      sourceType: "pricing",
      config: { url: "https://rival-d.com/pricing" },
      lastRunAt: new Date(Date.now() - 60_000),
    },
  ]);
});

const patchMonitor = (
  u: { userId: string; email: string },
  monitorId: string,
  patch: Record<string, unknown>,
) =>
  app.request(
    `/api/monitors/${monitorId}`,
    asUser(u.userId, u.email, { method: "PATCH", body: JSON.stringify(patch) }),
  );

const rescan = (u: { userId: string; email: string }, monitorId: string) =>
  app.request(
    `/api/monitors/${monitorId}/force-rescan`,
    asUser(u.userId, u.email, { method: "POST" }),
  );

const run = (u: { userId: string; email: string }, monitorId: string) =>
  app.request(`/api/monitors/${monitorId}/run`, asUser(u.userId, u.email, { method: "POST" }));

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

  test("first scrape via force-rescan is exempt from the cap (200, unmetered, no log)", async () => {
    // B is at its single free rescan (previous test), yet a never-run monitor is a
    // first scrape, not a re-scan — it bypasses the cap and logs nothing.
    const res = await rescan(B, "m-b-fresh");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.metered).toBe(false);
    expect(body.rescanLogId).toBeNull();
    const logs = await testDb
      .select()
      .from(forcedRescanLog)
      .where(eq(forcedRescanLog.monitorId, "m-b-fresh"));
    expect(logs).toHaveLength(0);
  });
});

// patch-27 — POST /:id/run now meters genuine re-scans through the same cap + log as
// /force-rescan, but exempts a monitor's first scrape (just enabled, never run).
describe("run metering (counts re-scans, exempts first scrape)", () => {
  test("first scrape (never run) → 200, no forced_rescan_log row", async () => {
    const res = await run(C, "m-c-new");
    expect(res.status).toBe(200);
    const logs = await testDb
      .select()
      .from(forcedRescanLog)
      .where(eq(forcedRescanLog.monitorId, "m-c-new"));
    expect(logs).toHaveLength(0);
  });

  test("re-scan (already run) → 200, logs the run with its task id", async () => {
    const res = await run(C, "m-c-ran");
    expect(res.status).toBe(200);
    const logs = await testDb
      .select()
      .from(forcedRescanLog)
      .where(eq(forcedRescanLog.monitorId, "m-c-ran"));
    expect(logs).toHaveLength(1);
    expect(logs[0]?.userId).toBe(C.userId);
    expect(logs[0]?.taskId).toBe("run_test");
  });
});

// Retargeting a monitor's URL invalidates its freshness state: the new page has
// never been scraped, so the next Run must count as a first scrape (unmetered),
// not a forced re-scan of the old page.
describe("PATCH url change resets freshness so the next run is a first scrape", () => {
  test("changing the URL nulls lastRunAt/lastChangedAt", async () => {
    const res = await patchMonitor(C, "m-d-retarget", { url: "https://rival-d.com/new-home" });
    expect(res.status).toBe(200);
    const [m] = await testDb
      .select()
      .from(monitors)
      .where(eq(monitors.id, "m-d-retarget"));
    expect(m?.config).toEqual({ url: "https://rival-d.com/new-home" });
    expect(m?.lastRunAt).toBeNull();
    expect(m?.lastChangedAt).toBeNull();
  });

  test("the subsequent run is unmetered (no forced_rescan_log row)", async () => {
    const res = await run(C, "m-d-retarget");
    expect(res.status).toBe(200);
    const logs = await testDb
      .select()
      .from(forcedRescanLog)
      .where(eq(forcedRescanLog.monitorId, "m-d-retarget"));
    expect(logs).toHaveLength(0);
  });

  test("re-submitting the same URL keeps lastRunAt (still a metered re-scan)", async () => {
    const res = await patchMonitor(C, "m-d-same", { url: "https://rival-d.com/pricing" });
    expect(res.status).toBe(200);
    const [m] = await testDb.select().from(monitors).where(eq(monitors.id, "m-d-same"));
    expect(m?.lastRunAt).not.toBeNull();

    const runRes = await run(C, "m-d-same");
    expect(runRes.status).toBe(200);
    const logs = await testDb
      .select()
      .from(forcedRescanLog)
      .where(eq(forcedRescanLog.monitorId, "m-d-same"));
    expect(logs).toHaveLength(1);
  });
});
