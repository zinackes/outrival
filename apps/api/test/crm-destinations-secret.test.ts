// Same key the other API suites install; the module caches it on first use, so a
// different value here would be silently ignored depending on file order.
process.env.OAUTH_TOKEN_ENCRYPTION_KEY = "a".repeat(64);

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import { crmDestinations } from "@outrival/db";
import { decryptSecret, isEncryptedSecret } from "@outrival/shared";
import { eq } from "drizzle-orm";
import { makeTestDb, type TestDb } from "./db-harness";
import { asUser, installAppMocks, installQueueMock, mountApp, seedOrg } from "./app-harness";

// code:SEC-08 — crm_destinations.secret shipped in cleartext next to
// oauth_connections, whose tokens have always been AES-256-GCM. That secret is the
// HMAC key authenticating every webhook this product sends, so a Neon backup or
// branch leak handed an attacker the ability to forge signed payloads.

const KEY = "a".repeat(64);
const PLAINTEXT = "whsec_never_store_me_raw";

let testDb: TestDb;
let closeDb: () => Promise<void>;
let app: Hono;

beforeAll(async () => {
  ({ db: testDb, close: closeDb } = await makeTestDb());
  await installAppMocks(testDb);
  installQueueMock();
  const { crmDestinationsRouter } = await import("../src/routes/crm-destinations");
  app = mountApp("/api/crm-destinations", crmDestinationsRouter);
});

afterAll(() => closeDb());

afterEach(() => {
  process.env.OAUTH_TOKEN_ENCRYPTION_KEY = KEY;
});

async function create(
  userId: string,
  email: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await app.request(
    "/api/crm-destinations",
    asUser(userId, email, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function storedSecret(id: string): Promise<string | null> {
  const [row] = await testDb
    .select({ secret: crmDestinations.secret })
    .from(crmDestinations)
    .where(eq(crmDestinations.id, id));
  return row?.secret ?? null;
}

describe("POST /api/crm-destinations", () => {
  test("stores the signing secret as ciphertext, never as the plaintext the client sent", async () => {
    const org = await seedOrg(testDb, { plan: "business" });
    const { status, body } = await create(org.userId, org.email, {
      name: "Zapier",
      url: "https://hooks.zapier.com/hooks/catch/1/abc",
      secret: PLAINTEXT,
    });

    expect(status).toBe(201);
    const dest = body.destination as { id: string; hasSecret: boolean };
    expect(dest.hasSecret).toBe(true);

    const stored = await storedSecret(dest.id);
    expect(stored).not.toBeNull();
    expect(stored).not.toBe(PLAINTEXT);
    expect(stored).not.toContain(PLAINTEXT);
    expect(isEncryptedSecret(stored!)).toBe(true);
    expect(decryptSecret(stored!)).toBe(PLAINTEXT);
  });

  test("a destination without a secret still stores null, not an encrypted empty string", async () => {
    const org = await seedOrg(testDb, { plan: "business" });
    const { status, body } = await create(org.userId, org.email, {
      name: "No secret",
      url: "https://hooks.zapier.com/hooks/catch/2/abc",
    });

    expect(status).toBe(201);
    const dest = body.destination as { id: string; hasSecret: boolean };
    expect(dest.hasSecret).toBe(false);
    expect(await storedSecret(dest.id)).toBeNull();
  });

  test("refuses to store a secret at all when no encryption key is configured", async () => {
    const org = await seedOrg(testDb, { plan: "business" });
    delete process.env.OAUTH_TOKEN_ENCRYPTION_KEY;

    const { status, body } = await create(org.userId, org.email, {
      name: "Unconfigured",
      url: "https://hooks.zapier.com/hooks/catch/3/abc",
      secret: PLAINTEXT,
    });

    expect(status).toBe(500);
    expect(body.error).toBe("secret_encryption_unconfigured");

    process.env.OAUTH_TOKEN_ENCRYPTION_KEY = KEY;
    const rows = await testDb
      .select({ id: crmDestinations.id })
      .from(crmDestinations)
      .where(eq(crmDestinations.orgId, org.orgId));
    expect(rows).toHaveLength(0);
  });
});

describe("PATCH /api/crm-destinations/:id", () => {
  test("rotating the secret writes fresh ciphertext, not the new plaintext", async () => {
    const org = await seedOrg(testDb, { plan: "business" });
    const created = await create(org.userId, org.email, {
      name: "Rotate me",
      url: "https://hooks.zapier.com/hooks/catch/4/abc",
      secret: PLAINTEXT,
    });
    const id = (created.body.destination as { id: string }).id;
    const before = await storedSecret(id);

    const res = await app.request(
      `/api/crm-destinations/${id}`,
      asUser(org.userId, org.email, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: "whsec_rotated" }),
      }),
    );
    expect(res.status).toBe(200);

    const after = await storedSecret(id);
    expect(after).not.toBe(before);
    expect(after).not.toContain("whsec_rotated");
    expect(decryptSecret(after!)).toBe("whsec_rotated");
  });

  test("clearing the secret writes null", async () => {
    const org = await seedOrg(testDb, { plan: "business" });
    const created = await create(org.userId, org.email, {
      name: "Clear me",
      url: "https://hooks.zapier.com/hooks/catch/5/abc",
      secret: PLAINTEXT,
    });
    const id = (created.body.destination as { id: string }).id;

    const res = await app.request(
      `/api/crm-destinations/${id}`,
      asUser(org.userId, org.email, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: null }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await storedSecret(id)).toBeNull();
  });
});

describe("GET /api/crm-destinations", () => {
  test("returns hasSecret and never the secret itself, in either shape", async () => {
    const org = await seedOrg(testDb, { plan: "business" });
    await create(org.userId, org.email, {
      name: "Listed",
      url: "https://hooks.zapier.com/hooks/catch/6/abc",
      secret: PLAINTEXT,
    });

    const res = await app.request("/api/crm-destinations", asUser(org.userId, org.email));
    const raw = await res.text();
    expect(res.status).toBe(200);
    expect(raw).not.toContain(PLAINTEXT);
    expect(raw).not.toContain("v1.");
    expect(JSON.parse(raw).destinations[0].hasSecret).toBe(true);
  });
});
