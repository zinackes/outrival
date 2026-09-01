import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import { organizations } from "@outrival/db";
import { eq } from "drizzle-orm";
import { makeTestDb, type TestDb } from "./db-harness";
import { asUser, installAppMocks, installQueueMock, mountApp, seedOrg } from "./app-harness";

// code:SEC-02 — POST /api/notifications/test used a bare fetch() on the org's own
// slackWebhookUrl / webhookUrl: no host re-validation, no redirect guard, and the
// raw fetch error echoed back. That turns an authenticated member into an
// internal-network probe (reachable vs refused vs timeout, all readable in the
// response). Both channels now go through the shared guarded senders and report one
// opaque code.

let testDb: TestDb;
let closeDb: () => Promise<void>;
let app: Hono;

const realFetch = globalThis.fetch;

beforeAll(async () => {
  ({ db: testDb, close: closeDb } = await makeTestDb());
  await installAppMocks(testDb);
  installQueueMock();
  const { notificationsRouter } = await import("../src/routes/notifications");
  app = mountApp("/api/notifications", notificationsRouter);
});

afterAll(() => closeDb());

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Count outbound calls; anything that does go out answers 200. */
function countFetches(): () => string[] {
  const urls: string[] = [];
  globalThis.fetch = (async (input: string | URL) => {
    urls.push(String(input));
    return {
      status: 200,
      ok: true,
      headers: { get: () => null },
      text: async () => "",
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return () => [...urls];
}

async function postTest(userId: string, email: string) {
  const res = await app.request(
    "/api/notifications/test",
    asUser(userId, email, { method: "POST" }),
  );
  return { status: res.status, body: (await res.json()) as { results: Record<string, string>; errors: Record<string, string> } };
}

describe("POST /api/notifications/test", () => {
  test("never fetches an internal destination, and reports no detail about it", async () => {
    const org = await seedOrg(testDb);
    await testDb
      .update(organizations)
      .set({
        slackWebhookUrl: "https://hooks.slack.internal/services/T/B/x",
        webhookUrl: "http://169.254.169.254/latest/meta-data/",
      })
      .where(eq(organizations.id, org.orgId));

    const seen = countFetches();
    const { status, body } = await postTest(org.userId, org.email);

    expect(status).toBe(200);
    expect(seen()).toEqual([]);
    expect(body.results.slack).toBe("error");
    expect(body.results.webhook).toBe("error");
    // No status code, no hostname, no connection-refused vs timeout distinction.
    expect(body.errors.slack).toBe("delivery_failed");
    expect(body.errors.webhook).toBe("delivery_failed");
  });

  test("still delivers to a public https destination", async () => {
    const org = await seedOrg(testDb);
    await testDb
      .update(organizations)
      .set({
        slackWebhookUrl: "https://hooks.slack.example/services/T/B/x",
        webhookUrl: "https://hooks.example.com/ingest",
      })
      .where(eq(organizations.id, org.orgId));

    const seen = countFetches();
    const { body } = await postTest(org.userId, org.email);

    expect(seen().sort()).toEqual([
      "https://hooks.example.com/ingest",
      "https://hooks.slack.example/services/T/B/x",
    ]);
    expect(body.results.slack).toBe("sent");
    expect(body.results.webhook).toBe("sent");
  });

  test("reports not_configured for an org with no channel wired up", async () => {
    const org = await seedOrg(testDb);
    const seen = countFetches();
    const { body } = await postTest(org.userId, org.email);

    expect(seen()).toEqual([]);
    expect(body.results).toEqual({
      email: "not_configured",
      slack: "not_configured",
      webhook: "not_configured",
    });
  });

  test("requires authentication", async () => {
    const res = await app.request("/api/notifications/test", asUser(null, "", { method: "POST" }));
    expect(res.status).toBe(401);
  });
});
