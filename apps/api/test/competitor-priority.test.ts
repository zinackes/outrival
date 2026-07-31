import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import { eq } from "drizzle-orm";
import { competitors } from "@outrival/db";
import { makeTestDb, type TestDb } from "./db-harness";
import { asUser, installAppMocks, mountApp, seedOrg } from "./app-harness";

// Which competitors survive the plan's cap. The ranking here (prioritised first,
// then oldest) is duplicated in the scheduler's enqueue gate, so these tests lock
// the contract the two sides share: what the API reports as kept is what keeps
// being scraped. A drift between them would show up as competitors the UI calls
// monitored while nothing scrapes them.
let app: Hono;
let testDb: TestDb;
let closeDb: () => Promise<void>;
let A: { orgId: string; userId: string; email: string };
let B: { orgId: string; userId: string; email: string };

afterAll(() => closeDb());

beforeAll(async () => {
  ({ db: testDb, close: closeDb } = await makeTestDb());
  await installAppMocks(testDb);
  const { billingRouter } = await import("../src/routes/billing");
  app = mountApp("/api/billing", billingRouter);

  // Org A is on free (cap 2) with three competitors, so the cap actually bites.
  A = await seedOrg(testDb, { plan: "free" });
  B = await seedOrg(testDb, { plan: "free" });

  const day = 86_400_000;
  const t0 = new Date("2026-01-01T00:00:00Z").getTime();
  await testDb.insert(competitors).values([
    { id: "a-old", orgId: A.orgId, name: "Oldest", url: "https://old.example", createdAt: new Date(t0) },
    { id: "a-mid", orgId: A.orgId, name: "Middle", url: "https://mid.example", createdAt: new Date(t0 + day) },
    { id: "a-new", orgId: A.orgId, name: "Newest", url: "https://new.example", createdAt: new Date(t0 + 2 * day) },
    // Never competes for a slot: the self-product is outside the quota.
    { id: "a-self", orgId: A.orgId, name: "Us", type: "self", createdAt: new Date(t0) },
    { id: "b-1", orgId: B.orgId, name: "Other tenant", createdAt: new Date(t0) },
  ]);
}, 30_000);

const get = (who = A) =>
  app.request("/api/billing/competitor-priority", asUser(who.userId, who.email));

const put = (keep: unknown, who = A) =>
  app.request(
    "/api/billing/competitor-priority",
    asUser(who.userId, who.email, { method: "PUT", body: JSON.stringify({ keep }) }),
  );

async function prioritized(): Promise<string[]> {
  const rows = await testDb
    .select({ id: competitors.id, capPriority: competitors.capPriority })
    .from(competitors)
    .where(eq(competitors.orgId, A.orgId));
  return rows.filter((r) => r.capPriority).map((r) => r.id).sort();
}

describe("GET /billing/competitor-priority", () => {
  test("ranks oldest first and marks the cap cut, excluding the self-product", async () => {
    const body = await (await get()).json();
    expect(body.limit).toBe(2);
    expect(body.competitors.map((c: { id: string }) => c.id)).toEqual([
      "a-old",
      "a-mid",
      "a-new",
    ]);
    expect(body.competitors.map((c: { kept: boolean }) => c.kept)).toEqual([
      true,
      true,
      false,
    ]);
  });

  test("never leaks another tenant's roster", async () => {
    const body = await (await get(B)).json();
    expect(body.competitors.map((c: { id: string }) => c.id)).toEqual(["b-1"]);
  });
});

describe("PUT /billing/competitor-priority", () => {
  test("a picked competitor outranks older ones", async () => {
    const res = await put(["a-new"]);
    expect(res.status).toBe(200);
    expect(await prioritized()).toEqual(["a-new"]);

    const body = await (await get()).json();
    expect(body.competitors.map((c: { id: string }) => c.id)).toEqual([
      "a-new",
      "a-old",
      "a-mid",
    ]);
    // The newest is now kept and the oldest-but-one is what freezes.
    expect(body.competitors.find((c: { id: string }) => c.id === "a-new").kept).toBe(true);
    expect(body.competitors.find((c: { id: string }) => c.id === "a-mid").kept).toBe(false);
  });

  test("re-picking replaces the previous selection instead of adding to it", async () => {
    await put(["a-new"]);
    await put(["a-mid"]);
    expect(await prioritized()).toEqual(["a-mid"]);
  });

  test("an empty pick falls back to the age order", async () => {
    await put(["a-new"]);
    await put([]);
    expect(await prioritized()).toEqual([]);
    const body = await (await get()).json();
    expect(body.competitors.map((c: { id: string }) => c.id)).toEqual([
      "a-old",
      "a-mid",
      "a-new",
    ]);
  });

  test("ignores ids outside the org rather than flipping another tenant's row", async () => {
    const res = await put(["b-1"]);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ prioritized: 0 });
    const [other] = await testDb
      .select({ capPriority: competitors.capPriority })
      .from(competitors)
      .where(eq(competitors.id, "b-1"));
    expect(other?.capPriority).toBe(false);
  });

  test("rejects a malformed body", async () => {
    expect((await put("a-new")).status).toBe(400);
  });
});
