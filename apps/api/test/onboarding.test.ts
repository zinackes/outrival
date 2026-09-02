import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import {
  askHistory,
  battleCards,
  changes,
  competitorCandidates,
  competitors,
  monitors,
  onboardingSessions,
  organizations,
  products,
  signals,
  snapshots,
} from "@outrival/db";
import { makeTestDb, type TestDb } from "./db-harness";
import { asUser, installAppMocks, installQueueMock, mountApp, seedOrg } from "./app-harness";

// POST /onboarding/complete must default the org's digestEmail to the account
// email (2026-07-10 audit: the weekly briefing is the retention loop, yet only
// 1/33 prod orgs ever had a recipient because nothing ever set one) — without
// clobbering an address the org already chose.
let app: Hono;
let testDb: TestDb;
let closeDb: () => Promise<void>;
let resetDb: () => Promise<void>;

afterAll(() => closeDb());

beforeAll(async () => {
  ({ db: testDb, close: closeDb, reset: resetDb } = await makeTestDb());
  await installAppMocks(testDb);
  // Keep the job queue out of the test: a fixed job id, never a queue connection.
  installQueueMock();
  const { onboardingRouter } = await import("../src/routes/onboarding");
  app = mountApp("/api/onboarding", onboardingRouter);
  // The onboarding router's import graph (scrapers discovery + ai) outweighs the
  // 5s default hook budget on a cold compile.
}, 30_000);

// Each test seeds the org and the self-competitor it acts on, so the table has to
// start empty rather than carrying the previous test's product.
beforeEach(() => resetDb());

function completeBody() {
  return JSON.stringify({
    selectedCompetitors: [{ name: "Rival", url: "https://rival.example.com" }],
    monitoringPrefs: { frequency: "weekly", sources: ["homepage"] },
  });
}

describe("POST /onboarding/complete — digestEmail default", () => {
  test("an org with no digestEmail gets the account email", async () => {
    const { orgId, userId, email } = await seedOrg(testDb);
    const res = await app.request(
      "/api/onboarding/complete",
      asUser(userId, email, { method: "POST", body: completeBody() }),
    );
    expect(res.status).toBe(200);

    const org = await testDb.query.organizations.findFirst({
      where: eq(organizations.id, orgId),
    });
    expect(org?.digestEmail).toBe(email);
    expect(org?.onboardingCompleted).toBe(true);
  });

  test("every leftover candidate persists, whatever it scored", async () => {
    // minOverlap (default 65) is the weekly detection's auto-notification bar, not
    // an admission bar: gating leftovers on it deleted the 50-64 band a niche
    // product's real competitors land in, after the user had already seen them on
    // the discovery screen. The Discovery queue ranks and collapses low scorers
    // into a weak band, so they stay reviewable instead of disappearing.
    const { orgId, userId, email } = await seedOrg(testDb);
    // Distinct REGISTRABLE domains: normalizeHostname reduces subdomains to the
    // registrable domain, so *.example.com URLs would all dedupe as one host.
    const body = JSON.stringify({
      selectedCompetitors: [{ name: "Rival", url: "https://rival-co.com" }],
      monitoringPrefs: { frequency: "weekly", sources: ["homepage"] },
      savedCandidates: [
        { url: "https://strong-co.com", title: "Strong", overlapScore: 80 },
        { url: "https://weak-co.com", title: "Weak", overlapScore: 40 },
        { url: "https://unscored-co.com", title: "Unscored" },
      ],
      dismissedCandidates: [
        { url: "https://trashed-co.com", title: "Trashed", overlapScore: 30 },
      ],
    });
    const res = await app.request(
      "/api/onboarding/complete",
      asUser(userId, email, { method: "POST", body }),
    );
    expect(res.status).toBe(200);

    const rows = await testDb.query.competitorCandidates.findMany({
      where: eq(competitorCandidates.orgId, orgId),
    });
    const byUrl = new Map(rows.map((r) => [r.url, r.status]));
    expect(byUrl.get("https://strong-co.com")).toBe("new");
    expect(byUrl.get("https://weak-co.com")).toBe("new");
    expect(byUrl.get("https://unscored-co.com")).toBe("new");
    // Dismissals are the anti-re-suggestion memory, kept as their own status.
    expect(byUrl.get("https://trashed-co.com")).toBe("dismissed");
    expect(rows.length).toBe(4);
    // A leftover the scorer never ranked stores a null score, not a 0 that would
    // read as "scored, and irrelevant".
    const unscored = rows.find((r) => r.url === "https://unscored-co.com");
    expect(unscored?.overlapScore).toBeNull();
  });

  test("an org that already chose a digestEmail keeps it", async () => {
    const { orgId, userId, email } = await seedOrg(testDb);
    await testDb
      .update(organizations)
      .set({ digestEmail: "reports@customer.example.com" })
      .where(eq(organizations.id, orgId));

    const res = await app.request(
      "/api/onboarding/complete",
      asUser(userId, email, { method: "POST", body: completeBody() }),
    );
    expect(res.status).toBe(200);

    const org = await testDb.query.organizations.findFirst({
      where: eq(organizations.id, orgId),
    });
    expect(org?.digestEmail).toBe("reports@customer.example.com");
  });
});

