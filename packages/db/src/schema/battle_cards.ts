import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { competitors } from "./competitors";
import { organizations } from "./organizations";

export const battleCards = pgTable("battle_cards", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  competitorId: text("competitor_id")
    .notNull()
    .references(() => competitors.id, { onDelete: "cascade" }),
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
});
