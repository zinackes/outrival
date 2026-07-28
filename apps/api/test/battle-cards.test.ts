import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import {
  battleCards,
  changes,
  competitors,
  monitors,
  pricingHistory,
  reviewScores,
  signals,
  snapshots,
} from "@outrival/db";
import { makeTestDb, type TestDb } from "./db-harness";
import { asUser, installAppMocks, mountApp, seedOrg } from "./app-harness";

// Two things the redesigned battle-card page leans on: the readiness list must answer
// BEFORE a card exists (the empty state and the build view both show what the card
// will be written from), and staleness must name what actually moved rather than just
// flipping a button to amber.
let app: Hono;
let testDb: TestDb;
let closeDb: () => Promise<void>;

let A: { orgId: string; userId: string; email: string };
let B: { orgId: string; userId: string; email: string };

const HOOK_TIMEOUT_MS = 30_000;
const AT = (day: number) => new Date(Date.UTC(2026, 6, day, 9, 0, 0));

let seq = 0;

afterAll(() => closeDb());

beforeAll(async () => {
  ({ db: testDb, close: closeDb } = await makeTestDb());
  await installAppMocks(testDb);
  const mod = await import("../src/routes/battle-cards");
  app = mountApp("/api/competitors", mod.battleCardsRouter);
  A = await seedOrg(testDb);
  B = await seedOrg(testDb);
}, HOOK_TIMEOUT_MS);

async function seedCompetitor(orgId: string): Promise<string> {
  const id = `cmp-${++seq}`;
  await testDb
    .insert(competitors)
    .values({ id, orgId, name: `Rival ${seq}`, url: `https://rival${seq}.example` });
  return id;
}

async function seedSignal(opts: {
  orgId: string;
  competitorId: string;
  severity: "low" | "medium" | "high" | "critical";
  category: "pricing" | "product" | "content";
  createdAt: Date;
  actionStatus?: "dismissed";
}): Promise<void> {
  const n = ++seq;
  await testDb
    .insert(monitors)
    .values({ id: `mon-${n}`, competitorId: opts.competitorId, sourceType: "homepage" });
  await testDb
    .insert(snapshots)
    .values({ id: `snp-${n}`, monitorId: `mon-${n}`, r2Key: `k-${n}`, contentHash: `h-${n}` });
  await testDb
    .insert(changes)
    .values({ id: `chg-${n}`, monitorId: `mon-${n}`, snapshotAfterId: `snp-${n}` });
  await testDb.insert(signals).values({
    id: `sig-${n}`,
    changeId: `chg-${n}`,
    orgId: opts.orgId,
    competitorId: opts.competitorId,
    severity: opts.severity,
    category: opts.category,
    insight: "…",
    createdAt: opts.createdAt,
    ...(opts.actionStatus ? { actionStatus: opts.actionStatus } : {}),
  });
}

describe("GET /:id/battle-card/evidence", () => {
  test("answers before any card exists, and says what each source holds", async () => {
    const competitorId = await seedCompetitor(A.orgId);
    await testDb.insert(pricingHistory).values([
      {
        competitorId,
        planName: "Free",
        price: 0,
        currency: "USD",
        billingPeriod: "monthly",
        recordedAt: AT(26),
      },
      {
        competitorId,
        planName: "Pro",
        price: 49,
        currency: "USD",
        billingPeriod: "monthly",
        recordedAt: AT(26),
      },
    ]);

    const res = await app.request(
      `/api/competitors/${competitorId}/battle-card/evidence`,
      asUser(A.userId, A.email),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      evidence: {
        confidence: string | null;
        sources: Array<{ kind: string; present: boolean; detail: string | null }>;
      };
    };

    // No card yet → nothing to score, but the readiness still answers.
    expect(body.evidence.confidence).toBeNull();
    expect(body.evidence.sources).toHaveLength(4);

    const pricing = body.evidence.sources.find((s) => s.kind === "pricing")!;
    expect(pricing.present).toBe(true);
    expect(pricing.detail).toBe("2 plans, $0 to $49");

    const reviews = body.evidence.sources.find((s) => s.kind === "reviews")!;
    expect(reviews.present).toBe(false);
    expect(reviews.detail).toBeNull();
  });

  test("a review score comes back as a readable fact", async () => {
    const competitorId = await seedCompetitor(A.orgId);
    await testDb.insert(reviewScores).values({
      competitorId,
      source: "g2",
      score: 4.2,
      reviewCount: 128,
      sentimentScore: 0.6,
      recordedAt: AT(24),
    });

    const res = await app.request(
      `/api/competitors/${competitorId}/battle-card/evidence`,
      asUser(A.userId, A.email),
    );
    const body = (await res.json()) as {
      evidence: { sources: Array<{ kind: string; detail: string | null }> };
    };
    expect(body.evidence.sources.find((s) => s.kind === "reviews")!.detail).toBe(
      "4.2 from 128 reviews",
    );
  });

  test("a foreign org cannot read another org's readiness (404)", async () => {
    const competitorId = await seedCompetitor(A.orgId);
    const res = await app.request(
      `/api/competitors/${competitorId}/battle-card/evidence`,
      asUser(B.userId, B.email),
    );
    expect(res.status).toBe(404);
  });
});

describe("GET /:id/battle-card/staleness", () => {
  test("names what moved since the card, by category", async () => {
    const competitorId = await seedCompetitor(A.orgId);
    await testDb.insert(battleCards).values({
      id: `bc-${++seq}`,
      competitorId,
      orgId: A.orgId,
      content: {},
      generatedAt: AT(10),
      basedOnCompetitorSignalAt: AT(10),
    });

    // Two pricing + one product land after the card; the low-severity one and the
    // dismissed one must not count, or the badge would contradict the staleness rule
    // that produced it.
    await seedSignal({ orgId: A.orgId, competitorId, severity: "high", category: "pricing", createdAt: AT(12) });
    await seedSignal({ orgId: A.orgId, competitorId, severity: "critical", category: "pricing", createdAt: AT(13) });
    await seedSignal({ orgId: A.orgId, competitorId, severity: "medium", category: "product", createdAt: AT(14) });
    await seedSignal({ orgId: A.orgId, competitorId, severity: "low", category: "content", createdAt: AT(15) });
    await seedSignal({
      orgId: A.orgId,
      competitorId,
      severity: "high",
      category: "content",
      createdAt: AT(16),
      actionStatus: "dismissed",
    });
    // Older than the card → not "since".
    await seedSignal({ orgId: A.orgId, competitorId, severity: "high", category: "content", createdAt: AT(2) });

    const res = await app.request(
      `/api/competitors/${competitorId}/battle-card/staleness`,
      asUser(A.userId, A.email),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      needsRegeneration: boolean;
      since: { total: number; byCategory: Array<{ category: string; count: number }> };
    };

    expect(body.needsRegeneration).toBe(true);
    expect(body.since.total).toBe(3);
    // Sorted by count, so the header names the loudest category first.
    expect(body.since.byCategory).toEqual([
      { category: "pricing", count: 2 },
      { category: "product", count: 1 },
    ]);
  });

  test("with no card there is nothing to compare against", async () => {
    const competitorId = await seedCompetitor(A.orgId);
    const res = await app.request(
      `/api/competitors/${competitorId}/battle-card/staleness`,
      asUser(A.userId, A.email),
    );
    const body = (await res.json()) as { staleness: string; since: null };
    expect(body.staleness).toBe("never_generated");
    expect(body.since).toBeNull();
  });
});
