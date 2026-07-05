import { pgTable, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import type { InferSelectModel } from "drizzle-orm";
import { organizations } from "./organizations";
import { users } from "./users";
import { products } from "./products";

// Public read-only share links (Lever 8, docs/post-onboarding-activation.md). An
// unguessable, revocable token per shared artifact → a public Next route renders a
// static branded view ("Powered by Outrival" → acquisition loop). Default OFF: a row
// exists only after an explicit user "Share" action. Org-scoped and revocable
// (revoked_at); the public resolver rejects revoked/absent tokens. No index / no
// sitemap (the token is the only capability).
//
// `type` keeps it extensible (landscape now; battle_card next). `product_id` scopes a
// "landscape" report to one SKU; null for future org-level artifacts.
export const shareLinks = pgTable(
  "share_links",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    type: text("type").notNull().default("landscape"),
    productId: text("product_id").references(() => products.id, { onDelete: "cascade" }),
    // The capability. Generated server-side (128-bit, unguessable), unique so a lookup
    // resolves exactly one artifact.
    token: text("token").notNull(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    // Revocation is soft: keep the row so a revoked link stays dead even if re-shared.
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("share_links_token_uq").on(t.token),
    index("share_links_org_idx").on(t.orgId),
  ],
);

export type ShareLink = InferSelectModel<typeof shareLinks>;
