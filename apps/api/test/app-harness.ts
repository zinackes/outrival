import { resolve } from "node:path";
import { mock } from "bun:test";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { organizations, users } from "@outrival/db";
import type { Plan } from "@outrival/shared";
import type { TestDb } from "./db-harness";

// Wire the real routers to the PGlite test DB and a header-driven session, so a
// route's actual org-scoping / middleware logic runs unchanged. Call BEFORE
// importing any router (mock.module only intercepts subsequent imports).
//
// Auth is stubbed at the middleware boundary: the request carries the acting
// user via x-test-user-* headers. Everything below it — ensureUserOrg, the
// org-scoped WHEREs — runs for real against the seeded DB, which is exactly the
// behavior these tests need to lock.
export async function installAppMocks(testDb: TestDb): Promise<void> {
  const real = await import("@outrival/db");
  mock.module("@outrival/db", () => ({ ...real, db: testDb }));
  mock.module(resolve(import.meta.dir, "../src/lib/db"), () => ({ db: testDb }));
  mock.module(resolve(import.meta.dir, "../src/middleware/auth"), () => ({
    authMiddleware: createMiddleware(async (c, next) => {
      const id = c.req.header("x-test-user-id");
      if (!id) return c.json({ error: "Unauthorized" }, 401);
      c.set("user", { id, email: c.req.header("x-test-user-email") ?? "" });
      c.set("session", { userId: id });
      await next();
    }),
  }));
}

/** Build a one-route app for app.request(), matching the prod mount path. */
export function mountApp(basePath: string, router: Hono): Hono {
  return new Hono().route(basePath, router);
}

/** A request as a given user (or anonymous when userId is null). */
export function asUser(
  userId: string | null,
  email = "u@example.com",
  init: RequestInit = {},
): RequestInit {
  const headers = new Headers(init.headers);
  if (userId) {
    headers.set("x-test-user-id", userId);
    headers.set("x-test-user-email", email);
  }
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return { ...init, headers };
}

let seq = 0;
/** Seed an organization + its owner user; returns their ids. */
export async function seedOrg(
  testDb: TestDb,
  opts: { plan?: Plan; email?: string } = {},
): Promise<{ orgId: string; userId: string; email: string }> {
  const n = ++seq;
  const orgId = `org-${n}`;
  const userId = `user-${n}`;
  const email = opts.email ?? `owner${n}@example.com`;
  await testDb
    .insert(organizations)
    .values({ id: orgId, name: `Org ${n}`, slug: `org-${n}`, plan: opts.plan ?? "free" });
  await testDb
    .insert(users)
    .values({ id: userId, email, name: `User ${n}`, orgId, role: "owner" });
  return { orgId, userId, email };
}
