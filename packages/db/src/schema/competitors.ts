import { pgTable, text, timestamp, real, jsonb, boolean, index } from "drizzle-orm/pg-core";
import type { PlatformProfile } from "@outrival/shared";
import { organizations } from "./organizations";

// One editable profile field on the self-competitor (patch-12). Tracks whether the
// value still comes from auto-detection or was corrected by the user, so the UI can
// render "detected automatically" vs "edited by you on <date>".
export type SelfProfileField<T> = {
  value: T;
  isFromAutoDetect: boolean;
  lastEditedByUserAt: string | null; // ISO timestamp, null while auto-detected
};

// One pricing plan as shown on the product. Auto-detected tiers live in pricing_history
// (pricing_history); these are the user's hand-entered tiers, kept on the self
// profile so they survive without scraped history and stay sticky against scrapes.
export type SelfPricingTier = {
  plan_name: string;
  price: number;
  currency: string;
  billing_period: string;
};

// Rich, user-editable profile of the user's own product (type = "self"). Pricing
// status/meta lives on the pricing* columns (patch-11); jobs in job_postings.
// category/audience/valueProp/features/techStack are refreshed from the homepage by
// extract-self-profile (sticky vs user edits); pricingTiers are user-entered (no auto
// source outside the scraped pricing history) and have no other home.
export type SelfProfile = {
  category?: SelfProfileField<string>;
  audience?: SelfProfileField<string>;
  valueProp?: SelfProfileField<string>;
  features?: SelfProfileField<string[]>;
  techStack?: SelfProfileField<string[]>;
  pricingTiers?: SelfProfileField<SelfPricingTier[]>;
};

// Most recent moment the user hand-edited any self-profile field (patch-22). Used
// to decide whether a battle card / discovery run is stale. Null when every field is
// still auto-detected (no manual edit yet).
export function selfProfileLastEditedAt(
  profile: SelfProfile | null | undefined,
): Date | null {
  if (!profile) return null;
  const times = Object.values(profile)
    .map((f) => f?.lastEditedByUserAt)
    .filter((t): t is string => typeof t === "string" && t.length > 0)
    .map((t) => new Date(t).getTime())
    .filter((n) => Number.isFinite(n));
  return times.length > 0 ? new Date(Math.max(...times)) : null;
}

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
  // Last time the independent monthly tech-stack scraper ran for this competitor
  // (patch-18). Null = never scraped → due immediately. Drives schedule-tech-stack
  // (no monitor row, so this is the per-competitor cadence anchor).
  techStackScrapedAt: timestamp("tech_stack_scraped_at"),
  // Cached, AI-free platform detection (patch-31): framework/cms/ats/pricingWidget/
  // statusPage/changelog/analytics + per-field confidence + detectedAt. Read on every
  // scrape to route a source to its structured connector. Null = never detected → due
  // immediately (detectedAt inside drives the ~30d re-detect cadence, like techStackScrapedAt).
  platformProfile: jsonb("platform_profile").$type<PlatformProfile>(),
  // Cadence anchor for platform re-detection (patch-31), mirroring techStackScrapedAt:
  // a dedicated column the scheduler can compare in SQL (the detectedAt INSIDE the jsonb
  // profile is for display/audit). Null = never detected → due immediately.
  platformDetectedAt: timestamp("platform_detected_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
}, (t) => [
  // Every org-scoped query joins or filters competitors by org.
  index("competitors_org_idx").on(t.orgId),
]);
