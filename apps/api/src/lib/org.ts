import { eq } from "drizzle-orm";
import { db } from "./db";
import { users, organizations } from "@outrival/db";

/**
 * Returns the orgId for a user, creating a personal org if none exists.
 * Uses an upsert on slug so a previously-created org is reused rather than
 * causing a unique-constraint failure on concurrent or retried requests.
 */
export async function ensureUserOrg(userId: string): Promise<string> {
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
