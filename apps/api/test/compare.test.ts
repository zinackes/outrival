import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import {
  competitors,
  monitors,
  snapshots,
  changes,
  signals,
  pricingHistory,
  jobCounts,
  hiringMetrics,
  reviewScores,
} from "@outrival/db";
import { makeTestDb, type TestDb } from "./db-harness";
import { asUser, installAppMocks, mountApp, seedOrg } from "./app-harness";

// The comparison matrix: org scoping, the latest move served in the words the feed
// uses (the compare page leads its rows with it), the engineering share taken from
// the canonical hiring buckets, and the entry/top band that ignores quote tiers.
let app: Hono;
let testDb: TestDb;
let closeDb: () => Promise<void>;

let A: { orgId: string; userId: string; email: string };
let B: { orgId: string; userId: string; email: string };

const AT = (day: number) => new Date(Date.UTC(2026, 6, day, 9, 0, 0));

let seq = 0;

async function seedCompetitor(orgId: string, name: string): Promise<string> {
  const id = `cmp-${++seq}`;
  await testDb
    .insert(competitors)
    .values({ id, orgId, name, url: `https://${name.toLowerCase()}.example` });
  return id;
}

async function seedSignal(opts: {
  orgId: string;
  competitorId: string;
  severity: "low" | "medium" | "high" | "critical";
  category: "pricing" | "product" | "hiring";
  insight: string;
  createdAt: Date;
}): Promise<void> {
  const n = ++seq;
  await testDb
    .insert(monitors)
    .values({ id: `mon-${n}`, competitorId: opts.competitorId, sourceType: "homepage" });
  await testDb
    .insert(snapshots)
    .values({ id: `snp-${n}`, monitorId: `mon-${n}`, r2Key: `k-${n}`, contentHash: `h-${n}` });
  await testDb.insert(changes).values({
    id: `chg-${n}`,
    monitorId: `mon-${n}`,
    snapshotAfterId: `snp-${n}`,
    detectedAt: opts.createdAt,
  });
  await testDb.insert(signals).values({
    id: `sig-${n}`,
    changeId: `chg-${n}`,
    orgId: opts.orgId,
    competitorId: opts.competitorId,
    severity: opts.severity,
    category: opts.category,
    insight: opts.insight,
    createdAt: opts.createdAt,
  });
}

async function seedPlan(
  competitorId: string,
  planName: string,
  price: number | null,
  recordedAt: Date,
): Promise<void> {
  await testDb.insert(pricingHistory).values({
    competitorId,
    planName,
    price,
    currency: "USD",
    billingPeriod: "monthly",
    recordedAt,
  });
}

let rich = "";
let quoteOnly = "";
let noAts = "";
let foreign = "";

afterAll(() => closeDb());

// PGlite migrates the whole schema on first use, which runs past bun's 5s hook
// default on a cold VM.
const HOOK_TIMEOUT_MS = 30_000;

