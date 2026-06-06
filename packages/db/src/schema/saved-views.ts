import { pgTable, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { InferSelectModel, InferInsertModel } from "drizzle-orm";
import { organizations } from "./organizations";
import { users } from "./users";

// Saved filter sets for the Signals feed (Phase B). Org-scoped; `user_id` = creator
// (multi-user is off today, so effectively per-user, but org-scoped is forward-
// compatible). `filters` is the opaque feed filter state applied on the client.
// See docs/activation-retention.md.
export interface SavedViewFilters {
  competitorIds?: string[];
  categories?: string[];
  severities?: string[];
  view?: string;
}

export const savedViews = pgTable(
  "saved_views",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    filters: jsonb("filters").$type<SavedViewFilters>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("saved_views_org_idx").on(t.orgId)],
);

export type SavedView = InferSelectModel<typeof savedViews>;
export type NewSavedView = InferInsertModel<typeof savedViews>;
