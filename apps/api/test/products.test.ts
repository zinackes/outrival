import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import { eq } from "drizzle-orm";
import { changes, competitors, monitors, pricingHistory, signals, snapshots } from "@outrival/db";
import { makeTestDb, type TestDb } from "./db-harness";
import { asUser, installAppMocks, mountApp, seedOrg } from "./app-harness";

// products (patch-28) carries the multi-SKU model: every :id handler resolves the
// product via ownedProduct(id, orgId), and the attach handler additionally re-scopes
// the competitor to the org. These lock tenant isolation (no cross-org read/mutate,
// no pulling another tenant's competitor into your product) + the per-tier limit.
let app: Hono;
let testDb: TestDb;
let closeDb: () => Promise<void>;
let A: { orgId: string; userId: string; email: string };
let B: { orgId: string; userId: string; email: string };
let productA: string;

afterAll(() => closeDb());

// PGlite migrates the whole schema on first use and this file seeds three orgs,
// which runs past bun's 5s hook default on a cold VM.
const HOOK_TIMEOUT_MS = 30_000;

beforeAll(async () => {
  ({ db: testDb, close: closeDb } = await makeTestDb());
  await installAppMocks(testDb);
  const { productsRouter } = await import("../src/routes/products");
  app = mountApp("/api/products", productsRouter);

  A = await seedOrg(testDb, { plan: "free" });
  B = await seedOrg(testDb, { plan: "free" });
  // A normal competitor in each org, for the attach / cross-tenant tests.
  await testDb.insert(competitors).values([
    { id: "comp-a", orgId: A.orgId, name: "Rival A" },
    { id: "comp-b", orgId: B.orgId, name: "Rival B" },
  ]);

  // Create org A's product through the API (no url → no monitor seeding / scrape
  // trigger). First product of the org, so it's primary.
  const res = await app.request(
    "/api/products",
    asUser(A.userId, A.email, { method: "POST", body: JSON.stringify({ name: "Flagship" }) }),
  );
  expect(res.status).toBe(201);
  productA = (await res.json()).product.id;
}, HOOK_TIMEOUT_MS);

const get = (u: { userId: string; email: string }, id: string) =>
  app.request(`/api/products/${id}`, asUser(u.userId, u.email));

describe("products tenant isolation (IDOR)", () => {
  test("owner reads their own product", async () => {
    const res = await get(A, productA);
    expect(res.status).toBe(200);
    expect((await res.json()).product.id).toBe(productA);
  });

  test("a foreign org cannot read another org's product (404)", async () => {
    expect((await get(B, productA)).status).toBe(404);
  });

  test("a foreign org's PATCH is a 404 and does not mutate", async () => {
    const res = await app.request(
      `/api/products/${productA}`,
      asUser(B.userId, B.email, { method: "PATCH", body: JSON.stringify({ name: "Hijacked" }) }),
    );
    expect(res.status).toBe(404);
    expect((await (await get(A, productA)).json()).product.name).toBe("Flagship");
  });

  test("a foreign org's DELETE is a 404 (product stays active)", async () => {
    const res = await app.request(
      `/api/products/${productA}`,
      asUser(B.userId, B.email, { method: "DELETE" }),
    );
    expect(res.status).toBe(404);
    expect((await (await get(A, productA)).json()).product.status).toBe("active");
  });
});

