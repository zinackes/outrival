import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import { users } from "@outrival/db";
import { makeTestDb, type TestDb } from "./db-harness";
import { asUser, installAppMocks, installQueueMock, mountApp, seedOrg } from "./app-harness";

// Audit 2026-09-02, S-04. `users.role` has held owner|admin|member since the schema
// was written, and billing never read it: any member of a workspace could upgrade
// the plan, downgrade it, or replace the card on file.
//
// The guard is registered method-wide (`billingRouter.on(["POST"], "*")`) rather than
// route by route, so a mutation added later inherits it. That registration is the
// part worth locking: a per-route decorator that someone forgets is how the gap
// appeared in the first place.
let app: Hono;
let testDb: TestDb;
let closeDb: () => Promise<void>;

afterAll(() => closeDb());

beforeAll(async () => {
  ({ db: testDb, close: closeDb } = await makeTestDb());
  await installAppMocks(testDb);
  installQueueMock();
  const { billingRouter } = await import("../src/routes/billing");
  app = mountApp("/api/billing", billingRouter);
});

let n = 0;
async function seedMember(orgId: string): Promise<string> {
  const id = `member-${++n}`;
  await testDb.insert(users).values({ id, email: `${id}@example.com`, orgId, role: "member" });
  return id;
}

/** A change-plan call with a body the handler rejects at its first line. */
function changePlan(userId: string) {
  return app.request("/api/billing/change-plan", asUser(userId, "x@example.com", {
    method: "POST",
    body: JSON.stringify({}),
  }));
}

describe("billing mutations are owner/admin only", () => {
  test("1. regression: a member cannot change the plan", async () => {
    const { orgId } = await seedOrg(testDb);
    const res = await changePlan(await seedMember(orgId));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "insufficient_role" });
  });

  test("2. an owner passes the guard and reaches the handler", async () => {
    const { userId } = await seedOrg(testDb);
    const res = await changePlan(userId);

    // 400 = the handler's own body validation, i.e. the guard let it through.
    expect(res.status).toBe(400);
  });

  test("3. a user with no organization is not locked out of onboarding", async () => {
    // ensureUserOrg is about to make them the owner of their own workspace; there is
    // nothing here to protect and nobody to protect it from.
    await testDb.insert(users).values({ id: "orphan-1", email: "orphan@example.com" });
    expect((await changePlan("orphan-1")).status).toBe(400);
  });

  test("4. reads stay open: a member still sees the plan the dashboard renders", async () => {
    const { orgId } = await seedOrg(testDb);
    const memberId = await seedMember(orgId);

    const res = await app.request(
      "/api/billing?summary=1",
      asUser(memberId, "m@example.com"),
    );

    expect(res.status).toBe(200);
  });
});
