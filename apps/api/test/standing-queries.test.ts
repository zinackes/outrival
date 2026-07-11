import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import { competitors } from "@outrival/db";
import { makeTestDb, type TestDb } from "./db-harness";
import { asUser, installAppMocks, mountApp, seedOrg } from "./app-harness";

// Standing queries: (d) the plan cap is enforced BACKEND-side at creation (and
// reactivation), and creation-time entity extraction is org-scoped — a citation
// pointing at another org's competitor is dropped, never watched.

let app: Hono;
let testDb: TestDb;
let closeDb: () => Promise<void>;
let A: { orgId: string; userId: string; email: string };
let B: { orgId: string; userId: string; email: string };

afterAll(() => closeDb());

beforeAll(async () => {
  ({ db: testDb, close: closeDb } = await makeTestDb());
  await installAppMocks(testDb);
  const { standingQueriesRouter } = await import("../src/routes/standing-queries");
  app = mountApp("/api/standing-queries", standingQueriesRouter);
  A = await seedOrg(testDb, { plan: "free" });
  B = await seedOrg(testDb, { plan: "free" });
  await testDb.insert(competitors).values({ id: "comp-a", orgId: A.orgId, name: "Acme" });
  await testDb.insert(competitors).values({ id: "comp-b", orgId: B.orgId, name: "Foreign" });
});

const create = (
  user: { userId: string; email: string },
  question: string,
  citations: Array<{ type: string; id: string; label: string }> = [],
) =>
  app.request(
    "/api/standing-queries",
    asUser(user.userId, user.email, {
      method: "POST",
      body: JSON.stringify({ question, answer: "Baseline answer.", citations }),
    }),
  );

describe("standing queries — backend plan gating (d)", () => {
  test("free plan: 3 active queries pass, the 4th is refused with a structured 403", async () => {
    for (let i = 1; i <= 3; i++) {
      const res = await create(A, `Watched question number ${i}?`);
      expect(res.status).toBe(200);
    }
    const res = await create(A, "One watched question too many?");
    expect(res.status).toBe(403);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("plan_limit_standing_queries");
    expect(body.used).toBe(3);
    expect(body.limit).toBe(3);
    expect(body.plan).toBe("free");
  });

  test("re-watching an existing question is idempotent, not a duplicate slot", async () => {
    const res = await create(A, "Watched question number 1?");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { existed?: boolean };
    expect(body.existed).toBe(true);
  });

  test("reactivating a paused query re-enters the cap", async () => {
    // Pause one → a new create fits again → reactivating the paused one is refused.
    const list = (await (
      await app.request("/api/standing-queries", asUser(A.userId, A.email))
    ).json()) as { queries: Array<{ id: string }> };
    const paused = list.queries[0]!;
    const patch = (isActive: boolean) =>
      app.request(
        `/api/standing-queries/${paused.id}`,
        asUser(A.userId, A.email, { method: "PATCH", body: JSON.stringify({ isActive }) }),
      );
    expect((await patch(false)).status).toBe(200);
    expect((await create(A, "Fills the freed slot?")).status).toBe(200);
    const res = await patch(true);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe(
      "plan_limit_standing_queries",
    );
  });
});

describe("standing queries — org-scoped entity extraction", () => {
  test("citations are validated in-org: a foreign competitor id is dropped", async () => {
    const res = await create(B, "What is everyone doing on pricing?", [
      // comp-a belongs to org A — must be dropped for org B's query.
      { type: "competitor", id: "comp-a", label: "Acme" },
      { type: "competitor", id: "comp-b", label: "Foreign" },
      // Non-existent signal id — dropped too.
      { type: "signal", id: "sig-forged", label: "Forged" },
    ]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      query: {
        watchedCompetitorIds: string[];
        watchedCategories: string[];
        currentSignalIds: string[];
        currentCitations: Array<{ id: string }>;
      };
    };
    expect(body.query.watchedCompetitorIds).toEqual(["comp-b"]);
    expect(body.query.currentSignalIds).toEqual([]);
    expect(body.query.currentCitations.map((c) => c.id)).toEqual(["comp-b"]);
    // Deterministic keyword extraction from the question wording.
    expect(body.query.watchedCategories).toContain("pricing");
  });

  test("a foreign org cannot delete another org's query", async () => {
    const list = (await (
      await app.request("/api/standing-queries", asUser(B.userId, B.email))
    ).json()) as { queries: Array<{ id: string }> };
    const res = await app.request(
      `/api/standing-queries/${list.queries[0]!.id}`,
      asUser(A.userId, A.email, { method: "DELETE" }),
    );
    expect(res.status).toBe(404);
  });
});