describe("products competitor attach scoping", () => {
  test("owner can attach a competitor from their own org", async () => {
    const res = await app.request(
      `/api/products/${productA}/competitors/comp-a`,
      asUser(A.userId, A.email, { method: "POST", body: JSON.stringify({}) }),
    );
    expect(res.status).toBe(200);
    const linked = (await (await get(A, productA)).json()).competitors;
    expect(linked.map((x: { competitorId: string }) => x.competitorId)).toContain("comp-a");
  });

  test("cannot attach another tenant's competitor (no cross-org bridge)", async () => {
    const res = await app.request(
      `/api/products/${productA}/competitors/comp-b`,
      asUser(A.userId, A.email, { method: "POST", body: JSON.stringify({}) }),
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Competitor not found");
  });

  test("a foreign org cannot attach to another org's product", async () => {
    const res = await app.request(
      `/api/products/${productA}/competitors/comp-b`,
      asUser(B.userId, B.email, { method: "POST", body: JSON.stringify({}) }),
    );
    expect(res.status).toBe(404);
  });
});

describe("products per-tier limit + invariants", () => {
  test("a free org cannot create a second product (plan_limit_products)", async () => {
    const res = await app.request(
      "/api/products",
      asUser(A.userId, A.email, { method: "POST", body: JSON.stringify({ name: "Second" }) }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("plan_limit_products");
  });

  test("the primary product cannot be archived", async () => {
    const res = await app.request(
      `/api/products/${productA}`,
      asUser(A.userId, A.email, { method: "DELETE" }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("primary_product");
  });
});

// The portfolio compares products on capture health and on what moved around
// them, so the list handler now carries those aggregates. They are derived from
// product_competitors (not from signals.product_ids), which is what makes a
// pre-patch-28 signal count and a shared competitor count for both its products.
describe("GET /products portfolio aggregates", () => {
  test("a product with no monitors and no signals reports zeros, never nulls", async () => {
    const res = await app.request("/api/products", asUser(A.userId, A.email));
    const body = (await res.json()) as { products: Record<string, any>[] };
    const item = body.products.find((p) => p.id === productA);

    expect(item?.stage).toBe("idea"); // created with no url and no repo
    expect(item?.lastScanAt).toBeNull();
    expect(item?.coverage).toEqual({ sources: 0, failing: 0, failingSource: null });
    expect(item?.activity).toHaveLength(14);
    expect(item?.stats).toMatchObject({ signals7d: 0, signalsPrev: 0, critical7d: 0 });
  });

  test("signals on a linked competitor land on the product's own row", async () => {
    // comp-a was attached to productA by the attach test above.
    await testDb
      .insert(monitors)
      .values({ id: "mon-pa", competitorId: "comp-a", sourceType: "homepage", isActive: true });
    await testDb
      .insert(snapshots)
      .values({ id: "snp-pa", monitorId: "mon-pa", r2Key: "k", contentHash: "h" });
    const at = new Date(Date.now() - 2 * 24 * 3600 * 1000);
    await testDb
      .insert(changes)
      .values({ id: "chg-pa", monitorId: "mon-pa", snapshotAfterId: "snp-pa", detectedAt: at });
    await testDb.insert(signals).values({
      id: "sig-pa",
      changeId: "chg-pa",
      orgId: A.orgId,
      competitorId: "comp-a",
      severity: "critical",
      category: "pricing",
      insight: "Entry tier moved",
      createdAt: at,
    });

    const res = await app.request("/api/products", asUser(A.userId, A.email));
    const body = (await res.json()) as { products: Record<string, any>[] };
    const item = body.products.find((p) => p.id === productA);

    expect(item?.stats).toMatchObject({ signals7d: 1, critical7d: 1 });
    // Oldest day first: two days ago is the twelfth of fourteen buckets.
    expect(item?.activity[11]).toBe(1);
    expect((item?.activity as number[]).reduce((a, b) => a + b, 0)).toBe(1);
  });

  test("a monitor that refused us is named, and does not count as reporting", async () => {
    const detail = await (await get(A, productA)).json();
    await testDb.insert(monitors).values([
      {
        id: "mon-self-home",
        competitorId: detail.product.selfCompetitorId,
        sourceType: "homepage",
        isActive: true,
        lastRunAt: new Date(),
      },
      {
        id: "mon-self-price",
        competitorId: detail.product.selfCompetitorId,
        sourceType: "pricing",
        isActive: true,
        markedUnscrapable: true,
      },
      // Internal anchors are infrastructure: they must not inflate the count.
      {
        id: "mon-self-news",
        competitorId: detail.product.selfCompetitorId,
        sourceType: "news",
        isActive: true,
      },
    ]);

    const res = await app.request("/api/products", asUser(A.userId, A.email));
    const body = (await res.json()) as { products: Record<string, any>[] };
    const item = body.products.find((p) => p.id === productA);

    expect(item?.coverage).toEqual({ sources: 2, failing: 1, failingSource: "pricing" });
    expect(item?.lastScanAt).not.toBeNull();
  });
});

describe("GET /products/:id linked competitors", () => {
  // The Competitors tab leads with the finding, so the row needs what the
  // competitor last DID. Unwindowed on purpose: a competitor silent for weeks
  // still has a last move, and that is the useful thing its row can say.
  test("each linked competitor carries its latest signal", async () => {
    const body = await (await get(A, productA)).json();
    const linked = body.competitors.find(
      (c: { competitorId: string }) => c.competitorId === "comp-a",
    );
    expect(linked.latestMove).toMatchObject({
      insight: "Entry tier moved",
      severity: "critical",
      category: "pricing",
    });
  });

  test("a competitor with no signal reports null, not a missing key", async () => {
    await testDb
      .insert(competitors)
      .values({ id: "comp-quiet", orgId: A.orgId, name: "Quiet Co" });
    await app.request(
      `/api/products/${productA}/competitors/comp-quiet`,
      asUser(A.userId, A.email, { method: "POST", body: JSON.stringify({}) }),
    );
    const body = await (await get(A, productA)).json();
    const linked = body.competitors.find(
      (c: { competitorId: string }) => c.competitorId === "comp-quiet",
    );
    expect(linked.latestMove).toBeNull();
  });
});

describe("price position", () => {
  // A fresh org so the ladder is exactly what this test seeds.
  let P: { orgId: string; userId: string; email: string };
  let productP: string;
  let selfP: string;

  const priceRow = (competitorId: string, planName: string, price: number | null) => ({
    competitorId,
    planName,
    price,
    currency: "USD",
    billingPeriod: "monthly",
    recordedAt: new Date(),
  });

  beforeAll(async () => {
    P = await seedOrg(testDb, { plan: "pro" });
    const created = await app.request(
      "/api/products",
      asUser(P.userId, P.email, { method: "POST", body: JSON.stringify({ name: "Priced" }) }),
    );
    productP = (await created.json()).product.id;
    selfP = (await (await get(P, productP)).json()).product.selfCompetitorId;

    await testDb.insert(competitors).values([
      { id: "riv-cheap", orgId: P.orgId, name: "Cheap Co" },
      { id: "riv-mid", orgId: P.orgId, name: "Mid Co" },
      { id: "riv-dear", orgId: P.orgId, name: "Dear Co" },
      { id: "riv-quote", orgId: P.orgId, name: "Quote Co" },
    ]);
    for (const id of ["riv-cheap", "riv-mid", "riv-dear", "riv-quote"]) {
      await app.request(
        `/api/products/${productP}/competitors/${id}`,
        asUser(P.userId, P.email, { method: "POST", body: JSON.stringify({}) }),
      );
    }

    await testDb.insert(pricingHistory).values([
      // Ours: a free tier that must NOT be read as the entry price.
      priceRow(selfP, "Free", 0),
      priceRow(selfP, "Starter", 49),
      priceRow("riv-cheap", "Basic", 69),
      priceRow("riv-mid", "Team", 99),
      priceRow("riv-dear", "Growth", 149),
      // Quote-based only: a real competitor, but not on the price axis.
      priceRow("riv-quote", "Enterprise", null),
    ]);
  }, HOOK_TIMEOUT_MS);

  test("the ladder puts our cheapest paid tier against the priced rivals", async () => {
    const res = await app.request(
      `/api/products/${productP}/pricing-position`,
      asUser(P.userId, P.email),
    );
    const body = await res.json();
    expect(body.mine).toMatchObject({ planName: "Starter", price: 49 });
    expect(body.median).toBe(99);
    expect(body.quoteOnly).toBe(1);
    expect(body.rivals.find((r: any) => r.competitorId === "riv-quote").comparable).toBe(false);
    expect(body.rivals.find((r: any) => r.competitorId === "riv-dear").entry.price).toBe(149);
  });

  test("the list row carries the same numbers as the ladder", async () => {
    const res = await app.request("/api/products", asUser(P.userId, P.email));
    const body = (await res.json()) as { products: Record<string, any>[] };
    const item = body.products.find((p) => p.id === productP);
    expect(item?.pricing).toMatchObject({
      median: 99,
      low: 69,
      high: 149,
      rivalsPriced: 3,
      currency: "USD",
    });
    expect(item?.pricing.entry).toMatchObject({ price: 49 });
    expect(item?.topCompetitors).toHaveLength(3);
  });
});

describe("GET /products/:id/pricing-position", () => {
  test("a foreign org cannot read another org's price position (404)", async () => {
    const res = await app.request(
      `/api/products/${productA}/pricing-position`,
      asUser(B.userId, B.email),
    );
    expect(res.status).toBe(404);
  });

  test("with no priced competitor the ladder is empty rather than absent", async () => {
    const res = await app.request(
      `/api/products/${productA}/pricing-position`,
      asUser(A.userId, A.email),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mine).toBeNull();
    expect(body.median).toBeNull();
    // The linked competitors publish nothing, so every one of them reads as
    // quote-only rather than being dropped from the ladder.
    expect(body.rivals.length).toBeGreaterThan(0);
    expect(body.rivals.every((r: { comparable: boolean }) => !r.comparable)).toBe(true);
    expect(body.quoteOnly).toBe(body.rivals.length);
  });
});

describe("add-product wizard: synchronous profile seeding", () => {
  test("creating a product with a profile seeds the self-competitor's selfProfile", async () => {
    // A fresh pro org so this is its first (primary) product and under the limit.
    const C = await seedOrg(testDb, { plan: "pro" });
    const res = await app.request(
      "/api/products",
      asUser(C.userId, C.email, {
        method: "POST",
        body: JSON.stringify({
          name: "Analytics Suite",
          profile: {
            category: "Product analytics",
            audience: "Product managers",
            valueProp: "See what users actually do",
            pricingModel: "",
          },
        }),
      }),
    );
    expect(res.status).toBe(201);
    const productId = (await res.json()).product.id;

    // The wizard's whole point: the backing self-competitor carries the seeded,
    // auto-detected profile immediately — this is what unblocks discovery for a
    // freshly added SKU instead of waiting on the first async scrape.
    const detail = await (
      await app.request(`/api/products/${productId}`, asUser(C.userId, C.email))
    ).json();
    const [self] = await testDb
      .select()
      .from(competitors)
      .where(eq(competitors.id, detail.product.selfCompetitorId));
    expect(self?.type).toBe("self");
    expect(self?.selfProfile?.category?.value).toBe("Product analytics");
    expect(self?.selfProfile?.category?.isFromAutoDetect).toBe(true);
    expect(self?.selfProfile?.valueProp?.value).toBe("See what users actually do");
  });

  test("analyze rejects an invalid body before any AI call (400)", async () => {
    const res = await app.request(
      "/api/products/analyze",
      asUser(A.userId, A.email, {
        method: "POST",
        body: JSON.stringify({ mode: "url", url: "not-a-url" }),
      }),
    );
    expect(res.status).toBe(400);
  });
});
