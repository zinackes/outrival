import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { eq } from "drizzle-orm";
import { makeTestDb, schema, type TestDb } from "./db-harness";
import { clearSharedOverrides, setSharedOverrides } from "./shared-mock";
import {
  checkBrandPresence,
  checkCapturedTarget,
  checkReviewsStructure,
  checkScoreRegression,
} from "../src/lib/reviews-authenticity";

// R7 (Véracité Intelligence v2, P5): what reaches review_scores.
//
// The job half runs against a real (in-process) Postgres, on the Trustpilot path —
// the one write that needs no model, so the run is exercised end to end without
// mocking the AI. What it pins is the consequence the card asks for: a capture of
// ANOTHER brand's profile writes NOTHING and leaves the snapshot graded `partial`,
// while a profile that is genuinely empty stays a healthy `success`.
//
// The guard half is pure and lives next to it: those are the branches the Trustpilot
// path cannot reach (an App Store id, a G2 page with no identifier at all).

let testDb: TestDb;
let closeDb: () => Promise<void>;
let resetDb: () => Promise<void>;
let runExtractReviews: (payload: {
  snapshotId: string;
  competitorId: string;
  source: "trustpilot";
}) => Promise<{ ok: boolean; reason?: string; empty?: boolean }>;

const ORG_ID = "org-r7";
const COMPETITOR_ID = "cmp-r7";
const MONITOR_ID = "mon-r7";
const SNAPSHOT_ID = "snap-r7";

/** The normalized Trustpilot snapshot the scraper stores, as JSON. */
function trustpilotSnapshot(args: {
  domain: string;
  trustScore: number | null;
  reviewCount: number;
}): string {
  return JSON.stringify({
    source: "trustpilot",
    domain: args.domain,
    businessUnitId: `bu-${args.domain}`,
    trustScore: args.trustScore,
    stars: args.trustScore === null ? null : Math.round(args.trustScore),
    reviewCount: args.reviewCount,
    distribution: [],
  });
}

async function seed(): Promise<void> {
  await resetDb();
  await testDb.insert(schema.organizations).values({ id: ORG_ID, name: "Org", slug: "org-r7" });
  await testDb.insert(schema.competitors).values({
    id: COMPETITOR_ID,
    orgId: ORG_ID,
    name: "Acme Analytics",
    url: "https://acme.com",
  });
  await testDb.insert(schema.monitors).values({
    id: MONITOR_ID,
    competitorId: COMPETITOR_ID,
    // The monitor's source_type, which is not the extractor's source name: the
    // scraped Trustpilot surface is `trustpilot_public`.
    sourceType: "trustpilot_public",
  });
  await testDb.insert(schema.snapshots).values({
    id: SNAPSHOT_ID,
    monitorId: MONITOR_ID,
    r2Key: `snapshots/${COMPETITOR_ID}/trustpilot/2026-08-14`,
    contentHash: "hash-r7",
  });
}

async function storedPoints() {
  return testDb
    .select()
    .from(schema.reviewScores)
    .where(eq(schema.reviewScores.competitorId, COMPETITOR_ID));
}

async function snapshotStatus(): Promise<string | undefined> {
  const [row] = await testDb
    .select({ status: schema.snapshots.status })
    .from(schema.snapshots)
    .where(eq(schema.snapshots.id, SNAPSHOT_ID));
  return row?.status;
}

beforeAll(async () => {
  const realQueue = await import("@outrival/queue");
  const harness = await makeTestDb();
  testDb = harness.db;
  closeDb = harness.close;
  resetDb = harness.reset;

  mock.module("@outrival/queue", () => ({
    ...realQueue,
    NonRetriable: realQueue.NonRetriable,
    detectReviewThemeShifts: {
      queue: "detect-review-theme-shifts",
      enqueue: async () => "job-id",
    },
  }));

  ({ runExtractReviews } = await import("../src/core/extract-reviews"));
});

afterAll(() => {
  clearSharedOverrides();
  return closeDb();
});

