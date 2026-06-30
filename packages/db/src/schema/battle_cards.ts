import { pgTable, text, timestamp, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { competitors } from "./competitors";
import { organizations } from "./organizations";
import { products } from "./products";

export const battleCards = pgTable("battle_cards", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  competitorId: text("competitor_id")
    .notNull()
    .references(() => competitors.id, { onDelete: "cascade" }),
  // patch-28 — a battle card is now scoped to a (product, competitor) couple:
  // "Marketing Hub vs Mailchimp" differs from "Sales Hub vs Mailchimp". Nullable
  // until backfilled by the patch-28 migration; new cards always set it.
  productId: text("product_id").references(() => products.id, { onDelete: "cascade" }),
  orgId: text("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  content: jsonb("content").notNull(),
  pdfR2Key: text("pdf_r2_key"),
  // Set when a user marks the card "not useful" (patch-21): flags it for
  // regeneration. Cleared on the next successful regeneration.
  flaggedForRegenerationAt: timestamp("flagged_for_regeneration_at"),
  // Snapshots of the latest inputs at generation time (patch-22 intelligent rate
  // limiting): the user's last self-profile edit and the competitor's last signal.
  // Staleness = either has moved past these → the card is "outdated".
  basedOnUserUpdateAt: timestamp("based_on_user_update_at"),
  basedOnCompetitorSignalAt: timestamp("based_on_competitor_signal_at"),
  generatedAt: timestamp("generated_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  // One card per (product, competitor) couple. Postgres treats NULL productId as
  // distinct, so legacy rows (pre-backfill) don't collide; new rows always set it.
  uniqueIndex("battle_cards_product_competitor_uq").on(t.productId, t.competitorId),
  // Org feed (GET /api/battle-cards) + competitor cascade — the unique index above
  // leads with productId, so neither orgId nor competitorId is covered on its own.
  index("battle_cards_org_idx").on(t.orgId),
  index("battle_cards_competitor_idx").on(t.competitorId),
]);
