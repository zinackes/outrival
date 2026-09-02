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
  techStackEntries,
  techStackHistory,
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
    // Two months back — far enough to be the month-over-month comparison point.
    { competitorId: hot, department: "Engineering", count: 10, recordedAt: new Date(Date.UTC(2026, 4, 20)) },
    // A stale batch that must lose to the current one, and too RECENT to be the
    // comparison point (8 days back) — the trend must not silently use it.
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
    // Pro moved 70 → 90: the roster-wide "how has pricing shifted" answer.
    { competitorId: hot, planName: "Pro", price: 70, currency: "USD", billingPeriod: "monthly", recordedAt: AT(2) },
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

  test("carries a month-over-month delta, null when there is no older capture", async () => {
    const r = (await run("rankHiring", A.orgId)) as {
      ranking: Array<{
        name: string;
        openRolesChange: number | null;
        comparedTo: { totalOpen: number } | null;
      }>;
    };
    const top = r.ranking.find((x) => x.name === "Vantage");
    // 25 open now vs 10 two months ago. The 8-day-old batch is too recent to be the
    // comparison point, so a delta of 23 here would mean the window was ignored.
    expect(top?.openRolesChange).toBe(15);
    expect(top?.comparedTo?.totalOpen).toBe(10);
    // One capture only: no history is not "held flat".
    expect(r.ranking.find((x) => x.name === "Northwind")?.openRolesChange).toBeNull();
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

  test("carries the actual price moves, directioned old → new", async () => {
    const r = (await run("rankPricing", A.orgId)) as {
      ranking: Array<{
        name: string;
        recentChanges: Array<{ planName: string; from: number; to: number }>;
      }>;
    };
    const moved = r.ranking.find((x) => x.name === "Vantage");
    expect(moved?.recentChanges).toEqual([
      { planName: "Pro", from: 70, to: 90, billingPeriod: "monthly", at: expect.anything() },
    ]);
    // A competitor whose prices never moved reports an empty list, not a missing key.
    expect(r.ranking.find((x) => x.name === "Northwind")?.recentChanges).toEqual([]);
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

// The four single-competitor dimension tools, and the comparison that used to call
// each of them once per competitor (`code:PER-27`). They now share one batched read
// per dimension, so what has to be locked is that the batch stays KEYED: every
// competitor gets its own rows, its own per-competitor cap, and nothing from its
// neighbour — the two failure modes a per-row loop could not have.
describe("dimension tools over a batched read", () => {
  beforeAll(async () => {
    await testDb.insert(techStackEntries).values([
      { competitorId: hot, techId: "stripe", techName: "Stripe", category: "payments", importance: "high", evidence: [] },
      { competitorId: hot, techId: "segment", techName: "Segment", category: "analytics", importance: "medium", evidence: [] },
      // Dropped from the stack: present as a row, absent from `active`.
      { competitorId: hot, techId: "mixpanel", techName: "Mixpanel", category: "analytics", importance: "low", evidence: [], isActive: false },
      { competitorId: warm, techId: "vercel", techName: "Vercel", category: "hosting", importance: "high", evidence: [] },
    ]);
    // 22 events for `hot` against 1 much older one for `warm`: a cap applied to the
    // batch instead of to each competitor would return 20 rows of `hot` and lose
    // `warm`'s only event entirely.
    await testDb.insert(techStackHistory).values([
      ...Array.from({ length: 22 }, (_, i) => ({
        competitorId: hot,
        techId: `tech-${i}`,
        event: "appeared",
        importance: "low",
        recordedAt: AT(2 + i),
      })),
      { competitorId: warm, techId: "vercel", event: "appeared", importance: "high", recordedAt: AT(1) },
    ]);
  }, HOOK_TIMEOUT_MS);

  test("getPricingHistory returns the latest plans and the moves behind them", async () => {
    const r = (await run("getPricingHistory", A.orgId, { competitorId: hot })) as {
      competitor: string;
      plans: Array<{ planName: string; price: number | null }>;
      changes: Array<{ planName: string; price: number; prevPrice: number }>;
    };
    expect(r.competitor).toBe("Vantage");
    // Priced tiers first, quote-only last — the order the overlay resolver keeps.
    expect(r.plans.map((p) => [p.planName, p.price])).toEqual([
      ["Pro", 90],
      ["Enterprise", null],
    ]);
    expect(r.changes).toMatchObject([{ planName: "Pro", price: 90, prevPrice: 70 }]);
  });

  test("a competitor of another org is not a competitor of this one", async () => {
    for (const name of ["getPricingHistory", "getJobTrends", "getReviewThemes", "getTechStackChanges"]) {
      const r = (await run(name, A.orgId, { competitorId: foreign })) as Record<string, unknown[]>;
      expect(r.competitor).toBeUndefined();
      for (const v of Object.values(r)) expect(v).toEqual([]);
    }
  });

  test("compareCompetitors keeps every column on its own competitor", async () => {
    const r = (await run("compareCompetitors", A.orgId, { ids: [hot, warm] })) as {
      competitors: Array<{
        id: string;
        name: string;
        profile: { category: string | null };
        pricing: { plans: Array<{ planName: string }> };
        hiring: { totalOpen: number; departments: Array<{ department: string }> };
        reviews: { scores: Array<{ score: number }>; praises: string[]; complaints: string[] };
        tech: { active: Array<{ techName: string }>; changes: unknown[] };
      }>;
    };
    expect(r.competitors.map((c) => c.id)).toEqual([hot, warm]);
    const [v, n] = r.competitors;

    expect(v?.pricing.plans.map((p) => p.planName).sort()).toEqual(["Enterprise", "Pro"]);
    expect(n?.pricing.plans.map((p) => p.planName).sort()).toEqual(["Scale", "Starter"]);

    // hot's latest batch is Engineering 18 + Sales 7; the stale batch is not in it.
    expect(v?.hiring.totalOpen).toBe(25);
    expect(n?.hiring.totalOpen).toBe(9);
    expect(n?.hiring.departments.map((d) => d.department)).toEqual(["Engineering"]);

    expect(v?.reviews.scores.map((x) => x.score)).toEqual([4.6]);
    expect(n?.reviews.scores.map((x) => x.score)).toEqual([3.8]);
    // Sliced per competitor: 12 complaints become 8, and the quiet one keeps its own.
    expect(v?.reviews.complaints).toHaveLength(8);
    expect(n?.reviews.complaints).toEqual(["warm complaint"]);
    expect(n?.reviews.praises).toEqual(["warm praise"]);

    expect(v?.tech.active.map((t) => t.techName).sort()).toEqual(["Segment", "Stripe"]);
    expect(n?.tech.active.map((t) => t.techName)).toEqual(["Vercel"]);
    // 20 per competitor, and `warm`'s single older event survives the batch.
    expect(v?.tech.changes).toHaveLength(20);
    expect(n?.tech.changes).toHaveLength(1);
  });

  test("an unowned id is dropped, the owned ones are still answered", async () => {
    const r = (await run("compareCompetitors", A.orgId, { ids: [hot, foreign] })) as {
      competitors: Array<{ id: string }>;
    };
    expect(r.competitors.map((c) => c.id)).toEqual([hot]);
  });

  test("a named dimension is the only one read", async () => {
    const r = (await run("compareCompetitors", A.orgId, {
      ids: [hot, warm],
      dimension: "pricing",
    })) as { competitors: Array<Record<string, unknown>> };
    for (const col of r.competitors) {
      expect(col.pricing).toBeDefined();
      expect(col.hiring).toBeUndefined();
      expect(col.reviews).toBeUndefined();
      expect(col.tech).toBeUndefined();
    }
  });
});