beforeEach(seed);

describe("a Trustpilot capture of another brand's profile", () => {
  test("writes nothing and grades the snapshot partial", async () => {
    // The silent redirect this guard exists for: the profile lookup resolved to a
    // company that is not ours, and the capture is a perfectly valid 4.9/2100 —
    // indistinguishable from a rating move once it is a row in the time series.
    setSharedOverrides({
      getFromR2: async () =>
        trustpilotSnapshot({ domain: "anvil.io", trustScore: 4.9, reviewCount: 2100 }),
    });

    const result = await runExtractReviews({
      snapshotId: SNAPSHOT_ID,
      competitorId: COMPETITOR_ID,
      source: "trustpilot",
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("wrong_target");
    expect(await storedPoints()).toHaveLength(0);
    expect(await snapshotStatus()).toBe("partial");
  });
});

describe("a Trustpilot profile with no reviews yet", () => {
  test("is an explicit empty state, not a refusal", async () => {
    // The other half of the card: the guard must not turn "this company has no
    // reviews" into a suspected bad capture. Nothing to plot, but the source is
    // healthy — the snapshot keeps its `success` grade.
    setSharedOverrides({
      getFromR2: async () =>
        trustpilotSnapshot({ domain: "acme.com", trustScore: null, reviewCount: 0 }),
    });

    const result = await runExtractReviews({
      snapshotId: SNAPSHOT_ID,
      competitorId: COMPETITOR_ID,
      source: "trustpilot",
    });

    expect(result.ok).toBe(true);
    expect(result.empty).toBe(true);
    expect(await storedPoints()).toHaveLength(0);
    expect(await snapshotStatus()).toBe("success");
  });
});

describe("the competitor's own profile", () => {
  test("still writes its point — the guard is not in the way", async () => {
    setSharedOverrides({
      getFromR2: async () =>
        trustpilotSnapshot({ domain: "acme.com", trustScore: 4.4, reviewCount: 1240 }),
    });

    const result = await runExtractReviews({
      snapshotId: SNAPSHOT_ID,
      competitorId: COMPETITOR_ID,
      source: "trustpilot",
    });

    expect(result.ok).toBe(true);
    const points = await storedPoints();
    expect(points).toHaveLength(1);
    expect(points[0]?.score).toBe(4.4);
    expect(points[0]?.reviewCount).toBe(1240);
    expect(await snapshotStatus()).toBe("success");
  });

  test("a collapsed review total does not overwrite the stored point", async () => {
    await testDb.insert(schema.reviewScores).values({
      competitorId: COMPETITOR_ID,
      source: "trustpilot",
      score: 4.4,
      reviewCount: 1240,
      sentimentScore: 85,
      recordedAt: new Date("2026-08-01T00:00:00Z"),
    });
    // Same domain, so the identity check passes — this is the second net: a total
    // that fell from 1240 to 6 is a capture of something else, however it parsed.
    setSharedOverrides({
      getFromR2: async () =>
        trustpilotSnapshot({ domain: "acme.com", trustScore: 4.8, reviewCount: 6 }),
    });

    const result = await runExtractReviews({
      snapshotId: SNAPSHOT_ID,
      competitorId: COMPETITOR_ID,
      source: "trustpilot",
    });

    expect(result.reason).toBe("count_collapse");
    const points = await storedPoints();
    expect(points).toHaveLength(1);
    expect(points[0]?.reviewCount).toBe(1240);
    expect(await snapshotStatus()).toBe("partial");
  });
});

describe("checkCapturedTarget", () => {
  const appstore = (appId: string) => JSON.stringify({ source: "appstore", appId, countries: ["us"] });

  test("refuses an App Store capture of a different app id", () => {
    expect(
      checkCapturedTarget({
        source: "appstore",
        intendedUrl: "https://apps.apple.com/us/app/acme/id123456789",
        finalUrl: null,
        payload: appstore("987654321"),
      }),
    ).toEqual({
      reason: "wrong_target",
      detail: "capture names 987654321, monitor names 123456789",
    });
  });

  test("passes the app it was asked for", () => {
    expect(
      checkCapturedTarget({
        source: "appstore",
        intendedUrl: "https://apps.apple.com/us/app/acme/id123456789",
        finalUrl: null,
        payload: appstore("123456789"),
      }),
    ).toBeNull();
  });

  test("has no opinion when the monitor URL names no identity", () => {
    // A G2 page: no id on either side. The guard must publish exactly as before
    // rather than invent a verdict — that is what keeps it from silencing sources.
    expect(
      checkCapturedTarget({
        source: "g2",
        intendedUrl: "https://www.g2.com/products/acme/reviews",
        finalUrl: "https://www.g2.com/products/acme/reviews",
        payload: "<html>…</html>",
      }),
    ).toBeNull();
  });

  test("catches a landing URL on another registrable domain", () => {
    expect(
      checkCapturedTarget({
        source: "g2",
        intendedUrl: "https://www.g2.com/products/acme/reviews",
        finalUrl: "https://reviews-marketing.example.com/",
        payload: "<html>…</html>",
      })?.reason,
    ).toBe("offsite_redirect");
  });
});

describe("checkBrandPresence", () => {
  const page = (body: string) => body.padEnd(400, " and more review text here.");

  test("refuses a page that never names the competitor", () => {
    expect(
      checkBrandPresence(page("Anvil Cloud reviews. Anvil Cloud is rated 4.6 by 900 users."), {
        name: "Acme Analytics",
        url: "https://acme.com",
      })?.reason,
    ).toBe("brand_absent");
  });

  test("accepts a page that only writes the short form of the name", () => {
    expect(
      checkBrandPresence(page("Acme reviews — what users say about Acme in 2026."), {
        name: "Acme Analytics, Inc.",
        url: "https://acme.com",
      }),
    ).toBeNull();
  });

  test("says nothing about a capture too short to search", () => {
    expect(checkBrandPresence("Anvil Cloud", { name: "Acme", url: null })).toBeNull();
  });
});

describe("checkScoreRegression", () => {
  const prev = { score: 4.4, reviewCount: 1240 };

  test("lets a real rating move through", () => {
    // The move the product exists to catch. Blocking it would be the expensive
    // failure of this guard, so it is pinned here rather than left to the constants.
    expect(checkScoreRegression(prev, { score: 4.2, reviewCount: 1252 })).toBeNull();
    expect(checkScoreRegression(prev, { score: 2.4, reviewCount: 1300 })).toBeNull();
  });

  test("does not read a missing fresh count as a collapse", () => {
    // A G2 page showing a rating and no total. Silence is not zero.
    expect(checkScoreRegression(prev, { score: 4.3, reviewCount: null })).toBeNull();
  });

  test("protects a small history from its own floor", () => {
    expect(
      checkScoreRegression({ score: 4.4, reviewCount: 12 }, { score: 4.4, reviewCount: 3 }),
    ).toBeNull();
  });

  test("refuses a collapsed rating", () => {
    expect(checkScoreRegression(prev, { score: 1.1, reviewCount: 1240 })?.reason).toBe(
      "score_collapse",
    );
  });

  test("has nothing to compare on a first capture", () => {
    expect(checkScoreRegression(null, { score: 1, reviewCount: 1 })).toBeNull();
  });
});

describe("checkReviewsStructure", () => {
  test("refuses a capture with no score, no count and no verbatim", () => {
    expect(
      checkReviewsStructure({ score: null, reviewCount: null, verbatims: 0 })?.reason,
    ).toBe("no_structure");
  });

  test("accepts a count of zero — the platform answered", () => {
    expect(checkReviewsStructure({ score: null, reviewCount: 0, verbatims: 0 })).toBeNull();
  });

  test("accepts verbatims with no aggregate", () => {
    expect(checkReviewsStructure({ score: null, reviewCount: null, verbatims: 3 })).toBeNull();
  });
});
