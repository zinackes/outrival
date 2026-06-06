import { pgTable, text, boolean, timestamp, index } from "drizzle-orm/pg-core";
import type { InferSelectModel, InferInsertModel } from "drizzle-orm";
import { organizations } from "./organizations";

// Outbound webhook targets (Phase C). The org configures one or more URLs that
// receive a JSON push when a signal is alerted (Zapier/Make/n8n/any CRM). Generic
// on purpose — no provider OAuth. Optional `secret` signs the body (HMAC-SHA256).
// See docs/distribution-team.md.
export const crmDestinations = pgTable(
  "crm_destinations",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    url: text("url").notNull(),
    secret: text("secret"),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    lastPushedAt: timestamp("last_pushed_at"),
  },
  (t) => [index("crm_destinations_org_idx").on(t.orgId)],
);

export type CrmDestination = InferSelectModel<typeof crmDestinations>;
export type NewCrmDestination = InferInsertModel<typeof crmDestinations>;
