import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import { eq } from "drizzle-orm";
import {
  changes,
  competitorCandidates,
  competitors,
  monitors,
  organizations,
  signals,
  snapshots,
} from "@outrival/db";
import { PLAN_LIMITS } from "@outrival/shared";
import { makeTestDb, type TestDb } from "./db-harness";
import { asUser, installAppMocks, installQueueMock, mountApp, seedOrg } from "./app-harness";

// The Discovery page reads its whole opening from this router: the queue with the
// numbers behind it (counts, competitor seats, what the search ran on), the scan
// allowance, and the receipt of what tracking a candidate produced. These lock that
// contract plus the org-scoping every one of those reads depends on.
let app: Hono;
let testDb: TestDb;
let closeDb: () => Promise<void>;
let resetDb: () => Promise<void>;
let A: { orgId: string; userId: string; email: string };
let B: { orgId: string; userId: string; email: string };

afterAll(() => closeDb());

beforeAll(async () => {
  ({ db: testDb, close: closeDb, reset: resetDb } = await makeTestDb());
  await installAppMocks(testDb);
  // The add path fires platform detection + first scrapes. The queue is not the
  // subject here, and a real enqueue would need a running pg-boss.
  installQueueMock();
  const { candidatesRouter } = await import("../src/routes/candidates");
  app = mountApp("/api/candidates", candidatesRouter);
});

// Per test, not per file: /add and /dismiss move a candidate out of `new`, and the
// queue counts and the Added receipt are both read off that status.
beforeEach(async () => {
  await resetDb();
  A = await seedOrg(testDb, { plan: "pro" });
  B = await seedOrg(testDb, { plan: "free" });

  await testDb
    .update(organizations)
    .set({
      productProfile: {
        category: "competitive intelligence software",
        audience: "product and growth teams at B2B SaaS",
        valueProp: "turn competitor moves into decisions",
      },
      detectionConfig: {
        minOverlap: 65,
        autoDetect: true,
        cadence: "weekly",
        excludedDomains: ["parentco.com", "partner.io"],
        keywords: "battlecards, competitor monitoring",
        region: "fr",
      },
      detectionLastRunAt: new Date("2026-07-20T09:00:00Z"),
    })
    .where(eq(organizations.id, A.orgId));

  // Two competitors already tracked in org A: seats used.
  await testDb.insert(competitors).values([
    { id: "cand-comp-1", orgId: A.orgId, name: "Klue", url: "https://klue.com" },
    { id: "cand-comp-2", orgId: A.orgId, name: "Crayon", url: "https://crayon.co" },
  ]);

  await testDb.insert(competitorCandidates).values([
    {
      id: "cnd-strong",
      orgId: A.orgId,
      url: "https://kompyte.com",
      title: "Kompyte",
      snippet: "Automated competitor tracking and battlecards.",
      overlapScore: 87,
      reason: "Same automated-capture promise.",
      status: "new",
    },
    {
      id: "cnd-weak",
      orgId: A.orgId,
      url: "https://owler.com",
      title: "Owler",
      overlapScore: 41,
      status: "new",
    },
    {
      id: "cnd-dismissed",
      orgId: A.orgId,
      url: "https://g2.com",
      title: "G2",
      overlapScore: 30,
      status: "dismissed",
    },
    // Tracked, linked to what it became.
    {
      id: "cnd-added",
      orgId: A.orgId,
      url: "https://klue.com",
      title: "Klue",
      overlapScore: 94,
      status: "added",
      competitorId: "cand-comp-1",
    },
    // Tracked before the link column existed: resolves by hostname.
    {
      id: "cnd-added-legacy",
      orgId: A.orgId,
      url: "https://www.crayon.co/",
      title: "Crayon",
      overlapScore: 91,
      status: "added",
    },
    // Another tenant's queue, which must never appear in A's reads.
    {
      id: "cnd-other-org",
      orgId: B.orgId,
      url: "https://visualping.io",
      title: "Visualping",
      overlapScore: 78,
      status: "new",
    },
  ]);

  // One signal on the linked competitor, so the Added tab has something to report.
  await testDb
    .insert(monitors)
    .values({ id: "cnd-mon", competitorId: "cand-comp-1", sourceType: "homepage" });
  await testDb
    .insert(snapshots)
    .values({ id: "cnd-snp", monitorId: "cnd-mon", r2Key: "k", contentHash: "h" });
  await testDb
    .insert(changes)
    .values({ id: "cnd-chg", monitorId: "cnd-mon", snapshotAfterId: "cnd-snp" });
  await testDb.insert(signals).values({
    id: "cnd-sig",
    changeId: "cnd-chg",
    orgId: A.orgId,
    competitorId: "cand-comp-1",
    severity: "high",
    category: "pricing",
    insight: "Entry tier moved",
  });
}, 30_000);

