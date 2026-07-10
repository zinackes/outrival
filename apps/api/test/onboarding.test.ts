import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import type { Hono } from "hono";
import { eq } from "drizzle-orm";
import { organizations } from "@outrival/db";
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
  // Keep Trigger.dev out of the test: a fixed handle, never a network call.
  mock.module("@trigger.dev/sdk/v3", () => ({
    tasks: { trigger: async () => ({ id: "run_test" }) },
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
