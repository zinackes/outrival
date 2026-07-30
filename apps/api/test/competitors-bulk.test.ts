import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { resolve } from "node:path";
import type { Hono } from "hono";
import { eq } from "drizzle-orm";
import { competitors, monitors, productCompetitors, products } from "@outrival/db";
import { makeTestDb, type TestDb } from "./db-harness";
import { asUser, installAppMocks, mountApp, seedOrg } from "./app-harness";

// The roster's bulk actions. What must hold for every one of them: it resolves the
// selection org-scoped (another tenant's id is simply absent, never an error), it
// leaves the self-product alone, and it reports what it actually changed. These are
// POST /bulk/* routes registered ahead of "/:id/…", so a regression in registration
// order shows up here as a 404 rather than in production.
let app: Hono;
let testDb: TestDb;
let closeDb: () => Promise<void>;
let A: { orgId: string; userId: string; email: string };
let B: { orgId: string; userId: string; email: string };

afterAll(() => closeDb());

beforeAll(async () => {
  ({ db: testDb, close: closeDb } = await makeTestDb());
  await installAppMocks(testDb);
  mock.module(resolve(import.meta.dir, "../src/lib/queue"), () => ({
    enqueueJob: async () => "run_test",
    enqueueByName: async () => "run_test",
    ensureQueue: async () => {},
    USER_SCRAPE_PRIORITY: 10,
  }));
  const { competitorsRouter } = await import("../src/routes/competitors");
  app = mountApp("/api/competitors", competitorsRouter);

  A = await seedOrg(testDb, { plan: "pro" });
  B = await seedOrg(testDb, { plan: "pro" });

  await testDb.insert(competitors).values([
    { id: "a-1", orgId: A.orgId, name: "Rival One", url: "https://one.example" },
    { id: "a-2", orgId: A.orgId, name: "Rival Two", url: "https://two.example" },
    { id: "a-self", orgId: A.orgId, name: "Us", type: "self", url: "https://us.example" },
    { id: "b-1", orgId: B.orgId, name: "Other tenant", url: "https://other.example" },
  ]);
  await testDb.insert(monitors).values(
    ["a-1", "a-2"].map((competitorId) => ({ competitorId, sourceType: "homepage" as const })),
  );
}, 30_000);

const post = (path: string, body: unknown, who = A) =>
  app.request(
    `/api/competitors${path}`,
    asUser(who.userId, who.email, { method: "POST", body: JSON.stringify(body) }),
  );

async function flags(id: string) {
  const [row] = await testDb
    .select({
      monitoringPaused: competitors.monitoringPaused,
      alertsMuted: competitors.alertsMuted,
      deletedAt: competitors.deletedAt,
    })
    .from(competitors)
    .where(eq(competitors.id, id));
  return row!;
}

describe("POST /competitors/bulk/monitoring", () => {
  test("pauses the selection and skips ids from another org", async () => {
    const res = await post("/bulk/monitoring", { ids: ["a-1", "a-2", "b-1"], paused: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ updated: 2, paused: true });
    expect((await flags("a-1")).monitoringPaused).toBe(true);
    expect((await flags("b-1")).monitoringPaused).toBe(false);
  });

  test("resumes them again", async () => {
    const res = await post("/bulk/monitoring", { ids: ["a-1", "a-2"], paused: false });
    expect(res.status).toBe(200);
    expect((await flags("a-2")).monitoringPaused).toBe(false);
  });

  test("never touches the self-product", async () => {
    const res = await post("/bulk/monitoring", { ids: ["a-self"], paused: true });
    expect(await res.json()).toMatchObject({ updated: 0 });
    expect((await flags("a-self")).monitoringPaused).toBe(false);
  });
});

describe("POST /competitors/bulk/alerts", () => {
  test("mutes the selection", async () => {
    const res = await post("/bulk/alerts", { ids: ["a-1", "a-2"], muted: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ updated: 2, muted: true });
    expect((await flags("a-1")).alertsMuted).toBe(true);
  });
});

describe("POST /competitors/bulk/sources", () => {
  test("adds a source only where it is missing", async () => {
    const res = await post("/bulk/sources", { ids: ["a-1", "a-2"], sourceType: "changelog" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ created: 2, competitorsTouched: 2 });

    const again = await post("/bulk/sources", { ids: ["a-1", "a-2"], sourceType: "changelog" });
    expect(await again.json()).toMatchObject({ created: 0 });
  });

  test("refuses a source that needs a per-competitor URL", async () => {
    const res = await post("/bulk/sources", { ids: ["a-1"], sourceType: "github_repo" });
    expect(res.status).toBe(400);
  });
});

describe("POST /competitors/bulk/product", () => {
  test("moves the selection to one product", async () => {
    await testDb
      .insert(products)
      .values([
        { id: "prod-1", orgId: A.orgId, name: "Main", selfCompetitorId: "a-self", isPrimary: true },
      ]);
    const res = await post("/bulk/product", { ids: ["a-1", "a-2"], productId: "prod-1" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ moved: 2 });
    const links = await testDb
      .select({ competitorId: productCompetitors.competitorId })
      .from(productCompetitors)
      .where(eq(productCompetitors.productId, "prod-1"));
    expect(links.map((l) => l.competitorId).sort()).toEqual(["a-1", "a-2"]);
  });

  test("404s on a product from another org", async () => {
    const res = await post("/bulk/product", { ids: ["a-1"], productId: "nope" });
    expect(res.status).toBe(404);
  });
});

describe("POST /competitors/bulk/delete", () => {
  test("soft-deletes the selection", async () => {
    const res = await post("/bulk/delete", { ids: ["a-2", "b-1"] });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ deleted: 1 });
    expect((await flags("a-2")).deletedAt).not.toBeNull();
    expect((await flags("b-1")).deletedAt).toBeNull();
  });
});

describe("bulk input guards", () => {
  test("rejects an empty selection", async () => {
    const res = await post("/bulk/delete", { ids: [] });
    expect(res.status).toBe(400);
  });
});
