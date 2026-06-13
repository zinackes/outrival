import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import { competitors } from "@outrival/db";
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
});

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
