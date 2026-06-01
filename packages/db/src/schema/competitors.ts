import { pgTable, text, timestamp, real, jsonb, boolean } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

// One editable profile field on the self-competitor (patch-12). Tracks whether the
// value still comes from auto-detection or was corrected by the user, so the UI can
// render "detected automatically" vs "edited by you on <date>".
export type SelfProfileField<T> = {
  value: T;
  isFromAutoDetect: boolean;
  lastEditedByUserAt: string | null; // ISO timestamp, null while auto-detected
};

// Rich, user-editable profile of the user's own product (type = "self"). Pricing
// lives on the pricing* columns (patch-11); jobs in job_postings. Features and
// techStack are extracted by extract-self-profile and have no other home.
export type SelfProfile = {
  category?: SelfProfileField<string>;
  audience?: SelfProfileField<string>;
  valueProp?: SelfProfileField<string>;
  features?: SelfProfileField<string[]>;
  techStack?: SelfProfileField<string[]>;
};

export const competitors = pgTable("competitors", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  // Nullable: a "self" product at the idea/document/developing stage has no live
  // site to point at yet (patch-15). Real competitors always carry a URL.
  url: text("url"),
  description: text("description"),
  overlapScore: real("overlap_score"),
  category: text("category"),
  metadata: jsonb("metadata"),
  // "competitor" (default) | "self" — the user's own product, monitored like a
  // competitor but excluded from the competitor list, quotas, and discovery.
  type: text("type").notNull().default("competitor"),
  // Redundant with type === "self" but handy for filtering self vs competitors.
  isUserProduct: boolean("is_user_product").notNull().default(false),
  // Editable rich profile, only populated for the self-competitor (patch-12).
  selfProfile: jsonb("self_profile").$type<SelfProfile>(),
  aiSummary: text("ai_summary"),
  aiSummaryUpdatedAt: timestamp("ai_summary_updated_at"),
  // Pricing taxonomy (patch-11): latest detected state of the pricing page.
  // pricingStatus is one of PricingStatus from @outrival/shared.
  pricingStatus: text("pricing_status"),
  pricingObservedRegion: text("pricing_observed_region"),
  pricingPromotional: boolean("pricing_promotional").notNull().default(false),
  pricingDemoUrl: text("pricing_demo_url"),
  pricingNote: text("pricing_note"),
  // When the user fills pricing in manually, scrapes must not overwrite it.
  pricingManualOverride: boolean("pricing_manual_override").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
});
