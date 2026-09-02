import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import { feedback, users } from "@outrival/db";
import { makeTestDb, type TestDb } from "./db-harness";
import { asUser, installAppMocks, mountApp, seedOrg } from "./app-harness";

// Audit 2026-08-16, finding code:COR-01 — the only confirmed cross-tenant read.
// GET /api/feedback gated on the per-org "owner" role but ran an unscoped
// SELECT, so an owner of ANY org read every org's feedback. Case 1 is that
// regression. The cross-org view lives at GET /api/admin/feedback, behind the
// platform email allowlist.
let app: Hono;
let testDb: TestDb;
let closeDb: () => Promise<void>;

beforeAll(async () => {
  ({ db: testDb, close: closeDb } = await makeTestDb());
  await installAppMocks(testDb);
  const { feedbackRouter } = await import("../src/routes/feedback");
  app = mountApp("/api/feedback", feedbackRouter);
});

afterAll(() => closeDb());

async function seedFeedback(orgId: string, userId: string, message: string) {
  await testDb.insert(feedback).values({ orgId, userId, type: "bug", message });
}

async function listAs(userId: string | null, email?: string) {
  return app.request("/api/feedback", asUser(userId, email));
}

describe("GET /api/feedback is scoped to the caller's org", () => {
  test("1. regression: an owner never sees another org's feedback", async () => {
    const mine = await seedOrg(testDb);
    const theirs = await seedOrg(testDb);
    await seedFeedback(mine.orgId, mine.userId, "mine: dashboard is slow");
    await seedFeedback(theirs.orgId, theirs.userId, "theirs: billing is broken");

    const res = await listAs(mine.userId, mine.email);
    expect(res.status).toBe(200);

    const { feedback: rows } = (await res.json()) as {
      feedback: Array<{ orgId: string | null; message: string }>;
    };
    expect(rows.map((r) => r.message)).toEqual(["mine: dashboard is slow"]);
    expect(rows.every((r) => r.orgId === mine.orgId)).toBe(true);
  });

  test("2. an org with no feedback gets an empty list, not everyone else's", async () => {
    const noisy = await seedOrg(testDb);
    const quiet = await seedOrg(testDb);
    await seedFeedback(noisy.orgId, noisy.userId, "noisy: something broke");

    const res = await listAs(quiet.userId, quiet.email);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { feedback: unknown[] }).feedback).toEqual([]);
  });

  test("3. a non-owner member of the org is still forbidden", async () => {
    const org = await seedOrg(testDb);
    await seedFeedback(org.orgId, org.userId, "member should not read this");
    await testDb.insert(users).values({
      id: `${org.userId}-member`,
      email: `member-${org.orgId}@example.com`,
      name: "Member",
      orgId: org.orgId,
      role: "member",
    });

    const res = await listAs(`${org.userId}-member`, `member-${org.orgId}@example.com`);
    expect(res.status).toBe(403);
  });

  test("4. an anonymous request is rejected before any read", async () => {
    expect((await listAs(null)).status).toBe(401);
  });
});
