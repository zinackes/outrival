import { eq } from "drizzle-orm";
import { getContext } from "hono/context-storage";
import { db } from "./db";
import { users, organizations } from "@outrival/db";

/**
 * Returns the orgId for a user, creating a personal org if none exists.
 * Uses an upsert on slug so a previously-created org is reused rather than
 * causing a unique-constraint failure on concurrent or retried requests.
 */
export async function ensureUserOrg(userId: string): Promise<string> {
  // Fast path: the auth middleware already loaded this request's orgId onto the
  // Hono context (same users row as the suspended check), so we avoid a second
  // users round-trip on every authenticated request. getContext throws when called
  // outside a request scope — fall through to the direct read in that case.
  try {
    const cached = getContext<{ Variables: { orgId?: string | null } }>().get("orgId");
    if (cached) return cached;
  } catch {
    // no request context (e.g. a worker/script call) — read from the DB below
  }

  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) throw new Error(`User ${userId} not found`);
  if (user.orgId) return user.orgId;

  // Full userId: a truncated prefix could collide across users, and the
  // ON CONFLICT below would then silently attach this user to someone else's
  // org (cross-tenant exposure). The conflict path must only ever match this
  // user's own previously-created org.
  const slug = `org-${userId}`;
  // ON CONFLICT DO UPDATE (no-op update on slug) so we always get the row back,
  // whether we just created it or it already existed from a previous attempt.
  const [org] = await db
    .insert(organizations)
    .values({ name: `${user.name ?? user.email}'s workspace`, slug, plan: "free" })
    .onConflictDoUpdate({ target: organizations.slug, set: { slug } })
    .returning();
  if (!org) throw new Error("Failed to create org");

  await db.update(users).set({ orgId: org.id, role: "owner" }).where(eq(users.id, userId));
  return org.id;
}
