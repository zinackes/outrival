import { pgTable, text, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

export const roleEnum = pgEnum("role", ["owner", "admin", "member"]);

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  orgId: text("org_id").references(() => organizations.id, { onDelete: "cascade" }),
  email: text("email").notNull().unique(),
  name: text("name"),
  role: roleEnum("role").notNull().default("member"),
  // Set by an operator from /admin to lock an account out (anti-abuse). Enforced
  // in authMiddleware (existing sessions rejected) + the OTP send path (no new
  // code issued). Null = active.
  suspendedAt: timestamp("suspended_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  // Resolved on every authenticated request (ensureUserOrg) + members list +
  // eraseOrg cascade. Without it each lookup is a seq scan of the users table.
  index("users_org_idx").on(t.orgId),
]);
