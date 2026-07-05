import {
  pgTable,
  text,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import type { InferSelectModel } from "drizzle-orm";
import { organizations } from "./organizations";
import { products } from "./products";

// AI Visibility / "Share of Model" (see docs/ai-visibility.md). Per-product config:
// the buyer-intent prompts a product (SKU) tracks across LLM answer engines. One
// small set (5-10) per product, seeded from its category + competitor names on first
// enable, then user-curated. The per-run results are append-only in analytics.ts
// (ai_visibility_results) — this table is just the editable input list.
export const aiVisibilityPrompts = pgTable(
  "ai_visibility_prompts",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // The prompt as it is sent to the engines, e.g. "best CRM for startups".
    prompt: text("prompt").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    // "auto" = seeded by the system from the product profile; "user" = added/edited
    // by the user. Lets the seeder refresh auto prompts without clobbering curated ones.
    origin: text("origin").notNull().default("auto"),
    // patch-28 multi-SKU (phase B) — the product (SKU) this prompt belongs to. Prompts
    // are per-product; nullable for rétrocompat, backfilled to the org's primary product
    // (migration 0024). New prompts always carry it.
    productId: text("product_id").references(() => products.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("ai_visibility_prompts_org_idx").on(t.orgId),
    index("ai_visibility_prompts_org_product_idx").on(t.orgId, t.productId),
  ],
);

export type AiVisibilityPrompt = InferSelectModel<typeof aiVisibilityPrompts>;
