import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import type { Hono } from "hono";
import { oauthConnections } from "@outrival/db";
import { makeTestDb, type TestDb } from "./db-harness";
import { asUser, installAppMocks, mountApp, seedOrg } from "./app-harness";

process.env.OAUTH_TOKEN_ENCRYPTION_KEY = "a".repeat(64);
process.env.BETTER_AUTH_SECRET ??= "test-better-auth-secret-at-least-32-chars";
process.env.BETTER_AUTH_URL ??= "https://api.test";

// Route-level guarantee of the ticket: no response body ever carries a token. The
// assertions run on the RAW text, not on a parsed field, so a token added under any
// key at any depth fails the test.
const ACCESS_PLAINTEXT = "xoxb-access-plaintext-secret";
const REFRESH_PLAINTEXT = "xoxr-refresh-plaintext-secret";

let app: Hono;
let testDb: TestDb;
let closeDb: () => Promise<void>;
let resetDb: () => Promise<void>;
let encryptToken: (plaintext: string) => string;
let A: { orgId: string; userId: string; email: string };
let B: { orgId: string; userId: string; email: string };

afterAll(() => closeDb());

beforeAll(async () => {
  ({ db: testDb, close: closeDb, reset: resetDb } = await makeTestDb());
  await installAppMocks(testDb);
  ({ encryptToken } = await import("../src/lib/oauth/crypto"));
  const { oauthRouter } = await import("../src/routes/oauth");
  app = mountApp("/api/oauth", oauthRouter);
});

beforeEach(async () => {
  await resetDb();
  A = await seedOrg(testDb);
  B = await seedOrg(testDb);
  // Org A is connected; org B is the cross-tenant probe. "salesforce" on purpose:
  // no adapter is registered for it, so nothing here can reach a provider.
  await testDb.insert(oauthConnections).values({
    orgId: A.orgId,
    provider: "salesforce",
    accessToken: encryptToken(ACCESS_PLAINTEXT),
    refreshToken: encryptToken(REFRESH_PLAINTEXT),
    scopes: ["api", "refresh_token"],
    expiresAt: new Date(Date.now() + 3_600_000),
    accountLabel: "Acme Sandbox",
  });
});

describe("oauth routes", () => {
  test("rejects an unauthenticated request", async () => {
    const res = await app.request("/api/oauth", asUser(null));
    expect(res.status).toBe(401);
  });

  test("lists the org's connections without leaking a token", async () => {
    const res = await app.request("/api/oauth", asUser(A.userId, A.email));
    expect(res.status).toBe(200);

    const raw = await res.text();
    expect(raw).not.toContain(ACCESS_PLAINTEXT);
    expect(raw).not.toContain(REFRESH_PLAINTEXT);
    expect(raw).not.toContain("accessToken");
    expect(raw).not.toContain("refreshToken");

    const body = JSON.parse(raw) as {
      data: { connections: Array<{ provider: string; accountLabel: string | null }> };
    };
    expect(body.data.connections).toHaveLength(1);
    expect(body.data.connections[0]).toMatchObject({
      provider: "salesforce",
      connected: true,
      accountLabel: "Acme Sandbox",
    });
  });

  test("a single connection never carries a token either", async () => {
    const res = await app.request("/api/oauth/salesforce", asUser(A.userId, A.email));
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).not.toContain(ACCESS_PLAINTEXT);
    expect(raw).not.toContain(REFRESH_PLAINTEXT);
  });

  test("another org cannot see the connection", async () => {
    const res = await app.request("/api/oauth/salesforce", asUser(B.userId, B.email));
    expect(res.status).toBe(200);
    expect((await res.json()).data.connection).toBeNull();

    const list = await app.request("/api/oauth", asUser(B.userId, B.email));
    expect((await list.json()).data.connections).toHaveLength(0);
  });

  test("rejects an unknown provider", async () => {
    const res = await app.request("/api/oauth/dropbox", asUser(A.userId, A.email));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_provider");
  });

  test("start answers provider_not_configured while no adapter is wired", async () => {
    const res = await app.request(
      "/api/oauth/hubspot/start",
      asUser(A.userId, A.email, { method: "POST" }),
    );
    expect(res.status).toBe(501);
    expect((await res.json()).error).toBe("provider_not_configured");
  });

  test("a callback with a forged state is refused before any exchange", async () => {
    const res = await app.request(
      "/api/oauth/salesforce/callback?code=abc&state=forged",
      asUser(A.userId, A.email),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_state");
  });

  test("a callback the user declined is refused", async () => {
    const res = await app.request(
      "/api/oauth/salesforce/callback?error=access_denied",
      asUser(A.userId, A.email),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("oauth_denied");
  });

  test("disconnect removes the row and is idempotent", async () => {
    const first = await app.request(
      "/api/oauth/salesforce",
      asUser(A.userId, A.email, { method: "DELETE" }),
    );
    expect(first.status).toBe(200);
    expect((await first.json()).data.disconnected).toBe(true);

    const rows = await testDb
      .select()
      .from(oauthConnections)
      .where(eq(oauthConnections.orgId, A.orgId));
    expect(rows).toHaveLength(0);

    const second = await app.request(
      "/api/oauth/salesforce",
      asUser(A.userId, A.email, { method: "DELETE" }),
    );
    expect((await second.json()).data.disconnected).toBe(false);
  });

  test("another org cannot disconnect this org's connection", async () => {
    const res = await app.request(
      "/api/oauth/salesforce",
      asUser(B.userId, B.email, { method: "DELETE" }),
    );
    expect((await res.json()).data.disconnected).toBe(false);

    const rows = await testDb
      .select()
      .from(oauthConnections)
      .where(eq(oauthConnections.orgId, A.orgId));
    expect(rows).toHaveLength(1);
  });
});
