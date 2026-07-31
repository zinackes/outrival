import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  competitors,
  monitors,
  snapshots,
  changes,
  signals,
  jobCounts,
  pricingHistory,
  reviews,
  reviewScores,
} from "@outrival/db";
import { makeTestDb, type TestDb } from "./db-harness";
import { installAppMocks, seedOrg } from "./app-harness";

// Ask Outrival's tool layer. The invariant under test is the one that broke in prod:
// a roster-wide question ("who is hiring the most") is answered by ONE call that sees
// EVERY competitor. Before rank*, the planner had to fan out one call per name under a
// 6-call cap, so it emitted one and the answer named a single competitor as the winner.
let testDb: TestDb;
let closeDb: () => Promise<void>;
let tools: typeof import("../src/lib/ask/tools");

let A: { orgId: string; userId: string; email: string };
let B: { orgId: string; userId: string; email: string };

const AT = (day: number) => new Date(Date.UTC(2026, 6, day, 9, 0, 0));

let seq = 0;

async function seedCompetitor(
  orgId: string,
  name: string,
  opts: { type?: "competitor" | "self"; overrides?: unknown } = {},
): Promise<string> {
  const id = `ask-cmp-${++seq}`;
  await testDb.insert(competitors).values({
    id,
    orgId,
    name,
    url: `https://${name.toLowerCase()}.example`,
    type: opts.type ?? "competitor",
    ...(opts.overrides ? { overrides: opts.overrides } : {}),
  });
  return id;
}

// Four competitors hiring at different volumes, one with no hiring data at all —
// the whole point is that all four are accounted for in a single call.
let hot = "";
let warm = "";
let cool = "";
let silent = "";
let self = "";
let foreign = "";

afterAll(() => closeDb());

// PGlite migrates the whole schema on first use, which runs past bun's 5s hook default.
const HOOK_TIMEOUT_MS = 30_000;

beforeAll(async () => {
  ({ db: testDb, close: closeDb } = await makeTestDb());
  await installAppMocks(testDb);
  tools = await import("../src/lib/ask/tools");

  A = await seedOrg(testDb);
  B = await seedOrg(testDb);

  hot = await seedCompetitor(A.orgId, "Vantage");
  warm = await seedCompetitor(A.orgId, "Northwind");
  cool = await seedCompetitor(A.orgId, "Baseline");
  silent = await seedCompetitor(A.orgId, "Quietco");
  self = await seedCompetitor(A.orgId, "OwnProduct", { type: "self" });
  foreign = await seedCompetitor(B.orgId, "Outsider");

  await testDb.insert(jobCounts).values([
    // A stale batch that must lose to the current one.
    { competitorId: hot, department: "Engineering", count: 2, recordedAt: AT(1) },
    { competitorId: hot, department: "Engineering", count: 18, recordedAt: AT(9) },
    { competitorId: hot, department: "Sales", count: 7, recordedAt: AT(9) },
    { competitorId: warm, department: "Engineering", count: 9, recordedAt: AT(9) },
    { competitorId: cool, department: "Support", count: 3, recordedAt: AT(9) },
    // The user's own product hires too — it must never enter the ranking.
    { competitorId: self, department: "Engineering", count: 99, recordedAt: AT(9) },
    { competitorId: foreign, department: "Engineering", count: 99, recordedAt: AT(9) },
  ]);

  await testDb.insert(pricingHistory).values([
    { competitorId: hot, planName: "Pro", price: 90, currency: "USD", billingPeriod: "monthly", recordedAt: AT(9) },
    { competitorId: hot, planName: "Enterprise", price: null, currency: "USD", billingPeriod: "custom", recordedAt: AT(9) },
    { competitorId: warm, planName: "Starter", price: 12, currency: "USD", billingPeriod: "monthly", recordedAt: AT(9) },
    { competitorId: warm, planName: "Scale", price: 240, currency: "USD", billingPeriod: "monthly", recordedAt: AT(9) },
    // Quote-only: has plans, but no comparable number — sorts last, never "cheapest".
    { competitorId: cool, planName: "Contact us", price: null, currency: "USD", billingPeriod: "custom", recordedAt: AT(9) },
    { competitorId: self, planName: "Ours", price: 1, currency: "USD", billingPeriod: "monthly", recordedAt: AT(9) },
    { competitorId: foreign, planName: "Theirs", price: 1, currency: "USD", billingPeriod: "monthly", recordedAt: AT(9) },
  ]);

  await testDb.insert(reviewScores).values([
    { competitorId: hot, source: "g2", score: 4.6, reviewCount: 120, sentimentScore: 0.5, recordedAt: AT(9) },
    { competitorId: warm, source: "g2", score: 3.8, reviewCount: 40, sentimentScore: 0.1, recordedAt: AT(9) },
    { competitorId: self, source: "g2", score: 5, reviewCount: 10, sentimentScore: 0.9, recordedAt: AT(9) },
    { competitorId: foreign, source: "g2", score: 5, reviewCount: 10, sentimentScore: 0.9, recordedAt: AT(9) },
  ]);

  // `hot` is the most recently scraped and the loudest: a flat "most recent N
  // complaints" read would return only its rows and drop `warm` entirely.
  await testDb.insert(reviews).values([
    ...Array.from({ length: 12 }, (_, i) => ({
      competitorId: hot,
      source: "g2" as const,
      author: "complaint",
      content: `hot complaint ${i}`,
      detectedAt: AT(20 + (i % 5)),
    })),
    { competitorId: warm, source: "g2" as const, author: "complaint", content: "warm complaint", detectedAt: AT(2) },
    { competitorId: warm, source: "g2" as const, author: "praise", content: "warm praise", detectedAt: AT(2) },
  ]);
}, HOOK_TIMEOUT_MS);

