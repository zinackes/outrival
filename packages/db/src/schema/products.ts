import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  pgEnum,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { InferSelectModel, InferInsertModel } from "drizzle-orm";
import { organizations } from "./organizations";
import { competitors } from "./competitors";

// patch-28 — multi-SKU. An org owns 1+ products (HubSpot Hubs, Vercel tiers,
// Stripe products…). Non-destructive model: a product is a thin wrapper over a
// "self" competitor (type="self"), which stays the monitoring anchor — it owns the
// URL, the rich editable selfProfile, the monitors, snapshots, pricing and self
// changes. So a multi-product org is just N self-competitors, each monitored by the
// existing pipeline; `products` adds the display name, ordering and primary flag.
// Competitors stay org-level and are linked to products through `product_competitors`.
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
    // The self-competitor (type="self") that backs this product — its monitoring
    // anchor. 1:1: every product has exactly one, and a self-competitor backs at
    // most one product. URL / profile / pricing / monitors all live there.
    selfCompetitorId: text("self_competitor_id")
      .notNull()
      .references(() => competitors.id, { onDelete: "cascade" }),
    // Exactly one primary product per org (the "main" SKU). The primary can't be
    // archived without designating another one first.
    isPrimary: boolean("is_primary").notNull().default(false),
    status: productStatusEnum("status").notNull().default("active"),
    // Display order in the product selector.
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("products_org_idx").on(t.orgId),
    uniqueIndex("products_self_competitor_uq").on(t.selfCompetitorId),
  ],
);

export type Product = InferSelectModel<typeof products>;
export type NewProduct = InferInsertModel<typeof products>;
