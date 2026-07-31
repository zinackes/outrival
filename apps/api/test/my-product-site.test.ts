import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { resolve } from "node:path";
import type { Hono } from "hono";
import { eq } from "drizzle-orm";
import { competitors, products } from "@outrival/db";
import { makeTestDb, type TestDb } from "./db-harness";
import { asUser, installAppMocks, mountApp, seedOrg } from "./app-harness";

// POST /my-product/site — going live must rename BOTH rows a product's identity
// lives on: the self-competitor (monitoring anchor) AND the products row, which is
// what the switcher, page titles and settings list actually display. A
// description/PDF product used to stay "My product" everywhere after going live
// because only the competitor was renamed. The rename is first-URL-only and
// placeholder-only, so a user-chosen SKU name is never clobbered.
let app: Hono;
let testDb: TestDb;
let closeDb: () => Promise<void>;
let A: { orgId: string; userId: string; email: string };

afterAll(() => closeDb());

const HOOK_TIMEOUT_MS = 30_000;

beforeAll(async () => {
  ({ db: testDb, close: closeDb } = await makeTestDb());
  await installAppMocks(testDb);
  mock.module(resolve(import.meta.dir, "../src/lib/queue"), () => ({
    enqueueJob: async () => "run_test",
  }));
  const { myProductRouter } = await import("../src/routes/my-product");
  app = mountApp("/api/my-product", myProductRouter);

  A = await seedOrg(testDb, { plan: "pro" });
}, HOOK_TIMEOUT_MS);

async function seedProduct(opts: {
  id: string;
  productName: string;
  selfName: string;
  url?: string | null;
  isPrimary?: boolean;
}) {
  const selfId = `self-${opts.id}`;
  await testDb.insert(competitors).values({
    id: selfId,
    orgId: A.orgId,
    name: opts.selfName,
    url: opts.url ?? null,
    type: "self",
    isUserProduct: true,
  });
  await testDb.insert(products).values({
    id: opts.id,
    orgId: A.orgId,
    name: opts.productName,
    selfCompetitorId: selfId,
    isPrimary: opts.isPrimary ?? false,
    position: 0,
  });
  return selfId;
}

const setSite = (productId: string, url: string) =>
  app.request(
    `/api/my-product/site?productId=${productId}`,
    asUser(A.userId, A.email, { method: "POST", body: JSON.stringify({ url }) }),
  );

describe("go-live renames the product identity", () => {
  test("a placeholder-named product takes its first URL's hostname", async () => {
    const selfId = await seedProduct({
      id: "prod-placeholder",
      productName: "My product",
      selfName: "My product",
    });

    const res = await setSite("prod-placeholder", "https://acme-app.com");
    expect(res.status).toBe(200);

    const self = await testDb.query.competitors.findFirst({
      where: eq(competitors.id, selfId),
    });
    expect(self?.url).toBe("https://acme-app.com");
    expect(self?.name).toBe("acme-app.com");

    const product = await testDb.query.products.findFirst({
      where: eq(products.id, "prod-placeholder"),
    });
    expect(product?.name).toBe("acme-app.com");
  });

  test("a user-chosen product name survives going live", async () => {
    const selfId = await seedProduct({
      id: "prod-named",
      productName: "Flagship",
      selfName: "My product",
    });

    const res = await setSite("prod-named", "https://flagship-app.com");
    expect(res.status).toBe(200);

    // The anchor still takes the hostname (pre-existing behaviour)…
    const self = await testDb.query.competitors.findFirst({
      where: eq(competitors.id, selfId),
    });
    expect(self?.name).toBe("flagship-app.com");

    // …but the displayed SKU name is the user's, and stays.
    const product = await testDb.query.products.findFirst({
      where: eq(products.id, "prod-named"),
    });
    expect(product?.name).toBe("Flagship");
  });

  test("a URL change on an already-live product renames nothing", async () => {
    await seedProduct({
      id: "prod-live",
      productName: "My product",
      selfName: "already-live.com",
      url: "https://already-live.com",
    });

    const res = await setSite("prod-live", "https://new-domain.com");
    expect(res.status).toBe(200);

    const product = await testDb.query.products.findFirst({
      where: eq(products.id, "prod-live"),
    });
    // First-URL-only guard: renames are a go-live event, not a URL-change one.
    expect(product?.name).toBe("My product");
  });
});
