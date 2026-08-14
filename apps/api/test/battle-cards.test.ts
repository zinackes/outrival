import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import {
  battleCards,
  changes,
  competitors,
  monitors,
  pricingHistory,
  productCompetitors,
  products,
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

/** A SKU, with the self-competitor it anchors monitoring on (patch-28). */
async function seedProduct(orgId: string, opts: { isPrimary: boolean }): Promise<string> {
  const n = ++seq;
  const selfId = `self-${n}`;
  await testDb
    .insert(competitors)
    .values({ id: selfId, orgId, name: `Product ${n}`, type: "self" });
  const id = `prod-${n}`;
  await testDb.insert(products).values({
    id,
    orgId,
    name: `Product ${n}`,
    selfCompetitorId: selfId,
    isPrimary: opts.isPrimary,
    position: n,
  });
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

// OUT-186 — the two absences the endpoint used to answer with the same 404: a
// competitor with no card yet (normal, the page offers to generate one) and a
// competitor that isn't there (a real miss).
describe("GET /:id/battle-card", () => {
  test("a competitor with no card yet answers 200 with a null card", async () => {
    const competitorId = await seedCompetitor(A.orgId);
    const res = await app.request(
      `/api/competitors/${competitorId}/battle-card`,
      asUser(A.userId, A.email),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { battleCard: null };
    expect(body.battleCard).toBeNull();
  });

  test("the card comes back once it exists", async () => {
    const competitorId = await seedCompetitor(A.orgId);
    const id = `bc-${++seq}`;
    await testDb.insert(battleCards).values({
      id,
      competitorId,
      orgId: A.orgId,
      content: {},
      generatedAt: AT(10),
    });

    const res = await app.request(
      `/api/competitors/${competitorId}/battle-card`,
      asUser(A.userId, A.email),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { battleCard: { id: string } | null };
    expect(body.battleCard?.id).toBe(id);
  });

  test("a competitor of another org is still a 404", async () => {
    const competitorId = await seedCompetitor(A.orgId);
    const res = await app.request(
      `/api/competitors/${competitorId}/battle-card`,
      asUser(B.userId, B.email),
    );
    expect(res.status).toBe(404);
  });
});

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

  // In all-products scope the page sends no productId, so the SKU a card belongs to
  // is decided here — and the page has to be told which one it landed on. It used to
  // guess, fall back to the org's primary, and title a card written for one product
  // with the name of another.
  test("names the product the competitor is actually tracked for, not the primary", async () => {
    // Its own org: the other tests here are written for an org with no SKU yet, and
    // adding products to theirs would change which card every one of them resolves to.
    const multi = await seedOrg(testDb);
    const competitorId = await seedCompetitor(multi.orgId);
    const secondary = await seedProduct(multi.orgId, { isPrimary: false });
    await seedProduct(multi.orgId, { isPrimary: true });
    await testDb.insert(productCompetitors).values({ productId: secondary, competitorId });

    const res = await app.request(
      `/api/competitors/${competitorId}/battle-card/evidence`,
      asUser(multi.userId, multi.email),
    );
    const body = (await res.json()) as { productId: string | null };
    expect(body.productId).toBe(secondary);
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
