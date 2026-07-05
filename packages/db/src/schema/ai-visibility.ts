import {
  pgTable,
  text,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
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

// AI Visibility onboarding TEASER (Lever 7, docs/post-onboarding-activation.md). A
// ONE-TIME free "share of model" taste computed at onboarding on the free Gemini
// grounding tier (never a paid call without an explicit key). One row per org — its
// presence is the one-run-ever guard; `result` holds the aggregated payload the
// day-0 card renders (self vs top rival mention rates + the "Nx" framing). Distinct
// from the pro+ tracked feature (ai_visibility_prompts/results), so a free taste
// never pollutes the paid product's data.
export const aiVisibilityTeasers = pgTable(
  "ai_visibility_teasers",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // "ready" = result present; "unavailable" = no engine key / no answers / empty
    // roster (the card hides). Written once, terminally, by the job.
    status: text("status").notNull().default("ready"),
    // Which answer engine produced it ("gemini" free tier by default). Null when unavailable.
    engine: text("engine"),
    // Aggregated display payload (self/topRival mention rates, leader, ratio, citations).
    // Null when status = "unavailable".
    result: jsonb("result"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("ai_visibility_teasers_org_uq").on(t.orgId)],
);

export type AiVisibilityTeaser = InferSelectModel<typeof aiVisibilityTeasers>;