beforeAll(async () => {
  ({ db: testDb, close: closeDb } = await makeTestDb());
  await installAppMocks(testDb);
  const { compareRouter } = await import("../src/routes/compare");
  app = mountApp("/api/compare", compareRouter);

  A = await seedOrg(testDb);
  B = await seedOrg(testDb);

  rich = await seedCompetitor(A.orgId, "Klarity");
  quoteOnly = await seedCompetitor(A.orgId, "Aperture");
  noAts = await seedCompetitor(A.orgId, "Beacon");
  foreign = await seedCompetitor(B.orgId, "Outsider");

  // Klarity: a stale batch that must be ignored, then the current one.
  await seedPlan(rich, "Old", 79, AT(1));
  await seedPlan(rich, "Team", 49, AT(9));
  await seedPlan(rich, "Business", 399, AT(9));
  await seedPlan(rich, "Enterprise", null, AT(9));
  await testDb
    .insert(jobCounts)
    .values([
      { competitorId: rich, department: "Platform Engineering", count: 9, recordedAt: AT(9) },
      { competitorId: rich, department: "Sales", count: 6, recordedAt: AT(9) },
    ]);
  await testDb.insert(hiringMetrics).values([
    // An older week that must lose to the latest one.
    { competitorId: rich, departmentBucket: "engineering", openCount: 4, weekStart: "2026-06-29" },
    { competitorId: rich, departmentBucket: "engineering", openCount: 9, weekStart: "2026-07-06" },
    { competitorId: rich, departmentBucket: "sales", openCount: 6, weekStart: "2026-07-06" },
  ]);
  await testDb.insert(reviewScores).values({
    competitorId: rich,
    source: "g2",
    score: 4.2,
    reviewCount: 214,
    sentimentScore: 0.4,
    subEaseOfUse: 4,
    subSupport: 3.9,
    subFeatures: 4.5,
    subValue: 3.8,
    recordedAt: AT(9),
  });
  await seedSignal({
    orgId: A.orgId,
    competitorId: rich,
    severity: "critical",
    category: "pricing",
    insight: "Cut the entry plan from $79 to $49 and removed the seat minimum.",
    createdAt: AT(9),
  });
  // An older signal on the same competitor: the row must carry the newest.
  await seedSignal({
    orgId: A.orgId,
    competitorId: rich,
    severity: "low",
    category: "product",
    insight: "Refreshed a marketing page.",
    createdAt: AT(2),
  });

  // Aperture: quote-based tiers only.
  await seedPlan(quoteOnly, "Enterprise", null, AT(9));

  // Beacon: open roles but no authoritative ATS run, so no canonical buckets.
  await testDb
    .insert(jobCounts)
    .values({ competitorId: noAts, department: "Support", count: 2, recordedAt: AT(9) });
}, HOOK_TIMEOUT_MS);

describe("compare matrix", () => {
  test("rejects an unauthenticated request", async () => {
    const res = await app.request(`/api/compare?competitorIds=${rich}`, asUser(null));
    expect(res.status).toBe(401);
  });

  test("drops ids the caller's org does not own", async () => {
    const res = await app.request(
      `/api/compare?competitorIds=${rich},${foreign}`,
      asUser(A.userId, A.email),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.competitors.map((c: { id: string }) => c.id)).toEqual([rich]);
  });

  test("serves the latest move with its insight, category and id", async () => {
    const body = await (
      await app.request(`/api/compare?competitorIds=${rich}`, asUser(A.userId, A.email))
    ).json();
    const col = body.competitors[0];
    expect(col.latestSignal.severity).toBe("critical");
    expect(col.latestSignal.category).toBe("pricing");
    expect(col.latestSignal.insight).toContain("$49");
    expect(col.latestSignal.id).toBeTruthy();
  });

  test("bands the entry/top price over the latest batch and skips quote tiers", async () => {
    const body = await (
      await app.request(
        `/api/compare?competitorIds=${rich},${quoteOnly}`,
        asUser(A.userId, A.email),
      )
    ).json();
    const byId = new Map(body.competitors.map((c: { id: string }) => [c.id, c]));
    const k = byId.get(rich) as { pricing: { entry: number; top: number; plans: unknown[]; capturedAt: string } };
    // 79 belongs to the superseded batch; Enterprise carries no number.
    expect(k.pricing.entry).toBe(49);
    expect(k.pricing.top).toBe(399);
    expect(k.pricing.plans).toHaveLength(3);
    expect(k.pricing.capturedAt).toBeTruthy();

    const a = byId.get(quoteOnly) as { pricing: { entry: number | null; top: number | null } };
    expect(a.pricing.entry).toBeNull();
    expect(a.pricing.top).toBeNull();
  });

  test("takes the engineering share from the latest hiring week", async () => {
    const body = await (
      await app.request(`/api/compare?competitorIds=${rich}`, asUser(A.userId, A.email))
    ).json();
    expect(body.competitors[0].hiring.totalOpen).toBe(15);
    expect(body.competitors[0].hiring.engineeringOpen).toBe(9);
  });

  test("leaves the engineering share null when no ATS run bucketed the roles", async () => {
    const body = await (
      await app.request(`/api/compare?competitorIds=${noAts}`, asUser(A.userId, A.email))
    ).json();
    expect(body.competitors[0].hiring.totalOpen).toBe(2);
    expect(body.competitors[0].hiring.engineeringOpen).toBeNull();
  });
});
