import { pgTable, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
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
});
