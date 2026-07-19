import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { resolve } from "node:path";
import type { Hono } from "hono";
import { eq } from "drizzle-orm";
import { competitorCandidates, organizations } from "@outrival/db";
import { makeTestDb, type TestDb } from "./db-harness";
import { asUser, installAppMocks, mountApp, seedOrg } from "./app-harness";

// POST /onboarding/complete must default the org's digestEmail to the account
// email (2026-07-10 audit: the weekly briefing is the retention loop, yet only
// 1/33 prod orgs ever had a recipient because nothing ever set one) — without
// clobbering an address the org already chose.
let app: Hono;
let testDb: TestDb;
let closeDb: () => Promise<void>;

afterAll(() => closeDb());

beforeAll(async () => {
  ({ db: testDb, close: closeDb } = await makeTestDb());
  await installAppMocks(testDb);
  // Keep the job queue out of the test: a fixed job id, never a queue connection.
  mock.module(resolve(import.meta.dir, "../src/lib/queue"), () => ({
    enqueueJob: async () => "run_test",
    enqueueByName: async () => "run_test",
    ensureQueue: async () => {},
  }));
  const { onboardingRouter } = await import("../src/routes/onboarding");
  app = mountApp("/api/onboarding", onboardingRouter);
  // The onboarding router's import graph (scrapers discovery + ai) outweighs the
  // 5s default hook budget on a cold compile.
}, 30_000);

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

  test("leftover candidates are gated on minOverlap; dismissals never are", async () => {
    // The discover step over-fetches on purpose; unfiltered leftovers buried the
    // Discovery queue (323 prod rows averaging overlap 42 — 2026-07-10 audit).
    // Default detectionConfig.minOverlap = 65 (strictly above, like the weekly
    // detection); dismissals are rejection memory and always persist.
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
    expect(byUrl.get("https://trashed-co.com")).toBe("dismissed");
    expect(byUrl.has("https://weak-co.com")).toBe(false);
    expect(byUrl.has("https://unscored-co.com")).toBe(false);
    expect(rows.length).toBe(2);
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
