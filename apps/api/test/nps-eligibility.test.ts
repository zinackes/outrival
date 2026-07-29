import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import { eq } from "drizzle-orm";
import { changes, competitors, monitors, signals, snapshots, users } from "@outrival/db";
import { makeTestDb, type TestDb } from "./db-harness";
import { asUser, installAppMocks, mountApp, seedOrg } from "./app-harness";

// The NPS prompt used to be eligible the second an account existed, so it fired
// ~6s after the user landed on the dashboard straight out of onboarding: they
// were scoring the signup flow, not the product, and the one prompt allowed per
// interval was spent. Case 1 is that regression.
let app: Hono;
let testDb: TestDb;
let closeDb: () => Promise<void>;

beforeAll(async () => {
  process.env.FEEDBACK_NPS_MIN_ACCOUNT_AGE_DAYS = "14";
  process.env.FEEDBACK_NPS_MIN_SIGNALS = "3";
  ({ db: testDb, close: closeDb } = await makeTestDb());
  await installAppMocks(testDb);
  const { feedbackQualityRouter } = await import("../src/routes/feedback-quality");
  app = mountApp("/api/feedback-quality", feedbackQualityRouter);
});

afterAll(() => closeDb());

async function ageAccount(userId: string, days: number) {
  await testDb
    .update(users)
    .set({ createdAt: new Date(Date.now() - days * 24 * 60 * 60 * 1000) })
    .where(eq(users.id, userId));
}

let seq = 0;
/** Seed `count` signals for an org (signals need monitor + change upstream). */
async function seedSignals(orgId: string, count: number) {
  const n = ++seq;
  const competitorId = `cmp-${n}`;
  await testDb
    .insert(competitors)
    .values({ id: competitorId, orgId, name: `C${n}`, url: `https://c${n}.example` });
  const monitorId = `mon-${n}`;
  await testDb
    .insert(monitors)
    .values({ id: monitorId, competitorId, sourceType: "homepage", frequency: "daily" });
  for (let i = 0; i < count; i++) {
    const snapshotId = `snap-${n}-${i}`;
    await testDb
      .insert(snapshots)
      .values({ id: snapshotId, monitorId, r2Key: `k/${snapshotId}`, contentHash: `h${i}` });
    const changeId = `chg-${n}-${i}`;
    await testDb
      .insert(changes)
      .values({ id: changeId, monitorId, snapshotAfterId: snapshotId, diffText: "x" });
    await testDb.insert(signals).values({
      id: `sig-${n}-${i}`,
      changeId,
      orgId,
      competitorId,
      severity: "medium",
      category: "product",
      insight: "i",
      soWhat: "s",
      recommendedAction: "a",
    });
  }
}

async function eligible(userId: string): Promise<boolean> {
  const res = await app.request("/api/feedback-quality/nps-status", asUser(userId));
  expect(res.status).toBe(200);
  return ((await res.json()) as { eligible: boolean }).eligible;
}

describe("GET /api/feedback-quality/nps-status", () => {
  test("1. regression: a brand-new account is not asked", async () => {
    const { userId } = await seedOrg(testDb);
    expect(await eligible(userId)).toBe(false);
  });

  test("an aged account with nothing to score is not asked", async () => {
    const { userId } = await seedOrg(testDb);
    await ageAccount(userId, 30);
    expect(await eligible(userId)).toBe(false);
  });

  test("too few signals is not enough", async () => {
    const { orgId, userId } = await seedOrg(testDb);
    await ageAccount(userId, 30);
    await seedSignals(orgId, 2);
    expect(await eligible(userId)).toBe(false);
  });

  test("aged account with signals is asked", async () => {
    const { orgId, userId } = await seedOrg(testDb);
    await ageAccount(userId, 30);
    await seedSignals(orgId, 3);
    expect(await eligible(userId)).toBe(true);
  });

  test("a recent answer still closes the window", async () => {
    const { orgId, userId } = await seedOrg(testDb);
    await ageAccount(userId, 30);
    await seedSignals(orgId, 3);

    const res = await app.request(
      "/api/feedback-quality",
      asUser(userId, "u@example.com", {
        method: "POST",
        body: JSON.stringify({
          targetType: "nps",
          targetId: "nps-2026-07",
          verdict: "neutral",
        }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await eligible(userId)).toBe(false);
  });
});