// A description / PDF / repo run has no URL, so the product used to be created as
// the "My product" placeholder with no way to say otherwise — the name only ever
// arrived later, from the hostname, on go-live.
describe("POST /onboarding/complete — product name", () => {
  async function selfAndProduct(orgId: string) {
    const self = await testDb.query.competitors.findFirst({
      where: and(eq(competitors.orgId, orgId), eq(competitors.type, "self")),
    });
    const product = await testDb.query.products.findFirst({
      where: eq(products.orgId, orgId),
    });
    return { self, product };
  }

  test("a chosen name lands on both the product and its anchor", async () => {
    const { orgId, userId, email } = await seedOrg(testDb);
    const body = JSON.stringify({
      selectedCompetitors: [{ name: "Rival", url: "https://named-rival.com" }],
      monitoringPrefs: { frequency: "weekly", sources: ["homepage"] },
      productName: "  Flagship  ",
    });
    const res = await app.request(
      "/api/onboarding/complete",
      asUser(userId, email, { method: "POST", body }),
    );
    expect(res.status).toBe(200);

    const { self, product } = await selfAndProduct(orgId);
    expect(product?.name).toBe("Flagship");
    // Both rows or neither: the switcher reads products.name, the pipeline reads the
    // competitor, and two names for one product is how "My product" survived.
    expect(self?.name).toBe("Flagship");
  });

  test("no name still falls back to the placeholder", async () => {
    const { orgId, userId, email } = await seedOrg(testDb);
    const res = await app.request(
      "/api/onboarding/complete",
      asUser(userId, email, { method: "POST", body: completeBody() }),
    );
    expect(res.status).toBe(200);

    const { self, product } = await selfAndProduct(orgId);
    expect(product?.name).toBe("My product");
    expect(self?.name).toBe("My product");
  });
});

