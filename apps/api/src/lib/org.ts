import { eq } from "drizzle-orm";
import { db } from "./db";
import { users, organizations } from "@outrival/db";

/**
 * Returns the orgId for a user, creating a personal org if none exists.
 */
export async function ensureUserOrg(userId: string): Promise<string> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) throw new Error(`User ${userId} not found`);
  if (user.orgId) return user.orgId;

  const slug = `org-${userId.slice(0, 8)}`;
  const [org] = await db
    .insert(organizations)
    .values({ name: `${user.name}'s workspace`, slug, plan: "free" })
    .returning();
  if (!org) throw new Error("Failed to create org");

  await db.update(users).set({ orgId: org.id, role: "owner" }).where(eq(users.id, userId));
  return org.id;
}
