import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import { eq } from "drizzle-orm";
import { competitors, monitors, organizations } from "@outrival/db";
import { makeTestDb, type TestDb } from "./db-harness";
import { asUser, installAppMocks, installQueueMock, mountApp, seedOrg } from "./app-harness";

// Monitoring defaults: which sources a new competitor starts with, and the
// retroactive "apply to existing competitors" action behind the settings card and
// the upgrade banner. What must hold: plan gating decides the set (a free org is
// unchanged), the action only ever ADDS, it is idempotent, it never reaches another
// tenant, and it leaves the self-product alone.
let app: Hono;
let testDb: TestDb;
let closeDb: () => Promise<void>;
let resetDb: () => Promise<void>;
let FREE: { orgId: string; userId: string; email: string };
let PRO: { orgId: string; userId: string; email: string };

afterAll(() => closeDb());

beforeAll(async () => {
  ({ db: testDb, close: closeDb, reset: resetDb } = await makeTestDb());
  await installAppMocks(testDb);
  installQueueMock();
  const { settingsRouter } = await import("../src/routes/settings");
  app = mountApp("/api/settings", settingsRouter);
});

// Per test, not per file: /sources/apply creates the very monitors the read tests
// then assert are still missing.
beforeEach(async () => {
  await resetDb();
  FREE = await seedOrg(testDb, { plan: "free" });
  PRO = await seedOrg(testDb, { plan: "pro" });

  await testDb.insert(competitors).values([
    // Predate the defaults: seeded with the old three-source set only.
    { id: "pro-1", orgId: PRO.orgId, name: "Rival 1", url: "https://rival1.com" },
    { id: "pro-2", orgId: PRO.orgId, name: "Rival 2", url: "https://rival2.com" },
    { id: "pro-del", orgId: PRO.orgId, name: "Gone", deletedAt: new Date() },
    { id: "pro-self", orgId: PRO.orgId, name: "Us", type: "self" },
    { id: "free-1", orgId: FREE.orgId, name: "Rival F", url: "https://rivalf.com" },
  ]);
  await testDb.insert(monitors).values(
    ["pro-1", "pro-2", "pro-del", "pro-self", "free-1"].flatMap((competitorId) =>
      (["homepage", "pricing", "blog"] as const).map((sourceType) => ({
        competitorId,
        sourceType,
      })),
    ),
  );
});

async function monitorSources(competitorId: string): Promise<string[]> {
  const rows = await testDb
    .select({ sourceType: monitors.sourceType })
    .from(monitors)
    .where(eq(monitors.competitorId, competitorId));
  return rows.map((r) => r.sourceType).sort();
}

describe("GET /api/settings/sources", () => {
  test("a free workspace is offered nothing beyond what it already has", async () => {
    const res = await app.request("/api/settings/sources", asUser(FREE.userId, FREE.email));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.effectiveSources).toEqual(["homepage", "pricing", "blog"]);
    // The INTENT still covers the paid sources: the settings card shows them checked
    // behind their lock badge, and saving a neighbour can't erase them. App Store
    // reviews sits in that set too — it is seeded from detection, never blind, so it
    // widens the intent without widening what a new competitor starts with.
    expect(body.intendedSources).toEqual([
      "homepage",
      "pricing",
      "blog",
      "jobs",
      "docs",
      "roadmap",
      "appstore_reviews",
    ]);
    // Nothing to nag about: the banner must stay silent on free.
    expect(body.gaps).toEqual([]);
  });

  test("a pro workspace is told exactly which competitors are behind", async () => {
    const res = await app.request("/api/settings/sources", asUser(PRO.userId, PRO.email));
    const body = await res.json();
    expect(body.effectiveSources).toEqual([
      "homepage",
      "pricing",
      "blog",
      "jobs",
      "docs",
      "roadmap",
    ]);
    // Two live competitors; the soft-deleted one and the self-product are excluded.
    expect(body.competitorCount).toBe(2);
    expect(body.gaps).toEqual([
      { sourceType: "jobs", missingOn: 2 },
      { sourceType: "docs", missingOn: 2 },
      { sourceType: "roadmap", missingOn: 2 },
    ]);
  });
});

describe("PATCH /api/settings/sources", () => {
  test("a source that can't be seeded blind is dropped, one above the plan is kept", async () => {
    const res = await app.request(
      "/api/settings/sources",
      asUser(FREE.userId, FREE.email, {
        method: "PATCH",
        // github_repo needs a per-competitor URL nothing discovers → dropped. jobs is
        // above free → stored anyway, so it starts applying the day they upgrade.
        // appstore_reviews is kept too: detection resolves its URL, so the preference
        // is read the first time we find an App Store link on a competitor's site.
        body: JSON.stringify({
          defaultSources: ["homepage", "jobs", "appstore_reviews", "github_repo"],
        }),
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).defaultSources).toEqual(["homepage", "jobs", "appstore_reviews"]);

    const org = await testDb.query.organizations.findFirst({
      where: eq(organizations.id, FREE.orgId),
      columns: { defaultSources: true },
    });
    expect(org?.defaultSources).toEqual(["homepage", "jobs", "appstore_reviews"]);

    // Reset so the free org keeps following the built-in default for later reads.
    await app.request(
      "/api/settings/sources",
      asUser(FREE.userId, FREE.email, {
        method: "PATCH",
        body: JSON.stringify({ defaultSources: null }),
      }),
    );
  });
});

describe("POST /api/settings/sources/apply", () => {
  test("it adds the missing sources to every live competitor, and only those", async () => {
    const res = await app.request(
      "/api/settings/sources/apply",
      asUser(PRO.userId, PRO.email, { method: "POST" }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.created).toBe(6); // 3 sources × 2 competitors
    expect(body.competitorsTouched).toBe(2);

    expect(await monitorSources("pro-1")).toEqual([
      "blog",
      "docs",
      "homepage",
      "jobs",
      "pricing",
      "roadmap",
    ]);
    // Untouched: soft-deleted, the self-product, and the other tenant.
    expect(await monitorSources("pro-del")).toEqual(["blog", "homepage", "pricing"]);
    expect(await monitorSources("pro-self")).toEqual(["blog", "homepage", "pricing"]);
    expect(await monitorSources("free-1")).toEqual(["blog", "homepage", "pricing"]);
  });

  test("running it again creates nothing", async () => {
    // The first apply is this test's own setup: idempotence is the assertion.
    await app.request("/api/settings/sources/apply", asUser(PRO.userId, PRO.email, { method: "POST" }));

    const res = await app.request(
      "/api/settings/sources/apply",
      asUser(PRO.userId, PRO.email, { method: "POST" }),
    );
    const body = await res.json();
    expect(body.created).toBe(0);
    expect(body.competitorsTouched).toBe(0);
  });

  test("a free workspace's apply is a no-op, not a plan bypass", async () => {
    const res = await app.request(
      "/api/settings/sources/apply",
      asUser(FREE.userId, FREE.email, { method: "POST" }),
    );
    expect((await res.json()).created).toBe(0);
    expect(await monitorSources("free-1")).toEqual(["blog", "homepage", "pricing"]);
  });
});
