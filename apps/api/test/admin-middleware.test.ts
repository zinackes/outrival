import { beforeAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";

// adminMiddleware is the only thing standing between a normal logged-in customer
// and every other tenant's ops data (/admin/*). It must gate on the ADMIN_EMAILS
// allowlist, never the org "owner" role. Read at module load, so set env first.
let app: Hono;

beforeAll(async () => {
  process.env.ADMIN_EMAILS = "ops@example.com, second@example.com";
  const { adminMiddleware } = await import("../src/middleware/admin");
  // Inline auth stub (no DB needed): inject the acting user from headers.
  const authStub = createMiddleware(async (c, next) => {
    const id = c.req.header("x-test-user-id");
    if (!id) return c.json({ error: "Unauthorized" }, 401);
    c.set("user", { id, email: c.req.header("x-test-user-email") ?? "" });
    await next();
  });
  app = new Hono();
  app.use("*", authStub);
  app.use("*", adminMiddleware);
  app.get("/admin/ping", (c) => c.json({ ok: true }));
});

const as = (email: string | null) => ({
  headers: email ? { "x-test-user-id": "u1", "x-test-user-email": email } : {},
});

describe("adminMiddleware allowlist", () => {
  test("401 when unauthenticated", async () => {
    expect((await app.request("/admin/ping", as(null))).status).toBe(401);
  });

  test("403 for a normal logged-in user not on the allowlist", async () => {
    expect((await app.request("/admin/ping", as("customer@acme.com"))).status).toBe(403);
  });

  test("403 is case/owner-proof: a plausible owner email still fails", async () => {
    expect((await app.request("/admin/ping", as("owner@acme.com"))).status).toBe(403);
  });

  test("200 for an allowlisted admin (case-insensitive)", async () => {
    expect((await app.request("/admin/ping", as("OPS@example.com"))).status).toBe(200);
  });

  test("200 for a second allowlisted admin (comma list trimmed)", async () => {
    expect((await app.request("/admin/ping", as("second@example.com"))).status).toBe(200);
  });
});