describe("GET /api/candidates", () => {
  test("carries the counts, the seats and the search basis the reading is made of", async () => {
    const res = await app.request("/api/candidates?status=new", asUser(A.userId, A.email));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.candidates.map((c: { id: string }) => c.id).sort()).toEqual([
      "cnd-strong",
      "cnd-weak",
    ]);
    expect(body.counts).toEqual({ new: 2, dismissed: 1, added: 2 });
    expect(body.seats).toEqual({ used: 2, limit: PLAN_LIMITS.pro.maxCompetitors });
    expect(body.basis).toMatchObject({
      category: "competitive intelligence software",
      audience: "product and growth teams at B2B SaaS",
      keywords: "battlecards, competitor monitoring",
      region: "fr",
      excludedDomains: 2,
      autoDetect: true,
      cadence: "weekly",
    });
  });

  test("the description captured at discovery survives to the row", async () => {
    const res = await app.request("/api/candidates?status=new", asUser(A.userId, A.email));
    const body = await res.json();
    const strong = body.candidates.find((c: { id: string }) => c.id === "cnd-strong");
    expect(strong.snippet).toBe("Automated competitor tracking and battlecards.");
  });

  test("another tenant's queue never leaks in", async () => {
    const res = await app.request("/api/candidates?status=new", asUser(B.userId, B.email));
    const body = await res.json();
    expect(body.candidates.map((c: { id: string }) => c.id)).toEqual(["cnd-other-org"]);
    expect(body.counts.new).toBe(1);
    expect(body.seats.limit).toBe(PLAN_LIMITS.free.maxCompetitors);
  });
});

describe("GET /api/candidates/added", () => {
  test("links a tracked candidate to what it became and what it captured", async () => {
    const res = await app.request("/api/candidates/added", asUser(A.userId, A.email));
    expect(res.status).toBe(200);
    const { added } = await res.json();
    expect(added).toHaveLength(2);

    const klue = added.find((a: { id: string }) => a.id === "cnd-added");
    expect(klue.competitor.id).toBe("cand-comp-1");
    expect(klue.signalCount).toBe(1);
    expect(klue.lastSignalAt).not.toBeNull();
  });

  test("a row added before the link column resolves by hostname", async () => {
    const res = await app.request("/api/candidates/added", asUser(A.userId, A.email));
    const { added } = await res.json();
    const crayon = added.find((a: { id: string }) => a.id === "cnd-added-legacy");
    expect(crayon.competitor.id).toBe("cand-comp-2");
    // Tracked, but nothing captured yet: the seat that has produced nothing is
    // exactly what this tab exists to show.
    expect(crayon.signalCount).toBe(0);
  });

  test("another tenant reads an empty receipt, not A's", async () => {
    const res = await app.request("/api/candidates/added", asUser(B.userId, B.email));
    expect((await res.json()).added).toEqual([]);
  });
});

describe("GET /api/candidates/staleness", () => {
  test("reports the monthly scan allowance and the next automatic run", async () => {
    const res = await app.request("/api/candidates/staleness", asUser(A.userId, A.email));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scans).toEqual({ used: 0, limit: PLAN_LIMITS.pro.discoveriesPerMonth });
    // Automatic detection is on, so a date is stated rather than "every Sunday":
    // the cron skips an org whose last run is inside the cadence window.
    expect(body.nextAutomaticAt).not.toBeNull();
    expect(new Date(body.nextAutomaticAt).getUTCDay()).toBe(0);
    expect(new Date(body.nextAutomaticAt).getTime()).toBeGreaterThan(
      new Date("2026-07-26T09:00:00Z").getTime(),
    );
  });

  test("an org that opted out of automatic detection gets no date", async () => {
    await testDb
      .update(organizations)
      .set({
        detectionConfig: {
          minOverlap: 65,
          autoDetect: false,
          cadence: "weekly",
          excludedDomains: [],
          keywords: "",
          region: null,
        },
      })
      .where(eq(organizations.id, B.orgId));
    const res = await app.request("/api/candidates/staleness", asUser(B.userId, B.email));
    expect((await res.json()).nextAutomaticAt).toBeNull();
  });
});

describe("POST /api/candidates/:id/add", () => {
  test("stamps the competitor the candidate became", async () => {
    const res = await app.request(
      "/api/candidates/cnd-strong/add",
      asUser(A.userId, A.email, { method: "POST" }),
    );
    expect(res.status).toBe(200);
    const { competitor } = await res.json();

    const row = await testDb.query.competitorCandidates.findFirst({
      where: eq(competitorCandidates.id, "cnd-strong"),
    });
    expect(row?.status).toBe("added");
    expect(row?.competitorId).toBe(competitor.id);

    // And it now shows up on the receipt, with nothing captured yet.
    const added = await app.request("/api/candidates/added", asUser(A.userId, A.email));
    const body = await added.json();
    const fresh = body.added.find((a: { id: string }) => a.id === "cnd-strong");
    expect(fresh.competitor.id).toBe(competitor.id);
    expect(fresh.signalCount).toBe(0);
  });

  test("a foreign org cannot add another tenant's candidate", async () => {
    const res = await app.request(
      "/api/candidates/cnd-weak/add",
      asUser(B.userId, B.email, { method: "POST" }),
    );
    expect(res.status).toBe(404);
  });
});
