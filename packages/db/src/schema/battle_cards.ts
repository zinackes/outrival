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
  generatedAt: timestamp("generated_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
