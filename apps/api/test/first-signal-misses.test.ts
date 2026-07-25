import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import {
  onboardingSessions,
  signals,
  competitors,
  monitors,
  snapshots,
  changes,
  backfillRuns,
} from "@outrival/db";
import { makeTestDb, type TestDb } from "./db-harness";
import { installAppMocks, mountApp, seedOrg } from "./app-harness";

// GET /api/admin/first-signal-misses — for the 28d onboarding completions that
// missed the 10-minute first-signal window, attribute the miss to a backfill_runs
// bucket (plan 019). Best-effort: must never throw, buckets are per-org presence.

let app: Hono;
let testDb: TestDb;
let closeDb: () => Promise<void>;

// PGlite migrates the whole schema on first use, which runs past bun's 5s hook
// default on a cold VM.
const HOOK_TIMEOUT_MS = 30_000;

afterAll(() => closeDb());

beforeAll(async () => {
  ({ db: testDb, close: closeDb } = await makeTestDb());
  await installAppMocks(testDb);
  const { productRouter } = await import("../src/routes/admin/product");
  app = mountApp("/api/admin", productRouter);
}, HOOK_TIMEOUT_MS);

let seq = 0;

/** A completed onboarding session, `daysAgo` in the past (must be >= 10 minutes ago to count). */
async function seedCompletion(orgId: string, userId: string, daysAgo: number): Promise<Date> {
  const completedAt = new Date(Date.now() - daysAgo * 86_400_000);
  await testDb.insert(onboardingSessions).values({
    id: `sess-${++seq}`,
    userId,
    orgId,
    stage: "completed",
    completedAt,
  });
  return completedAt;
}

async function seedCompetitor(orgId: string, name: string): Promise<string> {
  const id = `cmp-${++seq}`;
  await testDb
    .insert(competitors)
    .values({ id, orgId, name, url: `https://${name.toLowerCase()}.example` });
  return id;
}

/** A full monitor→snapshot→change→signal chain, matching compare.test.ts's helper. */
async function seedSignal(orgId: string, competitorId: string, createdAt: Date): Promise<void> {
  const n = ++seq;
  await testDb
    .insert(monitors)
    .values({ id: `mon-${n}`, competitorId, sourceType: "homepage" });
  await testDb
    .insert(snapshots)
    .values({ id: `snp-${n}`, monitorId: `mon-${n}`, r2Key: `k-${n}`, contentHash: `h-${n}` });
  await testDb.insert(changes).values({
    id: `chg-${n}`,
    monitorId: `mon-${n}`,
    snapshotAfterId: `snp-${n}`,
    detectedAt: createdAt,
  });
  await testDb.insert(signals).values({
    id: `sig-${n}`,
    changeId: `chg-${n}`,
    orgId,
    competitorId,
    severity: "low",
    category: "product",
    insight: "Refreshed a marketing page.",
    createdAt,
  });
}

async function seedBackfillRun(competitorId: string, outcome: string, daysAgo: number): Promise<void> {
  await testDb.insert(backfillRuns).values({
    monitorId: `mon-bf-${++seq}`,
    competitorId,
    sourceType: "homepage",
    outcome,
    recordedAt: new Date(Date.now() - daysAgo * 86_400_000),
  });
}

// Tests share one PGlite instance and accumulate state test-to-test (bun:test
// runs a describe's tests in declaration order), so each test's expected numbers
// are the running total after that test's seed — not an isolated fixture.
describe("GET /api/admin/first-signal-misses", () => {
  test("empty database: does not throw, reports zero completions", async () => {
    const res = await app.request("/api/admin/first-signal-misses");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.available).toBe(true);
    expect(body.completions).toBe(0);
    expect(body.missed).toBe(0);
    expect(body.neverSignal).toBe(0);
  });

  test("a completion with a signal inside 10 minutes is not a miss", async () => {
    const { orgId, userId } = await seedOrg(testDb);
    const competitorId = await seedCompetitor(orgId, "Rival");
    const completedAt = await seedCompletion(orgId, userId, 1);
    await seedSignal(orgId, competitorId, new Date(completedAt.getTime() + 2 * 60_000));

    const res = await app.request("/api/admin/first-signal-misses");
    const body = await res.json();
    expect(body.available).toBe(true);
    expect(body.completions).toBe(1);
    expect(body.missed).toBe(0);
    expect(body.neverSignal).toBe(0);
  });

  test("a completion with no signal at all is missed, never-signal, and no_backfill_run", async () => {
    const { orgId, userId } = await seedOrg(testDb);
    await seedCompetitor(orgId, "Silent");
    await seedCompletion(orgId, userId, 1);

    const res = await app.request("/api/admin/first-signal-misses");
    const body = await res.json();
    expect(body.available).toBe(true);
    expect(body.completions).toBe(2);
    expect(body.missed).toBe(1);
    expect(body.neverSignal).toBe(1);
    const noBackfillBucket = body.buckets.find((b: { bucket: string }) => b.bucket === "no_backfill_run");
    expect(noBackfillBucket).toBeTruthy();
    expect(noBackfillBucket.orgs).toBe(1);
  });

  test("a missed completion with a no_archive_capture backfill run is bucketed", async () => {
    const { orgId, userId } = await seedOrg(testDb);
    const competitorId = await seedCompetitor(orgId, "Archived");
    await seedCompletion(orgId, userId, 1);
    await seedBackfillRun(competitorId, "no_archive_capture", 1);

    const res = await app.request("/api/admin/first-signal-misses");
    const body = await res.json();
    expect(body.available).toBe(true);
    expect(body.completions).toBe(3);
    expect(body.missed).toBe(2);
    expect(body.neverSignal).toBe(2);
    const bucket = body.buckets.find((b: { bucket: string }) => b.bucket === "no_archive_capture");
    expect(bucket).toBeTruthy();
    expect(bucket.orgs).toBe(1);
    // The Silent org from the previous test still has no backfill run at all.
    const noBackfillBucket = body.buckets.find((b: { bucket: string }) => b.bucket === "no_backfill_run");
    expect(noBackfillBucket?.orgs).toBe(1);
  });
});
