import {
  pgTable,
  text,
  timestamp,
  jsonb,
  boolean,
  integer,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";
import type { InferSelectModel, InferInsertModel } from "drizzle-orm";
import { organizations } from "./organizations";
import type { SelfProfile } from "./competitors";

// patch-28 — multi-SKU. An org owns 1+ products (HubSpot Hubs, Vercel tiers,
// Stripe products…). A product is the first-class self-monitored entity that
// replaces the old `competitors.type="self"` row: it carries the URL, the rich
// editable profile, and (via monitors.productId) its own monitoring. Competitors
// stay org-level and are linked to products through `product_competitors`.
export const productStatusEnum = pgEnum("product_status", [
  "active",
  "paused",
  "archived",
]);

export const products = pgTable(
  "products",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(), // e.g. "Marketing Hub", "Sales Hub"
    // Nullable: an idea/document/developing product has no live site yet
    // (mirrors the pre-patch self-competitor, whose url was nullable too).
    url: text("url"),
    // Rich, user-editable profile of this product — same shape the self-competitor
    // used (auto-detected fields stay sticky against user edits). Refreshed from the
    // homepage by extract-self-profile.
    productProfile: jsonb("product_profile").$type<SelfProfile>(),
    // Exactly one primary product per org (the "main" SKU). The primary can't be
    // archived without designating another one first.
    isPrimary: boolean("is_primary").notNull().default(false),
    status: productStatusEnum("status").notNull().default("active"),
    // Display order in the product selector.
    position: integer("position").notNull().default(0),
    aiSummary: text("ai_summary"),
    // Pricing taxonomy (patch-11) for this product, moved off the self-competitor.
    pricingStatus: text("pricing_status"),
    pricingObservedRegion: text("pricing_observed_region"),
    pricingPromotional: boolean("pricing_promotional").notNull().default(false),
    pricingDemoUrl: text("pricing_demo_url"),
    pricingNote: text("pricing_note"),
    pricingManualOverride: boolean("pricing_manual_override").notNull().default(false),
    lastEditedByUserAt: timestamp("last_edited_by_user_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("products_org_idx").on(t.orgId)],
);

export type Product = InferSelectModel<typeof products>;
export type NewProduct = InferInsertModel<typeof products>;