function run(name: string, orgId: string, args: Record<string, unknown> = {}) {
  const tool = tools.getAskTool(name);
  if (!tool) throw new Error(`tool ${name} not registered`);
  return tool.run(orgId, args);
}

describe("rankHiring", () => {
  test("ranks the WHOLE roster in one call, self and other orgs excluded", async () => {
    const r = (await run("rankHiring", A.orgId)) as {
      rosterSize: number;
      ranking: Array<{ name: string; totalOpen: number; capturedAt: string | null }>;
      noData: string[];
    };
    // Four rivals: three with counts, one silent. The self competitor is not one.
    expect(r.rosterSize).toBe(4);
    expect(r.ranking.map((x) => x.name)).toEqual(["Vantage", "Northwind", "Baseline"]);
    // Latest batch only (18 + 7), never the stale 2.
    expect(r.ranking[0]?.totalOpen).toBe(25);
    expect(r.noData).toEqual(["Quietco"]);
    expect(r.ranking.some((x) => x.name === "OwnProduct" || x.name === "Outsider")).toBe(false);
  });

  test("dates every ranked row so a stale count cannot read as current", async () => {
    const r = (await run("rankHiring", A.orgId)) as {
      ranking: Array<{ capturedAt: string | null }>;
    };
    for (const row of r.ranking) expect(row.capturedAt).toBeTruthy();
  });

  test("an org with no competitors yields an empty ranking, not an error", async () => {
    const empty = await seedOrg(testDb);
    const r = (await run("rankHiring", empty.orgId)) as { ranking: unknown[]; noData: unknown[] };
    expect(r.ranking).toEqual([]);
    expect(r.noData).toEqual([]);
  });
});

describe("rankPricing", () => {
  test("sorts by entry price and pushes quote-only competitors last", async () => {
    const r = (await run("rankPricing", A.orgId)) as {
      rosterSize: number;
      ranking: Array<{ name: string; entry: number | null; top: number | null }>;
      noData: string[];
    };
    expect(r.rosterSize).toBe(4);
    expect(r.ranking.map((x) => x.name)).toEqual(["Northwind", "Vantage", "Baseline"]);
    expect(r.ranking[0]).toMatchObject({ entry: 12, top: 240 });
    // Quote-based tiers join the plan list but never the comparable band.
    expect(r.ranking[1]).toMatchObject({ entry: 90, top: 90 });
    expect(r.ranking[2]?.entry).toBeNull();
    expect(r.noData).toEqual(["Quietco"]);
  });
});

describe("rankReviews", () => {
  test("ranks by best score and keeps complaints for the quiet competitors too", async () => {
    const r = (await run("rankReviews", A.orgId)) as {
      ranking: Array<{ name: string; bestScore: number | null; complaints: string[] }>;
      noData: string[];
    };
    expect(r.ranking.map((x) => x.name)).toEqual(["Vantage", "Northwind"]);
    expect(r.ranking[0]?.bestScore).toBe(4.6);
    // Capped per competitor, so the loudest cannot starve the rest of the roster.
    expect(r.ranking[0]?.complaints).toHaveLength(3);
    expect(r.ranking[1]?.complaints).toEqual(["warm complaint"]);
    expect(r.noData.sort()).toEqual(["Baseline", "Quietco"]);
  });
});

describe("listCompetitors", () => {
  test("flags the org's own product instead of listing it as a rival", async () => {
    const r = (await run("listCompetitors", A.orgId)) as {
      competitors: Array<{ name: string; isSelf?: boolean }>;
    };
    const own = r.competitors.find((c) => c.name === "OwnProduct");
    expect(own?.isSelf).toBe(true);
    expect(r.competitors.filter((c) => c.isSelf)).toHaveLength(1);
    expect(r.competitors.some((c) => c.name === "Outsider")).toBe(false);
  });
});

describe("getSignals", () => {
  test("reports the real match count when the page is truncated", async () => {
    const org = await seedOrg(testDb);
    const cid = await seedCompetitor(org.orgId, "Busy");
    const n = 45;
    await testDb.insert(monitors).values(
      Array.from({ length: n }, (_, i) => ({
        id: `ask-mon-${i}`,
        competitorId: cid,
        sourceType: "homepage" as const,
      })),
    );
    await testDb.insert(snapshots).values(
      Array.from({ length: n }, (_, i) => ({
        id: `ask-snp-${i}`,
        monitorId: `ask-mon-${i}`,
        r2Key: `ask-k-${i}`,
        contentHash: `ask-h-${i}`,
      })),
    );
    await testDb.insert(changes).values(
      Array.from({ length: n }, (_, i) => ({
        id: `ask-chg-${i}`,
        monitorId: `ask-mon-${i}`,
        snapshotAfterId: `ask-snp-${i}`,
      })),
    );
    await testDb.insert(signals).values(
      Array.from({ length: n }, (_, i) => ({
        id: `ask-sig-${i}`,
        changeId: `ask-chg-${i}`,
        orgId: org.orgId,
        competitorId: cid,
        severity: "low" as const,
        category: "product" as const,
        insight: `insight ${i}`,
      })),
    );

    const r = (await run("getSignals", org.orgId)) as {
      total: number;
      returned: number;
      truncated: boolean;
      signals: unknown[];
    };
    expect(r.total).toBe(n);
    expect(r.returned).toBe(40);
    expect(r.truncated).toBe(true);
    expect(r.signals).toHaveLength(40);
  });
});
