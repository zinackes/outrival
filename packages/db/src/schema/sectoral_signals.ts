import {
  pgTable,
  text,
  timestamp,
  jsonb,
  pgEnum,
  numeric,
  index,
} from "drizzle-orm/pg-core";
import type { InferSelectModel, InferInsertModel } from "drizzle-orm";
import { organizations } from "./organizations";

// Meso-level trends across an org's OWN competitors (patch-13). Kept distinct from
// the micro `signals` table so the two never mix in queries or UI.
export const sectoralCategoryEnum = pgEnum("sectoral_category", [
  "feature_trend", // a wave of feature additions sharing a theme (AI, integrations…)
  "hiring_trend", // a wave of hiring in the same role category (Sales, AI/ML…)
  "pricing_trend", // a sector-wide drift in pricing
  "positioning_shift", // several competitors changing pricing status (public → gated)
  "category_emergence", // a new kind of feature/offering appearing across competitors
]);

// Traceability payload kept verbatim from the detector so the UI can show which
// competitors and data points produced the signal (no AI invention possible).
export type SectoralEvidence = {
  competitors: Array<{ id: string; name: string }>;
  dataPoints: unknown[];
  metric: string;
  value: number | string;
};

export const sectoralSignals = pgTable("sectoral_signals", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),

  category: sectoralCategoryEnum("category").notNull(),
  title: text("title").notNull(),
  insight: text("insight").notNull(),
  evidence: jsonb("evidence").$type<SectoralEvidence>().notNull(),
  // numeric(3,2) → Drizzle returns it as a string; producers pass `n.toFixed(2)`.
  confidence: numeric("confidence", { precision: 3, scale: 2 }).notNull(),
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),

  // User state.
  readAt: timestamp("read_at"),
  dismissedAt: timestamp("dismissed_at"),

  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  // Sectoral feed is org-scoped; also covers eraseOrg cascade.
  index("sectoral_signals_org_idx").on(t.orgId),
]);

export type SectoralSignal = InferSelectModel<typeof sectoralSignals>;
export type NewSectoralSignal = InferInsertModel<typeof sectoralSignals>;
