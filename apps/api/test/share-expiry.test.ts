import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { shareLinks } from "@outrival/db";
import { makeTestDb, type TestDb } from "./db-harness";
import { asUser, installAppMocks, installQueueMock, seedOrg } from "./app-harness";

// Audit 2026-09-02, S-06. A share link was a bearer capability that never expired and
// was served with `Cache-Control: public, max-age=300`: one forwarded mail kept
// leaking competitor and pricing data forever, and for five minutes after a revoke
// any shared cache happily served the report anyway.
//
// Three things are locked here: an expired token stops resolving, the response is no
// longer cacheable by anything, and the create-or-return path must not hand an
// expired row back (it would answer "Share" with a URL that already 410s).
let app: Hono;
let testDb: TestDb;
let closeDb: () => Promise<void>;

afterAll(() => closeDb());

beforeAll(async () => {
  ({ db: testDb, close: closeDb } = await makeTestDb());
  await installAppMocks(testDb);
  installQueueMock();
  const { shareRouter } = await import("../src/routes/share");
  const { publicReportRouter } = await import("../src/routes/public-report");
  app = new Hono().route("/api/share", shareRouter).route("/api/public/report", publicReportRouter);
});

const days = (n: number) => new Date(Date.now() + n * 86_400_000);

let seq = 0;
async function seedLink(
  orgId: string,
  opts: { expiresAt?: Date; revokedAt?: Date } = {},
): Promise<string> {
  const token = `tok${(++seq).toString().padStart(2, "0")}${"0".repeat(58)}`;
  await testDb.insert(shareLinks).values({
    orgId,
    type: "landscape",
    token,
    expiresAt: opts.expiresAt ?? days(30),
    revokedAt: opts.revokedAt ?? null,
  });
  return token;
}

describe("GET /api/public/report/:token", () => {
  test("1. regression: an expired link is gone, and says so", async () => {
    const { orgId } = await seedOrg(testDb);
    const token = await seedLink(orgId, { expiresAt: days(-1) });

    const res = await app.request(`/api/public/report/${token}`);

    // 410, not 404: the reader holds a link that WAS valid and needs to know to ask
    // for a fresh one rather than assume they were phished.
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: "expired" });
  });

  test("2. regression: a live report is never cached, by anyone", async () => {
    const { orgId } = await seedOrg(testDb);
    const token = await seedLink(orgId);

    const res = await app.request(`/api/public/report/${token}`);

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  test("3. revocation still wins over expiry: a revoked live link 404s", async () => {
    const { orgId } = await seedOrg(testDb);
    const token = await seedLink(orgId, { revokedAt: new Date() });

    expect((await app.request(`/api/public/report/${token}`)).status).toBe(404);
  });
});

describe("POST /api/share", () => {
  test("4. regression: an expired link is not handed back, a fresh one is minted", async () => {
    const { orgId, userId } = await seedOrg(testDb);
    const stale = await seedLink(orgId, { expiresAt: days(-1) });

    const res = await app.request(
      "/api/share",
      asUser(userId, "o@example.com", { method: "POST", body: JSON.stringify({}) }),
    );

    expect(res.status).toBe(201);
    expect((await res.json()).token).not.toBe(stale);
  });

  test("5. a live link is still returned as-is: sharing twice is idempotent", async () => {
    const { orgId, userId } = await seedOrg(testDb);
    const live = await seedLink(orgId);

    const res = await app.request(
      "/api/share",
      asUser(userId, "o@example.com", { method: "POST", body: JSON.stringify({}) }),
    );

    expect(res.status).toBe(200);
    expect((await res.json()).token).toBe(live);
  });
});

describe("the settings list and revoke", () => {
  test("6. expired links drop off the shared-reports list", async () => {
    const { orgId, userId } = await seedOrg(testDb);
    const live = await seedLink(orgId);
    await seedLink(orgId, { expiresAt: days(-1) });

    const res = await app.request("/api/share", asUser(userId, "o@example.com"));
    const { links } = (await res.json()) as { links: { token: string }[] };

    expect(links.map((l) => l.token)).toEqual([live]);
  });

  test("7. revoke deliberately ignores expiry, so a lapsed link can still be killed", async () => {
    const { orgId, userId } = await seedOrg(testDb);
    const token = await seedLink(orgId, { expiresAt: days(-1) });
    const [row] = await testDb
      .select({ id: shareLinks.id })
      .from(shareLinks)
      .where(eq(shareLinks.token, token));

    const res = await app.request(
      `/api/share/${row!.id}`,
      asUser(userId, "o@example.com", { method: "DELETE" }),
    );

    expect(res.status).toBe(200);
    const [after] = await testDb
      .select({ revokedAt: shareLinks.revokedAt })
      .from(shareLinks)
      .where(eq(shareLinks.token, token));
    expect(after!.revokedAt).not.toBeNull();
  });
});