// The get-started dock derives its steps from facts read off existing rows. Each
// fact has one source of truth; the tests pin which row flips which flag, and that
// the per-user ones stay per user.
describe("GET /onboarding/checklist — get-started facts", () => {
  let n = 0;
  async function seedCompetitor(orgId: string): Promise<string> {
    const id = `gs-cmp-${++n}`;
    await testDb.insert(competitors).values({
      id,
      orgId,
      name: `Rival ${n}`,
      url: `https://rival-${n}.example`,
      type: "competitor",
    });
    return id;
  }
  async function seedSignal(orgId: string, competitorId: string, actionStatus?: string) {
    const id = `gs-${++n}`;
    await testDb.insert(monitors).values({
      id: `mon-${id}`,
      competitorId,
      sourceType: "homepage",
      nextRunAt: new Date("2030-01-02T03:04:05.000Z"),
    });
    await testDb.insert(snapshots).values({
      id: `snp-${id}`,
      monitorId: `mon-${id}`,
      r2Key: `k-${id}`,
      contentHash: `h-${id}`,
    });
    await testDb
      .insert(changes)
      .values({ id: `chg-${id}`, monitorId: `mon-${id}`, snapshotAfterId: `snp-${id}` });
    await testDb.insert(signals).values({
      id: `sig-${id}`,
      changeId: `chg-${id}`,
      orgId,
      competitorId,
      severity: "low",
      category: "product",
      insight: "insight",
      ...(actionStatus ? { actionStatus } : {}),
    });
  }
  async function facts(userId: string, email: string) {
    const res = await app.request("/api/onboarding/checklist", asUser(userId, email));
    expect(res.status).toBe(200);
    return (await res.json()) as Record<string, unknown>;
  }

  test("a fresh org has nothing done and no horizon", async () => {
    const { userId, email } = await seedOrg(testDb);
    expect(await facts(userId, email)).toEqual({
      competitorCount: 0,
      askedByMe: false,
      hasBattleCard: false,
      channelConfigured: false,
      signalCount: 0,
      hasDecision: false,
      nextScanAt: null,
      milestones: {},
    });
  });

  test("each fact flips on its own row", async () => {
    const { orgId, userId, email } = await seedOrg(testDb);
    const cid = await seedCompetitor(orgId);
    await testDb
      .insert(askHistory)
      .values({ orgId, userId, question: "q", answer: "a" });
    await testDb.insert(battleCards).values({ orgId, competitorId: cid, content: {} });
    await testDb
      .update(organizations)
      .set({ slackWebhookUrl: "https://hooks.slack.com/services/x" })
      .where(eq(organizations.id, orgId));
    await seedSignal(orgId, cid, "todo");

    const f = await facts(userId, email);
    expect(f.competitorCount).toBe(1);
    expect(f.askedByMe).toBe(true);
    expect(f.hasBattleCard).toBe(true);
    expect(f.channelConfigured).toBe(true);
    expect(f.signalCount).toBe(1);
    expect(f.hasDecision).toBe(true);
    // The horizon is the next scan, rendered as an ISO instant in UTC.
    expect(f.nextScanAt).toBe("2030-01-02T03:04:05.000Z");
  });

  test("a signal nobody triaged is not a decision", async () => {
    const { orgId, userId, email } = await seedOrg(testDb);
    const cid = await seedCompetitor(orgId);
    await seedSignal(orgId, cid);
    const f = await facts(userId, email);
    expect(f.signalCount).toBe(1);
    expect(f.hasDecision).toBe(false);
  });

  test("a teammate's question does not count as mine", async () => {
    const { orgId, userId, email } = await seedOrg(testDb);
    const mate = await seedOrg(testDb);
    await testDb
      .insert(askHistory)
      .values({ orgId, userId: mate.userId, question: "q", answer: "a" });
    const f = await facts(userId, email);
    expect(f.askedByMe).toBe(false);
  });
});

describe("POST /onboarding/checklist/milestone", () => {
  test("without a session nothing is written", async () => {
    const { userId, email } = await seedOrg(testDb);
    const res = await app.request(
      "/api/onboarding/checklist/milestone",
      asUser(userId, email, { method: "POST", body: JSON.stringify({ key: "dismissed" }) }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stored: false, milestones: {} });
    expect(await testDb.query.onboardingSessions.findMany()).toHaveLength(0);
  });

  test("stamps and clears in the user's own session, keeping its funnel keys", async () => {
    const { orgId, userId, email } = await seedOrg(testDb);
    await testDb.insert(onboardingSessions).values({
      id: "gs-session",
      userId,
      orgId,
      stage: "completed",
      timings: { started: 1 },
    });
    const post = (body: unknown) =>
      app.request(
        "/api/onboarding/checklist/milestone",
        asUser(userId, email, { method: "POST", body: JSON.stringify(body) }),
      );

    const stamped = await post({ key: "landscape_seen" });
    expect(stamped.status).toBe(200);
    const stampedBody = (await stamped.json()) as { stored: boolean; milestones: Record<string, number> };
    expect(stampedBody.stored).toBe(true);
    expect(typeof stampedBody.milestones.landscape_seen).toBe("number");

    const read = await app.request("/api/onboarding/checklist", asUser(userId, email));
    const f = (await read.json()) as { milestones: Record<string, number> };
    expect(f.milestones.landscape_seen).toBe(stampedBody.milestones.landscape_seen);

    const cleared = await post({ key: "landscape_seen", clear: true });
    expect((await cleared.json()).milestones).toEqual({});
    const row = await testDb.query.onboardingSessions.findFirst({
      where: eq(onboardingSessions.id, "gs-session"),
    });
    expect(row?.timings).toEqual({ started: 1 });
  });

  test("rejects an unknown key", async () => {
    const { userId, email } = await seedOrg(testDb);
    const res = await app.request(
      "/api/onboarding/checklist/milestone",
      asUser(userId, email, { method: "POST", body: JSON.stringify({ key: "nope" }) }),
    );
    expect(res.status).toBe(400);
  });
});
