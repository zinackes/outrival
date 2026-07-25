import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import { eq } from "drizzle-orm";
import { organizations, qualityFeedback } from "@outrival/db";
import { signDigestFeedbackToken, signUnsubscribeToken } from "@outrival/shared";
import { makeTestDb, type TestDb } from "./db-harness";
import { installAppMocks, mountApp, seedOrg } from "./app-harness";

// Plan 013: GET /unsubscribe used to mutate on either verb, so any machine
// that fetches a link (mail scanner, link unfurler, browser prefetch) could
// silently disable an org's digests. Case 1 below is the specific regression
// this plan exists for. The router is intentionally unauthenticated (the
// signed token IS the credential) — these tests never send x-test-user-*.
let app: Hono;
let testDb: TestDb;
let closeDb: () => Promise<void>;

const SECRET = "test-secret-for-digest-feedback-tests";

beforeAll(async () => {
  process.env.BETTER_AUTH_SECRET = SECRET;
  ({ db: testDb, close: closeDb } = await makeTestDb());
  await installAppMocks(testDb);
  const { digestFeedbackRouter } = await import("../src/routes/digest-feedback");
  app = mountApp("/api/digest-feedback", digestFeedbackRouter);
});

afterAll(() => closeDb());

async function getOrg(orgId: string) {
  return testDb.query.organizations.findFirst({ where: eq(organizations.id, orgId) });
}

describe("GET /api/digest-feedback/unsubscribe never mutates", () => {
  test("1. regression: a valid token leaves digestEnabled unchanged", async () => {
    const { orgId } = await seedOrg(testDb);
    expect((await getOrg(orgId))?.digestEnabled).toBe(true);

    const token = signUnsubscribeToken(orgId, SECRET);
    const res = await app.request(`/api/digest-feedback/unsubscribe?token=${token}`);
    expect(res.status).toBe(200);
    expect((await getOrg(orgId))?.digestEnabled).toBe(true);

    // Confirmation page, not the "you're unsubscribed" copy — and it POSTs
    // back with the token, so the mail-client one-click path still works.
    const html = await res.text();
    expect(html).toContain('method="post"');
    expect(html).toContain(token);
  });

  test("an invalid token does not mutate and returns 400", async () => {
    const { orgId } = await seedOrg(testDb);
    const res = await app.request(`/api/digest-feedback/unsubscribe?token=tampered.sig`);
    expect(res.status).toBe(400);
    expect((await getOrg(orgId))?.digestEnabled).toBe(true);
  });
});

describe("POST /api/digest-feedback/unsubscribe performs the mutation", () => {
  test("2. a valid token sets digestEnabled to false", async () => {
    const { orgId } = await seedOrg(testDb);
    const token = signUnsubscribeToken(orgId, SECRET);

    const res = await app.request(`/api/digest-feedback/unsubscribe?token=${token}`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    expect((await getOrg(orgId))?.digestEnabled).toBe(false);
  });

  test("3. a tampered token does not mutate, and returns 400", async () => {
    const { orgId } = await seedOrg(testDb);
    const token = signUnsubscribeToken(orgId, SECRET);
    const tampered = `${token.split(".")[0]}.tampered-signature`;

    const res = await app.request(`/api/digest-feedback/unsubscribe?token=${tampered}`, {
      method: "POST",
    });
    expect(res.status).toBe(400);
    expect((await getOrg(orgId))?.digestEnabled).toBe(true);
  });
});

describe("GET /api/digest-feedback never inserts feedback", () => {
  test("4. a valid token does not insert a qualityFeedback row", async () => {
    const { orgId } = await seedOrg(testDb);
    const token = signDigestFeedbackToken(
      { orgId, digestId: "digest-does-not-need-to-exist", verdict: "useful" },
      SECRET,
    );

    const res = await app.request(`/api/digest-feedback?token=${token}`);
    expect(res.status).toBe(200);

    const rows = await testDb.query.qualityFeedback.findMany({
      where: eq(qualityFeedback.orgId, orgId),
    });
    expect(rows).toHaveLength(0);
  });

  test("an invalid token does not mutate and returns 400", async () => {
    const res = await app.request(`/api/digest-feedback?token=tampered.sig`);
    expect(res.status).toBe(400);
  });
});
