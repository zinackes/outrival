import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import { changes, competitors, monitors, reviewScores, snapshots } from "@outrival/db";
import { makeTestDb, type TestDb } from "./db-harness";
import { asUser, installAppMocks, mountApp, seedOrg } from "./app-harness";

// The competitor Activity tab renders a change that never became a signal, and a
// change carries no summary for three different reasons. The row used to offer to
// run the classifier on all of them, including the two the pipeline had already
// decided against, so the projection now ships the reason — and, for a review
// capture, the numbers extraction recorded, which is the only readable content a
// rotating-list change has.

let app: Hono;
let testDb: TestDb;
let closeDb: () => Promise<void>;
let A: { orgId: string; userId: string; email: string };

const T = new Date("2026-08-10T12:00:00.000Z");
const at = (offsetMs: number) => new Date(T.getTime() + offsetMs);
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

interface ChangeProjection {
  id: string;
  summary: string | null;
  suppressionReason: string | null;
  reviewCapture: {
    score: number;
    reviewCount: number;
    prevScore: number | null;
    prevReviewCount: number | null;
  } | null;
}

beforeAll(async () => {
  const harness = await makeTestDb();
  testDb = harness.db;
  closeDb = harness.close;
  await installAppMocks(testDb);
  const { competitorsRouter } = await import("../src/routes/competitors");
  app = mountApp("/api/competitors", competitorsRouter);

  A = await seedOrg(testDb, { email: "recent-changes@example.com" });
  await testDb.insert(competitors).values({
    id: "cmp-rc",
    orgId: A.orgId,
    name: "Rotating Co",
    url: "https://rotating.example",
  });
  await testDb.insert(monitors).values([
    { id: "mon-rc-reviews", competitorId: "cmp-rc", sourceType: "appstore_reviews", frequency: "daily" },
    { id: "mon-rc-home", competitorId: "cmp-rc", sourceType: "homepage", frequency: "daily" },
  ]);
  await testDb.insert(snapshots).values([
    { id: "snap-rc-1", monitorId: "mon-rc-reviews", r2Key: "k1", contentHash: "h1", scrapedAt: T, status: "success" },
    { id: "snap-rc-2", monitorId: "mon-rc-home", r2Key: "k2", contentHash: "h2", scrapedAt: T, status: "success" },
  ]);
  await testDb.insert(changes).values([
    {
      id: "chg-rc-reviews",
      monitorId: "mon-rc-reviews",
      snapshotAfterId: "snap-rc-1",
      diffText: "the whole review list, rewritten",
      suppressionReason: "rotating_list",
      detectedAt: T,
    },
    {
      id: "chg-rc-home",
      monitorId: "mon-rc-home",
      snapshotAfterId: "snap-rc-2",
      diffText: "a build hash moved",
      suppressionReason: "trivial_diff",
      detectedAt: at(-MINUTE),
    },
  ]);
  // Extraction writes its batch just AFTER the scrape that produced the change,
  // so the capture the change belongs to is the one a few minutes later, not the
  // stale one from two days back — that one is the "previous" the row compares to.
  await testDb.insert(reviewScores).values([
    { competitorId: "cmp-rc", source: "appstore", score: 4.7, reviewCount: 1191, sentimentScore: 0.4, recordedAt: at(-2 * DAY) },
    { competitorId: "cmp-rc", source: "appstore", score: 4.6, reviewCount: 1203, sentimentScore: 0.4, recordedAt: at(5 * MINUTE) },
  ]);
});

afterAll(async () => {
  await closeDb();
});

async function fetchChanges(): Promise<Record<string, ChangeProjection>> {
  const res = await app.request("/api/competitors/cmp-rc", asUser(A.userId, A.email));
  expect(res.status).toBe(200);
  const body = (await res.json()) as { recentChanges: ChangeProjection[] };
  return Object.fromEntries(body.recentChanges.map((c) => [c.id, c]));
}

describe("GET /competitors/:id recentChanges", () => {
  test("a review capture ships the score and volume around it, plus the batch before", async () => {
    const row = (await fetchChanges())["chg-rc-reviews"];
    expect(row?.summary).toBeNull();
    expect(row?.suppressionReason).toBe("rotating_list");
    expect(row?.reviewCapture).toEqual({
      score: 4.6,
      reviewCount: 1203,
      prevScore: 4.7,
      prevReviewCount: 1191,
    });
  });

  test("a change on any other source carries its reason and no review capture", async () => {
    const row = (await fetchChanges())["chg-rc-home"];
    expect(row?.suppressionReason).toBe("trivial_diff");
    expect(row?.reviewCapture).toBeNull();
  });
});
