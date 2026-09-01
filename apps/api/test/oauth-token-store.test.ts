import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { oauthConnections } from "@outrival/db";
import { makeTestDb, type TestDb } from "./db-harness";
import { installAppMocks, seedOrg } from "./app-harness";

// Fixed key + secret so encryption and state signing are deterministic here. Set
// before the first crypto call, not before the imports: both modules read env
// lazily precisely so a test can do this.
process.env.OAUTH_TOKEN_ENCRYPTION_KEY = "a".repeat(64);
process.env.BETTER_AUTH_SECRET ??= "test-better-auth-secret-at-least-32-chars";

type TokenStore = typeof import("../src/lib/oauth/token-store");
type Crypto = typeof import("../src/lib/oauth/crypto");
type Providers = typeof import("../src/lib/oauth/providers");

let store: TokenStore;
let crypto_: Crypto;
let providers: Providers;
let testDb: TestDb;
let closeDb: () => Promise<void>;
let resetDb: () => Promise<void>;
let A: { orgId: string; userId: string; email: string };

// How many times the stub provider was asked to refresh. The "valid token makes no
// network call" guarantee is only checkable by counting the calls that did not happen.
let refreshCalls = 0;
let refreshImpl: () => Promise<import("../src/lib/oauth/providers").OAuthTokenSet>;

afterAll(() => closeDb());

beforeAll(async () => {
  ({ db: testDb, close: closeDb, reset: resetDb } = await makeTestDb());
  await installAppMocks(testDb);
  store = await import("../src/lib/oauth/token-store");
  crypto_ = await import("../src/lib/oauth/crypto");
  providers = await import("../src/lib/oauth/providers");

  // Stand-in for the Slack adapter that lands in the next ticket. Registered on
  // "slack" only: the route test asserts "no adapter" on a different provider.
  providers.registerProvider({
    provider: "slack",
    authorizeUrl: (state) => `https://slack.test/oauth?state=${state}`,
    exchangeCode: async () => ({
      accessToken: "exchanged-access",
      refreshToken: "exchanged-refresh",
      expiresAt: null,
      scopes: ["chat:write"],
      accountLabel: "Test Workspace",
    }),
    refresh: async () => {
      refreshCalls += 1;
      return refreshImpl();
    },
  });
});

beforeEach(async () => {
  await resetDb();
  A = await seedOrg(testDb);
  refreshCalls = 0;
  refreshImpl = async () => ({
    accessToken: "refreshed-access",
    refreshToken: "refreshed-refresh",
    expiresAt: new Date(Date.now() + 3_600_000),
    scopes: ["chat:write"],
    accountLabel: "Test Workspace",
  });
});

const inOneHour = () => new Date(Date.now() + 3_600_000);
const anHourAgo = () => new Date(Date.now() - 3_600_000);

async function seedConnection(opts: {
  orgId: string;
  accessToken: string;
  refreshToken?: string | null;
  expiresAt: Date | null;
}): Promise<void> {
  await testDb.insert(oauthConnections).values({
    orgId: opts.orgId,
    provider: "slack",
    accessToken: crypto_.encryptToken(opts.accessToken),
    refreshToken: opts.refreshToken ? crypto_.encryptToken(opts.refreshToken) : null,
    scopes: ["chat:write"],
    expiresAt: opts.expiresAt,
    accountLabel: "Test Workspace",
  });
}

describe("oauth token encryption", () => {
  test("round-trips a token without leaking the plaintext", () => {
    const secret = "xoxb-très-secret-🔐";
    const payload = crypto_.encryptToken(secret);
    expect(payload).not.toContain(secret);
    expect(payload.startsWith("v1.")).toBe(true);
    expect(crypto_.decryptToken(payload)).toBe(secret);
  });

  test("two encryptions of the same token differ (random IV)", () => {
    expect(crypto_.encryptToken("same")).not.toBe(crypto_.encryptToken("same"));
  });

  test("rejects a tampered payload", () => {
    const payload = crypto_.encryptToken("xoxb-secret");
    const parts = payload.split(".");
    const tampered = `${parts[0]}.${parts[1]}.${parts[2]}.${Buffer.from("nope").toString("base64")}`;
    expect(() => crypto_.decryptToken(tampered)).toThrow("secret_undecryptable");
    expect(() => crypto_.decryptToken("not-a-payload")).toThrow("secret_undecryptable");
  });
});

describe("getValidToken", () => {
  test("returns a still-valid token without any network call", async () => {
    await seedConnection({ orgId: A.orgId, accessToken: "live-token", expiresAt: inOneHour() });
    expect(await store.getValidToken(A.orgId, "slack")).toBe("live-token");
    expect(refreshCalls).toBe(0);
  });

  test("treats a null expiry as never expiring", async () => {
    await seedConnection({ orgId: A.orgId, accessToken: "eternal-token", expiresAt: null });
    expect(await store.getValidToken(A.orgId, "slack")).toBe("eternal-token");
    expect(refreshCalls).toBe(0);
  });

  test("refreshes an expired token once and persists the new one", async () => {
    await seedConnection({
      orgId: A.orgId,
      accessToken: "stale-token",
      refreshToken: "old-refresh",
      expiresAt: anHourAgo(),
    });

    expect(await store.getValidToken(A.orgId, "slack")).toBe("refreshed-access");
    expect(refreshCalls).toBe(1);

    const row = await testDb.query.oauthConnections.findFirst({
      where: eq(oauthConnections.orgId, A.orgId),
    });
    expect(row).toBeDefined();
    expect(crypto_.decryptToken(row!.accessToken)).toBe("refreshed-access");
    expect(crypto_.decryptToken(row!.refreshToken!)).toBe("refreshed-refresh");
    expect(row!.expiresAt!.getTime()).toBeGreaterThan(Date.now());

    // Persisted, so the next read is served from the row and calls out again zero times.
    expect(await store.getValidToken(A.orgId, "slack")).toBe("refreshed-access");
    expect(refreshCalls).toBe(1);
  });

  test("keeps the old refresh token when the provider rotates none", async () => {
    refreshImpl = async () => ({
      accessToken: "refreshed-access",
      refreshToken: null,
      expiresAt: inOneHour(),
      scopes: [],
      accountLabel: null,
    });
    await seedConnection({
      orgId: A.orgId,
      accessToken: "stale-token",
      refreshToken: "old-refresh",
      expiresAt: anHourAgo(),
    });

    await store.getValidToken(A.orgId, "slack");
    const row = await testDb.query.oauthConnections.findFirst({
      where: eq(oauthConnections.orgId, A.orgId),
    });
    expect(crypto_.decryptToken(row!.refreshToken!)).toBe("old-refresh");
  });

  test("throws when the org has no connection", async () => {
    expect(store.getValidToken(A.orgId, "slack")).rejects.toBeInstanceOf(
      store.OAuthConnectionRevokedError,
    );
  });

  test("throws when an expired connection has no refresh token", async () => {
    await seedConnection({
      orgId: A.orgId,
      accessToken: "stale-token",
      refreshToken: null,
      expiresAt: anHourAgo(),
    });
    expect(store.getValidToken(A.orgId, "slack")).rejects.toBeInstanceOf(
      store.OAuthConnectionRevokedError,
    );
  });

  test("surfaces a rejected refresh as a revoked connection", async () => {
    refreshImpl = async () => {
      throw new Error("invalid_grant");
    };
    await seedConnection({
      orgId: A.orgId,
      accessToken: "stale-token",
      refreshToken: "revoked-refresh",
      expiresAt: anHourAgo(),
    });
    expect(store.getValidToken(A.orgId, "slack")).rejects.toBeInstanceOf(
      store.OAuthConnectionRevokedError,
    );
  });
});

describe("getConnectionStatus", () => {
  test("never carries a token", async () => {
    await seedConnection({
      orgId: A.orgId,
      accessToken: "xoxb-access-secret",
      refreshToken: "xoxr-refresh-secret",
      expiresAt: inOneHour(),
    });

    const status = await store.getConnectionStatus(A.orgId, "slack");
    expect(status).not.toBeNull();
    expect(status).toMatchObject({
      provider: "slack",
      connected: true,
      accountLabel: "Test Workspace",
      scopes: ["chat:write"],
    });
    expect(Object.keys(status!)).not.toContain("accessToken");
    expect(Object.keys(status!)).not.toContain("refreshToken");

    const serialized = JSON.stringify(status);
    expect(serialized).not.toContain("xoxb-access-secret");
    expect(serialized).not.toContain("xoxr-refresh-secret");
  });

  test("is null for an org that never connected", async () => {
    expect(await store.getConnectionStatus(A.orgId, "slack")).toBeNull();
  });
});

describe("saveConnection / deleteConnection", () => {
  test("reconnecting rotates the tokens in place", async () => {
    const tokens = {
      accessToken: "first-access",
      refreshToken: "first-refresh",
      expiresAt: inOneHour(),
      scopes: ["chat:write"],
      accountLabel: "Test Workspace",
    };
    await store.saveConnection(A.orgId, "slack", tokens);
    await store.saveConnection(A.orgId, "slack", { ...tokens, accessToken: "second-access" });

    const rows = await testDb
      .select()
      .from(oauthConnections)
      .where(eq(oauthConnections.orgId, A.orgId));
    expect(rows).toHaveLength(1);
    expect(await store.getValidToken(A.orgId, "slack")).toBe("second-access");
  });

  test("reports whether a connection existed", async () => {
    await seedConnection({ orgId: A.orgId, accessToken: "live-token", expiresAt: inOneHour() });
    expect(await store.deleteConnection(A.orgId, "slack")).toBe(true);
    expect(await store.deleteConnection(A.orgId, "slack")).toBe(false);
  });
});

describe("oauth state signing", () => {
  test("round-trips the org and provider", () => {
    const verified = store.verifyState(store.signState(A.orgId, "slack"));
    expect(verified).toEqual({ orgId: A.orgId, provider: "slack" });
  });

  test("rejects a tampered or malformed state", () => {
    const state = store.signState(A.orgId, "slack");
    const [encoded] = state.split(".") as [string, string];
    expect(store.verifyState(`${encoded}.forgedsignature`)).toBeNull();
    expect(store.verifyState("garbage")).toBeNull();
    expect(store.verifyState("")).toBeNull();
  });

  test("rejects a state minted for another org's payload", () => {
    // Re-encoding the payload with a different org invalidates the signature, which
    // is what stops a caller from binding a connection to a workspace they picked.
    const state = store.signState(A.orgId, "slack");
    const [, signature] = state.split(".") as [string, string];
    const forged = Buffer.from(`other-org.slack.${Date.now()}`, "utf8").toString("base64url");
    expect(store.verifyState(`${forged}.${signature}`)).toBeNull();
  });
});
